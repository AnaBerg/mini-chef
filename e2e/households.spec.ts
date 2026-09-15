import { randomUUID } from "node:crypto";
import { expect, test, clientHeaders } from "./fixtures";
import postgres from "postgres";

test("create a household, manage equal memberships, preserve removed history and deny old access", async ({ page, browser }) => {
  const email = `household-${randomUUID()}@example.test`;
  const peerEmail = `peer-${randomUUID()}@example.test`;
  const password = "Household-test-password-42!";
  await page.goto("/sign-up");
  await page.getByLabel("Name", { exact: true }).fill("Household Chef");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL("/households");
  await page.getByLabel("Household name").fill("Our shared kitchen");
  await page.getByLabel("Timezone", { exact: true }).fill("america/sao_paulo");
  await page.getByLabel("Yes, include planned meals").check();
  await page.getByRole("button", { name: "Create household", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Our shared kitchen" })).toBeVisible();
  await expect(page.getByText(/Last active member/)).toBeVisible();
  await expect(page.getByText(/America\/Sao_Paulo/)).toBeVisible();
  const householdUrl = page.url();
  const householdId = new URL(householdUrl).pathname.split("/").pop()!;
  const peerContext = await browser.newContext({ extraHTTPHeaders: clientHeaders(randomUUID()) });
  const peerPage = await peerContext.newPage();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await peerPage.goto("/sign-up");
    await peerPage.getByLabel("Name", { exact: true }).fill("Peer Chef");
    await peerPage.getByLabel("Email", { exact: true }).fill(peerEmail);
    await peerPage.getByLabel("Password", { exact: true }).fill(password);
    await peerPage.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(peerPage).toHaveURL("/households");
    // Invitations belong to F04. Seed only the relationship between two real registered accounts.
    const [peer] = await sql`SELECT id FROM "user" WHERE email = ${peerEmail}`;
    await sql`INSERT INTO household_members (household_id, user_id) VALUES (${householdId}, ${peer.id})`;
    await peerPage.goto(householdUrl);
    await peerPage.getByRole("button", { name: "Deactivate Household Chef" }).click();
    await peerPage.getByRole("button", { name: "Confirm deactivation" }).click();
    await expect(peerPage.getByText("inactive", { exact: true })).toBeVisible();
    await expect(peerPage.getByText(/Last active member/)).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Household unavailable" })).toBeVisible();
    await page.getByRole("link", { name: "Back to your households" }).click();
    await expect(page.getByText(/No active households yet/)).toBeVisible();
    const [history] = await sql`SELECT count(*)::integer AS count FROM audit_events WHERE household_id = ${householdId}`;
    expect(history.count).toBe(3);
  } finally { await sql.end(); await peerContext.close(); }
});
