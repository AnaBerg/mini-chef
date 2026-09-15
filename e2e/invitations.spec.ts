import { randomUUID } from "node:crypto";
import { expect, test, clientHeaders } from "./fixtures";
import postgres from "postgres";
test("share, register with fragment continuation, explicitly accept, revoke and preserve removed identity on replay", async ({ page, browser }) => {
  const recipientEmail = `recipient-${randomUUID()}@example.test`;
  const password = "Invitation-test-password-42!";
  await page.goto("/sign-up");
  await page.getByLabel("Name", { exact: true }).fill("Inviting Chef"); await page.getByLabel("Email", { exact: true }).fill(`invite-${randomUUID()}@example.test`); await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click(); await expect(page).toHaveURL("/households");
  await page.getByLabel("Household name").fill("The invitation kitchen"); await page.getByLabel("Timezone", { exact: true }).fill("UTC"); await page.getByLabel("Yes, include planned meals").check(); await page.getByRole("button", { name: "Create household", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The invitation kitchen" })).toBeVisible(); const home = page.url(); const householdId = new URL(home).pathname.split("/").pop()!;
  await page.getByRole("link", { name: "Manage invitation links" }).click(); await page.getByRole("button", { name: "Create invitation link" }).click(); const link = await page.getByLabel("Your invitation link").inputValue(); expect(new URL(link).search).toBe("");
  const context = await browser.newContext({ extraHTTPHeaders: clientHeaders(randomUUID()) }); const recipient = await context.newPage(); const db = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const requested: string[] = []; recipient.on("request", (request) => { if (request.method() === "GET") requested.push(request.url()); });
    await recipient.goto(link); await recipient.getByRole("button", { name: "Preview invitation" }).click(); await recipient.getByRole("link", { name: "create an account" }).click(); await expect(recipient).toHaveURL(new RegExp(`/sign-up#${new URL(link).hash.slice(1)}$`));
    await recipient.getByLabel("Name", { exact: true }).fill("Joining Chef"); await recipient.getByLabel("Email", { exact: true }).fill(recipientEmail); await recipient.getByLabel("Password", { exact: true }).fill(password); await recipient.getByRole("button", { name: "Create account", exact: true }).click(); await expect(recipient).toHaveURL(link);
    await recipient.getByRole("button", { name: "Preview invitation" }).click(); await expect(recipient.getByRole("heading", { name: "The invitation kitchen" })).toBeVisible();
    const [before] = await db`SELECT count(*)::integer AS count FROM household_members WHERE household_id = ${householdId}`; expect(before.count).toBe(1);
    await recipient.getByRole("button", { name: "Accept invitation and join" }).click(); await expect(recipient).toHaveURL(home); await expect(recipient.getByText("Joining Chef (you)")).toBeVisible();
    const [joined] = await db`SELECT id FROM household_members WHERE household_id = ${householdId} AND user_id = (SELECT id FROM "user" WHERE email = ${recipientEmail})`;
    await page.goto(home); await page.getByRole("button", { name: "Deactivate Joining Chef" }).click(); await page.getByRole("button", { name: "Confirm deactivation" }).click(); await expect(page.getByText("inactive", { exact: true })).toBeVisible();
    await recipient.goto(link); await recipient.getByRole("button", { name: "Check previous acceptance" }).click(); await expect(recipient.getByRole("alert").filter({ hasText: "new invitation" })).toBeVisible();
    const [removed] = await db`SELECT status FROM household_members WHERE id = ${joined.id}`; expect(removed.status).toBe("inactive");
    await page.getByRole("link", { name: "Manage invitation links" }).click(); await page.getByRole("button", { name: "Create invitation link" }).click(); const revoked = await page.getByLabel("Your invitation link").inputValue(); await page.getByRole("button", { name: "Revoke", exact: true }).click();
    await recipient.goto(revoked); await recipient.getByRole("button", { name: "Preview invitation" }).click(); await expect(recipient.getByRole("alert").filter({ hasText: "unavailable" })).toBeVisible(); await expect(recipient.getByText("The invitation kitchen")).toHaveCount(0);
    await page.getByRole("button", { name: "Create invitation link" }).click(); const fresh = await page.getByLabel("Your invitation link").inputValue(); await recipient.goto(fresh); await recipient.getByRole("button", { name: "Preview invitation" }).click(); await recipient.getByRole("button", { name: "Accept invitation and join" }).click(); await expect(recipient).toHaveURL(home);
    const [restored] = await db`SELECT status FROM household_members WHERE id = ${joined.id}`; expect(restored.status).toBe("active");
    // Browser fragments are not transmitted on HTTP requests; strip Playwright's client URL representation.
    expect(requested.every((url) => !new URL(url).pathname.includes(new URL(link).hash.slice(1)) && !new URL(url).search.includes(new URL(link).hash.slice(1)))).toBe(true);
    const operations = await db`SELECT result, request_hash FROM domain_operations WHERE household_id = ${householdId}`; expect(JSON.stringify(operations)).not.toContain(new URL(link).hash.slice(1));
  } finally { await db.end(); await context.close(); }
});
