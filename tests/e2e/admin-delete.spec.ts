import { expect, test } from "@playwright/test";
import { execSync } from "node:child_process";
import postgres from "postgres";

// Platform admin: change a mistyped email, delete a user (blocked when unsafe), and
// delete a suspended company. Test accounts and companies are created directly.

async function system<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  const db = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    return (await db.begin(async (tx) => { await tx`select set_config('app.system', 'on', true)`; return fn(tx); })) as T;
  } finally {
    await db.end();
  }
}

test("platform admin changes an email and deletes users and companies", async ({ page }) => {
  test.setTimeout(180_000);
  const id = Date.now().toString(36);
  const adminEmail = `deladmin-${id}@e2e.test`;
  await page.goto("/signup?code=1");
  await page.getByLabel("Full name").fill("Dee Admin");
  await page.getByLabel("Work email").fill(adminEmail);
  await page.getByLabel("Company / workspace name").fill(`Del Admin Co ${id}`);
  await page.getByLabel("Access code").fill(process.env.SIGNUP_ACCESS_CODE ?? "");
  await page.getByLabel("Password").fill(`pw-${id}-admin-secret`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  execSync(`npm run -s admin:grant -- ${adminEmail}`, { stdio: "pipe" });

  // A typo account, an owner with a teammate, and a solo trial company.
  const { soloOrg } = await system(async (tx) => {
    const mk = async (name: string) => (await tx<{ id: string }[]>`insert into users (email, name, password_hash) values (${`${name.toLowerCase()}-${id}@e2e.test`}, ${name}, 'x') returning id`)[0].id;
    const typo = await mk("Typo"); const owner = await mk("Owner"); const mate = await mk("Mate"); const solo = await mk("Solo");
    const org = async (name: string, members: [string, string][], trial = false) => {
      const [o] = await tx<{ id: string }[]>`insert into organizations (name, slug, plan, signup_domain) values (${`${name} ${id}`}, ${`${name.toLowerCase()}-co-${id}`}, ${trial ? "trial" : "standard"}, ${trial ? "e2e.test" : null}) returning id`;
      for (const [u, r] of members) await tx`insert into organization_members (organization_id, user_id, role) values (${o.id}, ${u}, ${r})`;
      return o.id;
    };
    await org("Typo", [[typo, "owner"]]);
    await org("Shared", [[owner, "owner"], [mate, "recruiter"]]);
    return { soloOrg: await org("Solo", [[solo, "owner"]], true) };
  });

  // Change a mistyped email.
  await page.goto(`/admin/users?q=typo-${id}`);
  await page.getByRole("button", { name: "Actions for Typo" }).click();
  await page.getByRole("menuitem", { name: "Change email" }).click();
  await page.getByLabel("New email").fill(`fixed-${id}@e2e.test`);
  await page.getByRole("button", { name: "Change email" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.goto(`/admin/users?q=fixed-${id}`);
  await expect(page.getByText(`fixed-${id}@e2e.test`)).toBeVisible();

  // An owner with a teammate can't be deleted until ownership moves.
  await page.goto(`/admin/users?q=owner-${id}`);
  await page.getByRole("button", { name: "Actions for Owner" }).click();
  await page.getByRole("menuitem", { name: "Delete permanently" }).click();
  await expect(page.getByRole("dialog").getByText(/transfer ownership/)).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Delete permanently" })).toBeDisabled();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  // A solo user goes with their company.
  await page.goto(`/admin/users?q=solo-${id}`);
  await page.getByRole("button", { name: "Actions for Solo" }).click();
  await page.getByRole("menuitem", { name: "Delete permanently" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByText(`Solo ${id}`)).toBeVisible();
  if (process.env.E2E_SCREENSHOTS) await dlg.screenshot({ path: "test-results/admin-delete-user.png" });
  await dlg.getByLabel(/to confirm/).fill(`solo-${id}@e2e.test`);
  await dlg.getByRole("button", { name: "Delete permanently" }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByRole("heading", { name: "No users found" })).toBeVisible();
  expect((await system((tx) => tx`select 1 from organizations where id = ${soloOrg}`)).length).toBe(0);
  // That email can't start a second free trial.
  const again = await page.request.post("/api/auth/signup", { data: { name: "Solo", email: `solo-${id}@e2e.test`, password: `pw-${id}-again-secret`, orgName: "Solo Again", trial: true } });
  expect(again.status()).toBe(409);

  // Delete a company: only after suspending it, and typing its name.
  const [shared] = await system((tx) => tx<{ id: string }[]>`select id from organizations where slug = ${`shared-co-${id}`}`);
  await page.goto(`/admin/companies/${shared.id}`);
  await expect(page.getByRole("button", { name: "Delete company" })).toHaveCount(0);
  await page.getByRole("button", { name: "Suspend" }).click();
  await page.getByRole("button", { name: "Suspend company" }).click();
  await page.getByRole("button", { name: "Delete company" }).click();
  const cd = page.getByRole("dialog");
  await expect(cd.getByText(/0 jobs, 0 candidates, 0 interviews/)).toBeVisible();
  await expect(cd.getByText(new RegExp(`mate-${id}@e2e.test`))).toBeVisible();
  if (process.env.E2E_SCREENSHOTS) await cd.screenshot({ path: "test-results/admin-delete-company.png" });
  await cd.getByLabel(/to confirm/).fill(`Shared ${id}`);
  await cd.getByRole("button", { name: "Delete permanently" }).click();
  await expect(page).toHaveURL(/\/admin\/companies$/);
  const left = await system((tx) => tx<{ n: number }[]>`select count(*)::int as n from users where email = any(${[`owner-${id}@e2e.test`, `mate-${id}@e2e.test`]})`);
  expect(left[0].n).toBe(0);
});
