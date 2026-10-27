import { expect, test } from "@playwright/test";
import path from "node:path";

// Recruiter opens a public application link → applicant applies with a resume →
// AI screening tags the application → recruiter invites the applicant to an interview.
/** Answer the job's questions on the apply page. */
async function answer(ap: import("@playwright/test").Page, ctc: string) {
  await ap.getByLabel(/Expected CTC/).fill(ctc);
  await ap.getByLabel("Notice period").selectOption("30");
  await ap.getByLabel("Do you have a valid work permit?").selectOption("yes");
}

test("public application with AI screening", async ({ page, browser }) => {
  const id = Date.now().toString(36);
  await page.goto("/signup?code=1");
  await page.getByLabel("Full name").fill("Pat Recruiter");
  await page.getByLabel("Work email").fill(`apply-${id}@e2e.test`);
  await page.getByLabel("Company / workspace name").fill(`Apply Co ${id}`);
  await page.getByLabel("Access code").fill(process.env.SIGNUP_ACCESS_CODE ?? "");
  await page.getByLabel("Password").fill(`pw-${id}-${Math.random().toString(36).slice(2)}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/jobs/new");
  await page.getByLabel("Job title").fill("Backend Engineer");
  await page.getByLabel("Job description").fill("We need a backend engineer with 4+ years of Node.js, PostgreSQL and AWS experience. Stripe payments experience is a plus.");
  for (const s of ["Node.js", "PostgreSQL", "AWS"]) {
    await page.getByLabel("Required skills").fill(s);
    await page.getByLabel("Required skills").press("Enter");
  }
  // Application questions: a custom must-have question, and internal hiring limits.
  await page.getByRole("button", { name: "Add question" }).click();
  await page.getByLabel("Question 1", { exact: true }).fill("Do you have a valid work permit?");
  await page.getByLabel("Answer format").selectOption("yes_no");
  await page.getByLabel("Expected answer").selectOption("yes");
  await page.locator("section", { hasText: "Your own questions" }).getByRole("checkbox", { name: "Required" }).last().check();
  await page.getByLabel(/Budget up to/).fill("12");
  await page.getByLabel("Maximum notice period (days)").fill("30");
  if (process.env.E2E_SCREENSHOTS) await page.locator("section", { hasText: "Application questions" }).first().screenshot({ path: "test-results/job-questions.png" });
  if (process.env.E2E_SCREENSHOTS) await page.locator("section", { hasText: "Hiring limits" }).first().screenshot({ path: "test-results/job-limits.png" });
  await page.getByRole("button", { name: "Create job" }).click();
  await expect(page.getByRole("heading", { name: /Backend Engineer/ })).toBeVisible();

  await page.getByRole("switch", { name: "Accept applications" }).click();
  const code = page.locator("code", { hasText: "/apply/" });
  await expect(code).toBeVisible();
  const url = (await code.textContent())!.trim();

  const ctx = await browser.newContext();
  const ap = await ctx.newPage();
  await ap.goto(url);
  await expect(ap.getByRole("heading", { name: "Backend Engineer" })).toBeVisible();
  await ap.getByLabel("Full name").fill("Morgan Applicant");
  await ap.getByLabel("Email").fill(`morgan-${id}@e2e.test`);
  await ap.locator("#ap-resume").setInputFiles(path.join(__dirname, "fixtures/resume.txt"));
  await ap.getByRole("checkbox", { name: /I agree/ }).click();
  // Required questions must be answered, in the right format.
  await ap.getByRole("button", { name: "Submit application" }).click();
  await expect(ap.getByText("Please answer the required questions in the right format.")).toBeVisible();
  await expect(ap.getByText("This answer is required").first()).toBeVisible();
  await answer(ap, "13");
  if (process.env.E2E_SCREENSHOTS) await ap.screenshot({ path: "test-results/apply-questions.png", fullPage: true });
  await ap.getByRole("button", { name: "Submit application" }).click();
  await expect(ap.getByText("Application submitted")).toBeVisible();

  // Same applicant again → friendly duplicate message
  await ap.goto(url);
  await ap.getByLabel("Full name").fill("Morgan Applicant");
  await ap.getByLabel("Email").fill(`morgan-${id}@e2e.test`);
  await ap.locator("#ap-resume").setInputFiles(path.join(__dirname, "fixtures/resume.txt"));
  await ap.getByRole("checkbox", { name: /I agree/ }).click();
  await answer(ap, "13");
  await ap.getByRole("button", { name: "Submit application" }).click();
  await expect(ap.getByText(/already applied/)).toBeVisible();
  // A second applicant within budget.
  await ap.goto(url);
  await ap.getByLabel("Full name").fill("Riley Applicant");
  await ap.getByLabel("Email").fill(`riley-${id}@e2e.test`);
  await ap.locator("#ap-resume").setInputFiles(path.join(__dirname, "fixtures/resume.txt"));
  await ap.getByRole("checkbox", { name: /I agree/ }).click();
  await answer(ap, "11");
  await ap.getByRole("button", { name: "Submit application" }).click();
  await expect(ap.getByText("Application submitted")).toBeVisible();
  await ctx.close();

  await page.reload();
  await expect(page.getByRole("link", { name: "Morgan Applicant" })).toBeVisible();
  // The screening result ("3/4 requirements"), not the job's "Parsed requirements" heading.
  await expect(page.getByText(/^\d+\/\d+ requirements$/).first()).toBeVisible({ timeout: 90_000 });
  // The fit check: 13 LPA against a 12 LPA budget is marked to check; 11 LPA fits.
  const morganRow = page.getByRole("row", { name: /Morgan Applicant/ });
  await expect(morganRow.getByText("Check limits")).toBeVisible();
  await expect(page.getByRole("row", { name: /Riley Applicant/ }).getByText("Fits limits")).toBeVisible();
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: "test-results/applications-fit.png", fullPage: true });
  // Bulk invite: select Riley and invite in one go.
  await page.getByRole("checkbox", { name: "Select Riley Applicant" }).check();
  await page.getByRole("button", { name: "Invite selected to AI interview" }).click();
  await page.getByRole("dialog").getByRole("checkbox").uncheck(); // don't email in tests
  await page.getByRole("dialog").getByRole("button", { name: "Invite" }).click();
  await expect(page.getByRole("row", { name: /Riley Applicant/ }).getByText("Interview invited")).toBeVisible();

  await page.getByRole("link", { name: "Morgan Applicant" }).click();
  await expect(page.getByRole("heading", { name: /AI screening/ })).toBeVisible();
  const answersCard = page.getByRole("region", { name: "Answers and fit" });
  await expect(answersCard.getByText(/Expects 13 LPA, 8% above the budget/)).toBeVisible();
  await expect(answersCard.getByText("Do you have a valid work permit?").first()).toBeVisible();
  if (process.env.E2E_SCREENSHOTS) await answersCard.screenshot({ path: "test-results/answers-card.png" });
  await expect(page.getByRole("cell", { name: /PostgreSQL/ }).first()).toBeVisible();
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: "test-results/application.png", fullPage: true });
  // An application's next step is an interview or "Not moving forward": there's no early Shortlist.
  await expect(page.getByRole("button", { name: "Not moving forward" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Shortlist" })).toHaveCount(0);

  // HR details and notes, added from the application, are the same record on the candidate page.
  const hr = page.getByRole("region", { name: "HR details and notes" });
  await expect(hr.getByText("13 LPA")).toBeVisible(); // filled from the applicant's answers
  await hr.getByRole("button", { name: "Edit details" }).click();
  await hr.getByLabel("Current CTC").fill("8 LPA");
  await hr.getByLabel("Notice period").fill("30 days");
  await hr.getByLabel("Other details").fill("Has another offer; prefers hybrid.");
  await hr.getByRole("button", { name: "Save" }).click();
  await expect(hr.getByText("8 LPA")).toBeVisible();
  await hr.getByLabel("Add a note").fill("HR call done: can join in 30 days.");
  await hr.getByRole("button", { name: "Add note" }).click();
  await expect(hr.getByRole("listitem").filter({ hasText: "HR call done: can join in 30 days." })).toBeVisible();
  await expect(hr.getByLabel("Add a note")).toHaveValue("");
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: "test-results/hr-panel-application.png", fullPage: true });
  const applicationUrl = page.url();
  await page.getByRole("link", { name: /Open candidate profile/ }).click();
  const hr2 = page.getByRole("region", { name: "HR details and notes" });
  await expect(hr2.getByText("8 LPA")).toBeVisible();
  await expect(hr2.getByText("Has another offer; prefers hybrid.")).toBeVisible();
  await expect(hr2.getByRole("listitem").filter({ hasText: "HR call done: can join in 30 days." })).toBeVisible();
  await expect(hr2.getByText("Backend Engineer").first()).toBeVisible(); // tagged with the job
  if (process.env.E2E_SCREENSHOTS) await hr2.screenshot({ path: "test-results/hr-panel-candidate.png" });
  await page.goto(applicationUrl);


  await page.getByRole("button", { name: "Invite to AI interview" }).click();
  await page.getByRole("checkbox").click(); // don't email in tests
  await page.getByRole("button", { name: "Create interview" }).click();
  await expect(page.locator("input[readonly]").first()).toHaveValue(/\/interview\//);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("link", { name: "View interview" })).toBeVisible();
});

test("a wrong access code is turned away", async ({ page }) => {
  await page.goto("/signup?code=1");
  await page.getByLabel("Full name").fill("No Code");
  await page.getByLabel("Work email").fill(`nocode-${Date.now()}@e2e.test`);
  await page.getByLabel("Company / workspace name").fill("No Code Co");
  await page.getByLabel("Access code").fill("not-the-code");
  await page.getByLabel("Password").fill("long-enough-password");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /access code isn.t valid/ })).toBeVisible();
});

test("home page access request form", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Book a demo" }).first()).toHaveAttribute("href", /cal\.com/);
  await expect(page.getByRole("link", { name: /sign in|open app|create a workspace/i })).toHaveCount(0);
  await page.getByLabel("Full name").fill("E2E Requester");
  await page.getByLabel("Work email").fill(`requester-${Date.now()}@e2e.test`);
  await page.getByLabel("Company", { exact: true }).fill("E2E Co");
  await page.getByRole("button", { name: "Request access" }).click();
  await expect(page.getByText("Thanks, we've received your request")).toBeVisible();
});
