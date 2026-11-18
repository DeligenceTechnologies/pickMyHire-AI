import { expect, test } from "@playwright/test";

// Self-serve free trial from the home page: work email only, no access code.
// Needs free trials switched on (the default).
test("start a free trial from the home page", async ({ page }) => {
  const id = Date.now().toString(36);
  await page.goto("/");
  await page.getByRole("link", { name: /Start free trial/ }).first().click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole("heading", { name: "Start your free trial" })).toBeVisible();
  await expect(page.getByText(/3 AI interviews free for 14 days/)).toBeVisible();

  await page.getByLabel("Full name").fill("Tara Trial");
  await page.getByLabel("Company name").fill(`Trial Co ${id}`);
  await page.getByLabel("Password").fill(`pw-${id}-trial-secret`);

  // Personal mailboxes can't start a trial.
  await page.getByLabel("Work email").fill(`tara.${id}@gmail.com`);
  await page.getByRole("button", { name: "Start free trial" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /work email/ })).toBeVisible();

  await page.getByLabel("Work email").fill(`tara@trialco-${id}.test`);
  await page.getByRole("button", { name: "Start free trial" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText("3 of 3 interviews left · 14 days left")).toBeVisible();
  await expect(page.getByRole("link", { name: "Buy interviews" })).toBeVisible();
});

test("people with an access code can still use it", async ({ page }) => {
  await page.goto("/signup");
  await page.getByRole("link", { name: "Use it here" }).click();
  await expect(page).toHaveURL(/\/signup\?code=1/);
  await expect(page.getByLabel("Access code")).toBeVisible();
  await expect(page.getByRole("link", { name: "Start a free trial" })).toBeVisible();
});
