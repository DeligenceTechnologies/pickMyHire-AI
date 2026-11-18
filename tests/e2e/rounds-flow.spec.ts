import { expect, test } from "@playwright/test";
import postgres from "postgres";

// Job with two interview rounds; the invite dialog picks the candidate's next
// round and asks before repeating a completed one.

async function system<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  const db = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    return (await db.begin(async (tx) => { await tx`select set_config('app.system', 'on', true)`; return fn(tx); })) as T;
  } finally {
    await db.end();
  }
}

test("job rounds and the invite round picker", async ({ page }) => {
  test.setTimeout(180_000);
  const id = Date.now().toString(36);
  await page.goto("/signup?code=1");
  await page.getByLabel("Full name").fill("Rory Recruiter");
  await page.getByLabel("Work email").fill(`rounds-${id}@e2e.test`);
  await page.getByLabel("Company / workspace name").fill(`Rounds UI ${id}`);
  await page.getByLabel("Access code").fill(process.env.SIGNUP_ACCESS_CODE ?? "");
  await page.getByLabel("Password").fill(`pw-${id}-rounds-secret`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // Create a job with two rounds (no description, so no AI parsing).
  await page.goto("/jobs/new");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Job title").fill("Support Lead");
  await expect(page.getByLabel("Round 1 name")).toHaveValue("Screening");
  await page.getByLabel("Round 1 template").selectOption({ index: 2 });
  await page.getByRole("button", { name: "Add round" }).click();
  await page.getByLabel("Round 2 name").fill("Technical");
  await page.getByLabel("Round 2 template").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Create job" }).click();
  await expect(page.getByRole("heading", { name: /Support Lead/ })).toBeVisible();
  const rounds = page.locator("section", { has: page.getByRole("heading", { name: "Interview rounds" }) });
  await expect(rounds.getByText("Screening", { exact: true })).toBeVisible();
  await expect(rounds.getByText("Technical", { exact: true })).toBeVisible();

  // A candidate who already completed Screening.
  const jobId = page.url().split("/jobs/")[1];
  await system(async (tx) => {
    const [job] = await tx<{ organization_id: string }[]>`select organization_id from jobs where id = ${jobId}`;
    const [r] = await tx<{ id: string; name: string; template_id: string }[]>`select id, name, template_id from job_rounds where job_id = ${jobId} order by sort_order limit 1`;
    const [c] = await tx<{ id: string }[]>`insert into candidates (organization_id, name, email, resume_file_path) values (${job.organization_id}, 'Dana Done', ${`dana-${id}@e2e.test`}, 'test/resume.pdf') returning id`;
    await tx`insert into interviews (organization_id, job_id, candidate_id, template_id, round_id, round_name, attempt, secure_token_hash, status, started_at, completed_at)
      values (${job.organization_id}, ${jobId}, ${c.id}, ${r.template_id}, ${r.id}, ${r.name}, 1, ${`rounds-${id}`}, 'completed', now() - interval '20 minutes', now())`;
  });

  // The picker defaults to the next round and flags the completed one.
  await page.reload();
  await page.getByRole("button", { name: "Invite candidate" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "Existing candidate" }).click();
  await dlg.getByRole("button", { name: /Dana Done/ }).click();
  await expect(dlg.getByText(/Done \d+ \w+/)).toBeVisible();
  await expect(dlg.getByRole("radio", { name: /2\. Technical/ })).toBeChecked();
  await dlg.getByRole("radio", { name: /1\. Screening/ }).check();
  await expect(dlg.getByText(/This invite will be attempt 2/)).toBeVisible();
  await expect(dlg.getByLabel("Reason for another attempt")).toBeVisible();
  // Another template, saved to the job as a new round.
  await dlg.getByRole("radio", { name: "Another template…" }).check();
  await dlg.getByText("Also add it to this job as a new round").click();
  await expect(dlg.getByLabel("Round name")).toBeVisible();
  await dlg.getByRole("button", { name: "Cancel" }).click();

  // Compare page lists the job's rounds.
  await page.goto(`/jobs/${jobId}/compare`);
  await expect(page.getByRole("navigation", { name: "Interview round" }).getByRole("link", { name: "Screening" })).toBeVisible();
  await expect(page.getByText("Dana Done")).toBeVisible();
});
