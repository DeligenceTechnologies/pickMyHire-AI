import { expect, test } from "@playwright/test";
import postgres from "postgres";

// A job with an AI round and a human round: decide the AI round, schedule the
// human interview, fill in the scorecard, mark it Qualified, then shortlist.

async function system<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  const db = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    return (await db.begin(async (tx) => { await tx`select set_config('app.system', 'on', true)`; return fn(tx); })) as T;
  } finally {
    await db.end();
  }
}

test("round decisions, human interview and shortlist", async ({ page }) => {
  test.setTimeout(180_000);
  const id = Date.now().toString(36);
  await page.goto("/signup?code=1");
  await page.getByLabel("Full name").fill("Rory Recruiter");
  await page.getByLabel("Work email").fill(`hiring-${id}@e2e.test`);
  await page.getByLabel("Company / workspace name").fill(`Hiring UI ${id}`);
  await page.getByLabel("Access code").fill(process.env.SIGNUP_ACCESS_CODE ?? "");
  await page.getByLabel("Password").fill(`pw-${id}-hiring-secret`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // Job: AI screening, then a human panel round with the default skills.
  await page.goto("/jobs/new");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Job title").fill("Backend Engineer");
  await page.getByLabel("Round 1 template").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Add round" }).click();
  await page.getByLabel("Round 2 name").fill("Panel");
  await page.getByRole("radiogroup", { name: "Round 2 type" }).getByRole("radio", { name: "Human interview" }).click();
  await expect(page.getByText("Technical skills")).toBeVisible();
  await page.getByLabel("Round 2 interviewer guide").fill("Ask about scaling a queue");
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: "test-results/hiring-1-rounds-editor.png", fullPage: true });
  await page.getByRole("button", { name: "Create job" }).click();
  await expect(page.getByRole("heading", { name: /Backend Engineer/ })).toBeVisible();
  const jobId = page.url().split("/jobs/")[1];
  await expect(page.getByText(/Assess: Technical skills, Problem solving/)).toBeVisible();

  // A candidate who finished the AI screening.
  const { candidateId, interviewId } = await system(async (tx) => {
    const [job] = await tx<{ organization_id: string }[]>`select organization_id from jobs where id = ${jobId}`;
    const [r] = await tx<{ id: string; name: string; template_id: string }[]>`select id, name, template_id from job_rounds where job_id = ${jobId} order by sort_order limit 1`;
    const [c] = await tx<{ id: string }[]>`insert into candidates (organization_id, name, email) values (${job.organization_id}, 'Hana Kim', ${`hana-${id}@e2e.test`}) returning id`;
    const [i] = await tx<{ id: string }[]>`insert into interviews (organization_id, job_id, candidate_id, template_id, round_id, round_name, attempt, secure_token_hash, status, started_at, completed_at)
      values (${job.organization_id}, ${jobId}, ${c.id}, ${r.template_id}, ${r.id}, ${r.name}, 1, ${`hiring-${id}`}, 'report_ready', now() - interval '20 minutes', now()) returning id`;
    await tx`insert into job_candidates (organization_id, job_id, candidate_id) values (${job.organization_id}, ${jobId}, ${c.id})`;
    return { candidateId: c.id, interviewId: i.id };
  });
  expect((await page.request.post(`/api/interviews/${interviewId}/decision`, { data: { decision: "qualified", note: null } })).ok()).toBeTruthy();

  // Candidate profile: hiring progress, then schedule the human round.
  await page.goto(`/candidates/${candidateId}`);
  const progress = page.getByRole("region", { name: "Hiring progress for Backend Engineer" });
  await expect(progress.getByText("Qualified").first()).toBeVisible();
  await expect(progress.getByText("1 of 2 rounds qualified.")).toBeVisible();
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: "test-results/hiring-2-candidate-progress.png", fullPage: true });
  await progress.getByRole("button", { name: "Schedule", exact: true }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByRole("heading", { name: "Schedule Panel" })).toBeVisible();
  await dlg.getByLabel("Meeting link").fill("https://zoom.us/j/987654");
  await dlg.getByText("Rory Recruiter").click();
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: "test-results/hiring-3-schedule-dialog.png", fullPage: true });
  await dlg.getByRole("button", { name: "Schedule interview" }).click();
  await expect(page).toHaveURL(/\/interviews\/human\//);
  await expect(page.getByRole("heading", { name: /Panel: Hana Kim/ })).toBeVisible();
  await expect(page.getByText("Scheduled").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy invite" })).toBeVisible();
  const ics = await page.request.get(page.url().replace("/interviews/human/", "/api/human-interviews/") + "/calendar?for=candidate");
  expect(ics.headers()["content-type"]).toContain("text/calendar");
  expect(await ics.text()).toContain("https://zoom.us/j/987654");

  // Scorecard: rate every skill, recommend Qualified, submit.
  for (const skill of ["Technical skills", "Problem solving", "Communication", "Culture and values fit"]) {
    await page.getByRole("radiogroup", { name: `Rating for ${skill}` }).getByRole("radio", { name: /^4:/ }).click();
  }
  await page.getByRole("button", { name: "Qualified", exact: true }).first().click();
  await page.getByRole("button", { name: "Submit scorecard" }).click();
  await expect(page.getByText("Scorecard submitted")).toBeVisible();
  await expect(page.getByText("Completed").first()).toBeVisible();
  await expect(page.getByText(/1 of 1 interviewer recommend: Qualified/)).toBeVisible();

  // The team's decision for the round.
  const decision = page.locator("section", { has: page.getByRole("heading", { name: "Decision", exact: true }) });
  await decision.getByRole("button", { name: "Qualified", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save decision" }).click();
  await expect(page.getByRole("main").getByText("Marked Qualified")).toBeVisible();
  // Deciding locks the scorecard.
  await expect(page.getByText(/Locked: the round decision was made/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Update scorecard" })).toHaveCount(0);

  // The recruiter is also the interviewer: reopening and editing is allowed, but never hidden.
  await decision.getByRole("button", { name: "Clear" }).click();
  const reopen = page.getByRole("dialog");
  await expect(reopen.getByRole("button", { name: "Reopen round" })).toBeDisabled();
  await reopen.getByLabel("Reason").fill("Second opinion from the hiring manager");
  await reopen.getByRole("button", { name: "Reopen round" }).click();
  await expect(page.getByText("Round reopened")).toBeVisible();
  await page.getByRole("radiogroup", { name: "Rating for Communication" }).getByRole("radio", { name: /^5:/ }).click();
  await page.getByRole("button", { name: "Update scorecard" }).click();
  await expect(page.getByText("Scorecard submitted")).toBeVisible();
  await decision.getByRole("button", { name: "Qualified", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save decision" }).click();
  await expect(page.getByText("Edited after decision")).toBeVisible();
  await expect(page.getByText("Earlier version")).toBeVisible();
  await expect(page.getByText(/Decision reopened \(was Qualified\)/)).toBeVisible();
  await expect(page.getByText(/Scorecard edited after the decision was reopened: ratings or notes changed/)).toBeVisible();
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: "test-results/hiring-8-edited-after-decision.png", fullPage: true });
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: "test-results/hiring-4-human-interview.png", fullPage: true });


  // Back on the profile: every round qualified, shortlist.
  await page.goto(`/candidates/${candidateId}`);
  await expect(progress.getByText("Every round is marked Qualified. Ready to shortlist.")).toBeVisible();
  // The overall result appears once every round is Qualified (built in the background).
  const overall = progress.getByRole("region", { name: "Overall result" });
  await expect(overall).toBeVisible({ timeout: 30_000 });
  await expect(overall.getByText(/2 of 2 rounds Qualified/)).toBeVisible();
  await expect(overall.getByText(/1 of 1 interviewer recommends/)).toBeVisible();
  if (process.env.E2E_SCREENSHOTS) await overall.screenshot({ path: "test-results/hiring-overall-result.png" });
  await progress.getByRole("button", { name: "Shortlist" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Shortlist" }).click();
  await expect(progress.getByText("Shortlisted", { exact: true })).toBeVisible();
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: "test-results/hiring-5-shortlisted.png", fullPage: true });


  // A one-off extra interview for this candidate only.
  await progress.getByRole("button", { name: "Schedule extra interview" }).click();
  const extra = page.getByRole("dialog");
  await expect(extra.getByRole("heading", { name: "Schedule an extra interview" })).toBeVisible();
  await extra.getByLabel("Interview name").fill("Founder chat");
  await extra.getByLabel("Meeting link").fill("https://meet.google.com/abc-defg-hij");
  await extra.getByText("Rory Recruiter").click();
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: "test-results/hiring-7-extra-interview.png", fullPage: true });
  await extra.getByRole("button", { name: "Schedule interview" }).click();
  await expect(page.getByRole("heading", { name: /Founder chat: Hana Kim/ })).toBeVisible();
  await page.goto(`/candidates/${candidateId}`);
  await expect(progress.getByText("Other interviews")).toBeVisible();
  await expect(progress.getByText("Founder chat")).toBeVisible();

  // Job page pipeline.
  await page.goto(`/jobs/${jobId}`);
  const pipeline = page.locator("section", { has: page.getByRole("heading", { name: /^Candidates/ }) });
  await pipeline.getByRole("tab", { name: /Shortlisted/ }).click();
  await expect(pipeline.getByRole("link", { name: /Hana Kim/ })).toBeVisible();
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: "test-results/hiring-6-job-pipeline.png", fullPage: true });

  await pipeline.getByRole("tab", { name: /In progress/ }).click();
  await expect(pipeline.getByText("No candidates in progress.", { exact: false })).toBeVisible();
});
