import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import postgres from "postgres";

// Platform admin: approve an access request, the client signs up with the
// one-time link, the company runs out of interviews and gets more, then suspend,
// disable and the shared access code switch. No AI calls are made.

async function system<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  const db = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    return (await db.begin(async (tx) => {
      await tx`select set_config('app.system', 'on', true)`;
      return fn(tx);
    })) as T;
  } finally {
    await db.end();
  }
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("platform admin manages access, quotas and accounts", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const id = Date.now().toString(36);
  const adminEmail = `admin-${id}@e2e.test`;
  const adminPw = `pw-${id}-admin-secret`;
  const clientEmail = `client-${id}@e2e.test`;
  const clientPw = `pw-${id}-client-secret`;
  const company = `Client Co ${id}`;

  // Admin account (signs up like anyone else, then is promoted from the command line).
  await page.goto("/signup?code=1");
  await page.getByLabel("Full name").fill("Avery Admin");
  await page.getByLabel("Work email").fill(adminEmail);
  await page.getByLabel("Company / workspace name").fill(`Admin Co ${id}`);
  await page.getByLabel("Access code").fill(process.env.SIGNUP_ACCESS_CODE ?? "");
  await page.getByLabel("Password").fill(adminPw);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible(); // not an admin yet
  execSync(`npm run -s admin:grant -- ${adminEmail}`, { stdio: "pipe" });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Platform overview" })).toBeVisible();

  // A request arrives from the home page; approve it with 1 free interview.
  const req = await page.request.post("/api/public/access-request", { data: { name: "Casey Client", email: clientEmail, company } });
  expect(req.ok()).toBeTruthy();
  await page.goto("/admin/requests?status=new");
  const card = page.locator("li", { hasText: company });
  await card.getByRole("button", { name: "Approve" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Free interviews").fill("1");
  await dialog.getByRole("button", { name: "Approve and create link" }).click();
  const linkInput = dialog.locator("input[readonly]");
  await expect(linkInput).toHaveValue(/\/signup\?company=/);
  const link = await linkInput.inputValue();
  await dialog.getByRole("button", { name: "Done" }).click();

  // The client uses the link: company name and email are fixed.
  const clientCtx = await browser.newContext();
  const cp = await clientCtx.newPage();
  await cp.goto(link.replace(/^https?:\/\/[^/]+/, ""));
  await expect(cp.getByRole("heading", { name: `Set up ${company}` })).toBeVisible();
  await expect(cp.getByLabel("Work email")).toHaveValue(clientEmail);
  await cp.getByLabel("Full name").fill("Casey Client");
  await cp.getByLabel("Password").fill(clientPw);
  await cp.getByRole("button", { name: `Create ${company}` }).click();
  await expect(cp).toHaveURL(/\/dashboard/);
  // The link only works once, and the client can't open the admin area.
  await cp.goto(link.replace(/^https?:\/\/[^/]+/, ""));
  await expect(cp.getByText(/invalid, already used or expired/)).toBeVisible();
  await cp.goto("/admin");
  await expect(cp.getByRole("heading", { name: "Page not found" })).toBeVisible();

  // One interview (used when it started) uses the whole balance: the company is warned, but can still invite.
  const { orgId } = await system(async (tx) => {
    const [org] = await tx<{ id: string }[]>`select id from organizations where name = ${company}`;
    const [job] = await tx<{ id: string }[]>`insert into jobs (organization_id, title, status) values (${org.id}, 'Quota Role', 'active') returning id`;
    const [tpl] = await tx<{ id: string }[]>`select id from interview_templates where organization_id = ${org.id} limit 1`;
    await tx`insert into job_rounds (organization_id, job_id, name, template_id) values (${org.id}, ${job.id}, 'Screening', ${tpl.id})`;
    const [c1] = await tx<{ id: string }[]>`insert into candidates (organization_id, name, email, resume_file_path) values (${org.id}, 'Done Candidate', ${`done-${id}@e2e.test`}, 'test/resume.pdf') returning id`;
    const [c2] = await tx<{ id: string }[]>`insert into candidates (organization_id, name, email, resume_file_path) values (${org.id}, 'Next Candidate', ${`next-${id}@e2e.test`}, 'test/resume.pdf') returning id`;
    await tx`insert into interviews (organization_id, job_id, candidate_id, secure_token_hash, status, completed_at, duration_seconds, credits_used, charged_at)
      values (${org.id}, ${job.id}, ${c1.id}, ${`e2e-${id}`}, 'completed', now(), 900, 1, now())`;
    return { orgId: org.id, jobId: job.id, candidateId: c2.id };
  });
  await cp.goto("/dashboard");
  await expect(cp.getByText("No interviews left.")).toBeVisible();
  await expect(cp.getByRole("link", { name: "Buy interviews" })).toBeVisible();
  await cp.goto("/settings/usage");
  await expect(cp.getByText("of 1 used")).toBeVisible();

  // Admin adds one more: the company has 1 left again.
  await page.goto(`/admin/companies/${orgId}`);
  await expect(page.getByRole("heading", { name: company })).toBeVisible();
  await page.getByRole("button", { name: "+1", exact: true }).click();
  await expect(page.getByText("Interviews updated")).toBeVisible();
  await cp.goto("/dashboard");
  await expect(cp.getByText("1 interview left.")).toBeVisible();

  // Suspend: the client is signed out and can't sign back in.
  await page.getByRole("button", { name: "Suspend" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Suspend company" }).click();
  await expect(page.getByText("Company suspended")).toBeVisible();
  await cp.goto("/dashboard");
  await expect(cp).toHaveURL(/\/login/);
  await login(cp, clientEmail, clientPw);
  await expect(cp.getByText("This company account is suspended")).toBeVisible();
  await page.getByRole("button", { name: "Reactivate" }).click();
  await expect(page.getByText("Company reactivated")).toBeVisible();
  await login(cp, clientEmail, clientPw);
  await expect(cp).toHaveURL(/\/dashboard/);

  // Disable the user account.
  await page.goto(`/admin/users?q=${encodeURIComponent(clientEmail)}`);
  await page.getByRole("button", { name: "Actions for Casey Client" }).click();
  await page.getByRole("menuitem", { name: "Disable account" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Disable account" }).click();
  await expect(page.getByText("Account disabled")).toBeVisible();
  await cp.goto("/dashboard");
  await expect(cp).toHaveURL(/\/login/);
  await login(cp, clientEmail, clientPw);
  await expect(cp.getByText("This account has been disabled")).toBeVisible();
  await clientCtx.close();

  // Shared access code: switch off, sign-up with it fails, switch back on.
  await page.goto("/admin/settings");
  const code = await page.getByRole("textbox", { name: "Access code" }).inputValue();
  await page.getByRole("switch", { name: "Allow sign-up with the shared code" }).click();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved")).toBeVisible();
  const signup = await page.request.post("/api/auth/signup", {
    data: { name: "Late Comer", email: `late-${id}@e2e.test`, orgName: "Late Co", accessCode: code, password: `pw-${id}-late-secret` },
  });
  expect(signup.status()).toBe(403);
  await page.reload();
  await page.getByRole("switch", { name: "Allow sign-up with the shared code" }).click();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved")).toBeVisible();

  // Everything above is in the audit log.
  await page.goto("/admin/audit");
  for (const action of ["Approved access request", "Updated company", "Suspended company", "Reactivated company", "Disabled user", "Updated platform settings"]) {
    await expect(page.getByText(action).first()).toBeVisible();
  }
});
