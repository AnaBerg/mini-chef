import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test, clientHeaders } from "./fixtures";
import postgres from "postgres";

const password = "Session-test-password-42!";
async function register(page: Page, email: string, name = "Session Chef") {
  await page.goto("/sign-up");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL("/households");
}
async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
async function create(page: Page, name: string) {
  await page.getByLabel("Household name").fill(name);
  await page.getByLabel("No, use consumption only").check();
  await page.getByRole("button", { name: "Create household", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  return new URL(page.url()).pathname;
}

test("routes zero, one and multiple active memberships and isolates household switches", async ({ page }) => {
  const email = `routing-${randomUUID()}@example.test`;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await register(page, email);
    await expect(page.getByRole("heading", { name: "Set up your household" })).toBeVisible();
    const first = await create(page, "First private kitchen");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL("/sign-in");
    await signIn(page, email);
    await expect(page).toHaveURL(first);
    await page.getByRole("link", { name: "Switch household" }).click();
    const second = await create(page, "Second private kitchen");
    // Distinct member identities prove the household query does not mix tenant data.
    const peer = `peer-${randomUUID()}`;
    await sql`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES (${peer}, 'First-only member', ${`${peer}@example.test`}, false, now(), now())`;
    await sql`INSERT INTO household_members (household_id, user_id) VALUES (${first.split('/').pop()!}, ${peer})`;
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL("/sign-in");
    await signIn(page, email);
    await expect(page).toHaveURL("/households");
    await expect(page.getByRole("heading", { name: "Choose your household" })).toBeVisible();
    await page.getByRole("link", { name: /First private kitchen/ }).click();
    await expect(page.getByText("First-only member", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Switch household" }).click();
    await page.getByRole("link", { name: /Second private kitchen/ }).click();
    await expect(page).toHaveURL(second);
    await expect(page.getByText("First-only member", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "First private kitchen" })).toHaveCount(0);
    // Remove access while the older document is in browser history.
    await sql`UPDATE household_members SET status = 'inactive', version = version + 1 WHERE household_id = ${first.split('/').pop()!} AND user_id = (SELECT id FROM "user" WHERE email = ${email})`;
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Choose your household" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Household unavailable" })).toBeVisible();
    await expect(page.getByText("First-only member", { exact: true })).toHaveCount(0);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(second);
    // Expiry must be checked against the live session row, even with a browser cookie.
    await sql`UPDATE session SET expires_at = now() - interval '1 minute' WHERE user_id = (SELECT id FROM "user" WHERE email = ${email})`;
    await page.reload();
    await expect(page).toHaveURL("/sign-in");
    await expect(page.getByRole("heading", { name: "Second private kitchen" })).toHaveCount(0);
  } finally { await sql.end(); }
});

