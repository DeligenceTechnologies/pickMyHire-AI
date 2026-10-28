import { expect, test } from "@playwright/test";
import { execSync } from "node:child_process";

// Promo codes: the platform admin creates a coupon, a company applies it from the
// dashboard, can't apply it twice, and the admin sees who used it.

test("platform admin creates a coupon and a company redeems it once", async ({ page }) => {
  test.setTimeout(180_000);
  const id = Date.now().toString(36);
  const email = `coupon-${id}@e2e.test`;
  const company = `Coupon Co ${id}`;
  await page.goto("/signup?code=1");
  await page.getByLabel("Full name").fill("Cora Admin");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Company / workspace name").fill(company);
  await page.getByLabel("Access code").fill(process.env.SIGNUP_ACCESS_CODE ?? "");
  await page.getByLabel("Password").fill(`pw-${id}-coupon-secret`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  execSync(`npm run -s admin:grant -- ${email}`, { stdio: "pipe" });

  // Create the coupon.
  const code = `E2E${id}`.toUpperCase();
  await page.goto("/admin/coupons");
  await page.getByRole("button", { name: "New coupon" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#cp-code").fill(code);
  await dialog.getByLabel("Free interviews to add").fill("7");
  await dialog.getByLabel("Maximum companies").fill("50");
  await dialog.getByLabel(/Campaign/).fill("E2E campaign");
  await expect(dialog.getByText("Gives: 7 free interviews.")).toBeVisible();
  await dialog.getByRole("button", { name: "Create coupon" }).click();
  await expect(page).toHaveURL(/\/admin\/coupons\/[0-9a-f-]{36}/);
  await expect(page.getByText("Not used yet")).toBeVisible();

  // Apply it from the dashboard.
  await page.goto("/settings/usage");
  const before = Number((await page.getByText(/ of \d+ used/).first().innerText()).match(/of (\d+) used/)![1]);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Have a promo code?" }).first().click();
  await page.getByRole("dialog").getByLabel("Promo code", { exact: true }).fill(code.toLowerCase());
  await page.getByRole("dialog").getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("Code applied: 7 free interviews added.")).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden();

  // The quota went up, and the same company can't use it again.
  await page.goto("/settings/usage");
  await expect(page.getByText(new RegExp(` of ${before + 7} used`))).toBeVisible();
  await page.getByLabel("Promo code", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("Your company has already used this code.")).toBeVisible();
  await page.getByLabel("Promo code", { exact: true }).fill(`WRONG${id}`);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("This code isn't valid or has expired.")).toBeVisible();

  // The admin sees the redemption.
  await page.goto("/admin/coupons");
  await page.getByRole("link", { name: code }).click();
  await expect(page.getByRole("link", { name: company })).toBeVisible();
  await expect(page.getByRole("cell", { name: "7 free interviews" })).toBeVisible();
});
