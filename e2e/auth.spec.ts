import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("visitors cannot open the dashboard", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL("/sign-in");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("register, keep a session, sign out, reject a bad password, and sign in", async ({ page }) => {
  const email = `chef-${randomUUID()}@example.com`;
  const password = "A-delicious-test-password-42!";

  await page.goto("/");
  await page.getByRole("link", { name: "Create account", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Test Chef");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL("/dashboard");
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your kitchen" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL("/sign-in");
  await page.goto("/dashboard");
  await expect(page).toHaveURL("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("incorrect-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL("/sign-in");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("/dashboard");
  await expect(page.getByText(email, { exact: true })).toBeVisible();
});