test("logout is retryable and unconfirmed on failure, then revokes only the current session", async ({ page, browser }) => {
  const email = `logout-${randomUUID()}@example.test`;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const otherDevice = await browser.newContext({ extraHTTPHeaders: clientHeaders(randomUUID()) });
  try {
    await register(page, email, "Private session identity");
    const home = await create(page, "Session-private kitchen");
    const otherPage = await otherDevice.newPage();
    await signIn(otherPage, email);
    await expect(otherPage).toHaveURL(home);
    const [before] = await sql`SELECT count(*)::int AS count FROM session WHERE user_id = (SELECT id FROM "user" WHERE email = ${email})`;
    expect(before.count).toBe(2);
    await page.route("**/api/auth/sign-out", (route) => route.abort("internetdisconnected"));
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Sign-out is unconfirmed" })).toContainText("Sign-out is unconfirmed");
    await expect(page).toHaveURL(home);
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeEnabled();
    await page.unroute("**/api/auth/sign-out");
    await page.route("**/api/auth/sign-out", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Server unavailable" }) }));
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Sign-out is unconfirmed" })).toContainText("Sign-out is unconfirmed");
    const [unchanged] = await sql`SELECT count(*)::int AS count FROM session WHERE user_id = (SELECT id FROM "user" WHERE email = ${email})`;
    expect(unchanged.count).toBe(2);
    await page.unroute("**/api/auth/sign-out");
    const siblingTab = await page.context().newPage();
    await siblingTab.goto(home);
    await expect(siblingTab.getByRole("heading", { name: "Session-private kitchen" })).toBeVisible();
    // Put private data in history before logout, exercising actual browser back navigation.
    await page.getByRole("link", { name: "Switch household" }).click();
    await page.getByRole("link", { name: /Session-private kitchen/ }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL("/sign-in");
    await expect(siblingTab).toHaveURL("/sign-in");
    await expect(siblingTab.getByText("Session-private kitchen", { exact: true })).toHaveCount(0);
    await siblingTab.close();
    await page.goBack();
    await expect(page).toHaveURL("/sign-in");
    await expect(page.getByText("Session-private kitchen", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Private session identity (you)", { exact: true })).toHaveCount(0);
    await otherPage.reload();
    await expect(otherPage).toHaveURL(home);
    await expect(otherPage.getByRole("heading", { name: "Session-private kitchen" })).toBeVisible();
    const [remaining] = await sql`SELECT count(*)::int AS count FROM session WHERE user_id = (SELECT id FROM "user" WHERE email = ${email})`;
    expect(remaining.count).toBe(1);
    const [membership] = await sql`SELECT status FROM household_members WHERE household_id = ${home.split('/').pop()!} AND user_id = (SELECT id FROM "user" WHERE email = ${email})`;
    expect(membership.status).toBe("active");
    // The request can commit while its response is lost. Remain unconfirmed until retry.
    await otherPage.route("**/api/auth/sign-out", async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("connectionreset");
    });
    await otherPage.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(otherPage.getByRole("alert").filter({ hasText: "Sign-out is unconfirmed" })).toBeVisible();
    const [revoked] = await sql`SELECT count(*)::int AS count FROM session WHERE user_id = (SELECT id FROM "user" WHERE email = ${email})`;
    expect(revoked.count).toBe(0);
    await otherPage.unroute("**/api/auth/sign-out");
    await otherPage.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(otherPage).toHaveURL("/sign-in");
    // A different account in this browser must never inherit the previous selection/data.
    await register(page, `next-${randomUUID()}@example.test`, "Next account");
    await expect(page.getByRole("heading", { name: "Set up your household" })).toBeVisible();
    await expect(page.getByText("Session-private kitchen", { exact: true })).toHaveCount(0);
    await page.goto(home);
    await expect(page.getByRole("heading", { name: "Household unavailable" })).toBeVisible();
  } finally { await sql.end(); await otherDevice.close(); }
});

test("self-deactivation clears removed household data from sibling tabs", async ({ page, browser }) => {
  const email = `self-removal-${randomUUID()}@example.test`;
  const peerEmail = `remaining-${randomUUID()}@example.test`;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const peerDevice = await browser.newContext({ extraHTTPHeaders: clientHeaders(randomUUID()) });
  try {
    await register(page, email, "Departing private member");
    const home = await create(page, "Removed private kitchen");
    const peerPage = await peerDevice.newPage();
    await register(peerPage, peerEmail, "Remaining private member");
    // Seed only the relationship between real accounts until invitations are implemented.
    await sql`INSERT INTO household_members (household_id, user_id) SELECT ${home.split('/').pop()!}, id FROM "user" WHERE email = ${peerEmail}`;
    await page.reload();
    const siblingTab = await page.context().newPage();
    await siblingTab.goto(home);
    await expect(siblingTab.getByRole("heading", { name: "Removed private kitchen" })).toBeVisible();
    await expect(siblingTab.getByText("Remaining private member", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Deactivate your membership", exact: true }).click();
    await page.getByRole("button", { name: "Confirm deactivation", exact: true }).click();
    await expect(page).toHaveURL("/households");
    await expect(page.getByRole("heading", { name: "Set up your household" })).toBeVisible();
    // The tab must revalidate automatically; no manual reload or navigation is allowed here.
    await expect(siblingTab.getByRole("heading", { name: "Household unavailable" })).toBeVisible();
    await expect(siblingTab.getByText("Removed private kitchen", { exact: true })).toHaveCount(0);
    await expect(siblingTab.getByText("Departing private member (you)", { exact: true })).toHaveCount(0);
    await expect(siblingTab.getByText("Remaining private member", { exact: true })).toHaveCount(0);
    const members = await sql`SELECT status FROM household_members WHERE household_id = ${home.split('/').pop()!} ORDER BY status`;
    expect(members.map((member) => member.status)).toEqual(["active", "inactive"]);
    await siblingTab.close();
  } finally { await sql.end(); await peerDevice.close(); }
});
