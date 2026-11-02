import { expect, test, type Browser, type Page } from "@playwright/test";
import { rm } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

// Seeds a demo workspace through the real app (`npm run db:seed`): a recruiter
// account, three jobs, seven candidates, and three finished AI interviews with
// recorded video, transcripts and reports. Run the app with AI_PROVIDER=mock.
// Data goes into whatever DATABASE_URL the running app uses.

export const DEMO = {
  name: "Demo Recruiter",
  email: process.env.SEED_EMAIL ?? "demo@pickmyhire.test",
  password: process.env.SEED_PASSWORD ?? "Demo@12345",
  company: "PickMyHire Demo",
};

type Candidate = { name: string; email: string; resume: string; answers?: string[] };
type Job = { title: string; description: string; skills: string[]; candidates: Candidate[] };

const resume = (name: string, title: string, lines: string[]) => [name, title, "", "Experience", ...lines.map((l) => `- ${l}`)].join("\n");

const JOBS: Job[] = [
  {
    title: "Senior Full Stack Engineer",
    description: "We need a senior engineer with 5+ years of React, Node.js and PostgreSQL experience to own our hiring platform end to end. AWS experience is a plus.",
    skills: ["React", "Node.js", "PostgreSQL"],
    candidates: [
      {
        name: "Aarav Sharma",
        email: "aarav.sharma@example.com",
        resume: resume("Aarav Sharma", "Senior Software Engineer, 7 years", [
          "Tech lead at Razorleaf Payments (2021 - Present): built a Node.js payments platform on AWS handling 2M transactions a month",
          "Cut p95 API latency 40% through PostgreSQL query tuning and caching",
          "Software Engineer at Brightwave (2017 - 2021): React and TypeScript dashboards for 5,000 users",
        ]),
        answers: [
          "I'm a senior engineer with seven years of experience. For the last three years I've led the payments team at Razorleaf, where I own a Node.js and PostgreSQL platform on AWS that handles about two million transactions a month.",
          "The hardest problem was duplicate charges during peak traffic. I traced it to a race condition in our webhook handler, added idempotency keys and moved processing onto a queue. Duplicates went to zero and latency dropped forty percent.",
          "On the frontend I work mostly in React with TypeScript. I care about keeping state close to where it's used, measuring performance before optimising, and writing components that are easy to test.",
          "For PostgreSQL I start with EXPLAIN ANALYZE, look for sequential scans and missing indexes, and check whether the query shape matches how the data is actually read. Last year that took our slowest report from twelve seconds to under one.",
          "I'm looking for a product team where engineers own features end to end. Your hiring platform is exactly that kind of problem, and I'd like to bring my payments reliability experience to it.",
        ],
      },
      {
        name: "Neha Gupta",
        email: "neha.gupta@example.com",
        resume: resume("Neha Gupta", "Full Stack Developer, 3 years", [
          "Developer at Nimbus Apps (2022 - Present): React frontends and Express APIs",
          "Built an internal booking tool used by 200 staff",
        ]),
        answers: [
          "I'm a full stack developer with about three years of experience, mostly React on the frontend and Express on the backend.",
          "I built a booking tool for our office. It was mostly forms and a calendar view. Some parts were tricky but I got it working with help from my team.",
          "I use React hooks and sometimes Redux. I haven't done much performance work yet but I'd like to learn.",
          "I've used PostgreSQL through an ORM. I haven't written many raw queries or looked at query plans myself.",
          "I want to grow into a senior role and work on bigger systems.",
        ],
      },
      {
        name: "Kabir Mehta",
        email: "kabir.mehta@example.com",
        resume: resume("Kabir Mehta", "Backend Engineer, 5 years", ["Backend Engineer at Quanta Logistics: Node.js microservices and PostgreSQL"]),
      },
    ],
  },
  {
    title: "Product Designer",
    description: "We're hiring a product designer with 3+ years of experience in user research, interaction design and design systems for a B2B SaaS product.",
    skills: ["Figma", "User research", "Design systems"],
    candidates: [
      {
        name: "Ananya Iyer",
        email: "ananya.iyer@example.com",
        resume: resume("Ananya Iyer", "Product Designer, 5 years", [
          "Senior Product Designer at Loop CRM (2022 - Present): led the redesign of the onboarding flow, +22% activation",
          "Built and maintained the company design system in Figma",
        ]),
        answers: [
          "I'm a product designer with five years in B2B SaaS. At Loop CRM I lead design for onboarding and own our Figma design system.",
          "Our onboarding had a big drop-off at the data import step. I ran eight user interviews, found people didn't trust the import, and redesigned it with a preview and undo. Activation went up twenty two percent.",
          "I keep the design system small: tokens first, then a handful of well-documented components. I review changes with engineers every two weeks so design and code don't drift.",
          "When research and stakeholder opinions disagree, I bring the clips from the sessions into the review. Seeing a real user struggle usually settles it faster than any argument.",
          "I want to work on a product where design has a seat at the table early, and hiring tools affect a lot of people's careers, which I find meaningful.",
        ],
      },
      {
        name: "Vikram Rao",
        email: "vikram.rao@example.com",
        resume: resume("Vikram Rao", "UX Designer, 2 years", ["UX Designer at Pixelcraft Studio: mobile app wireframes and prototypes"]),
      },
    ],
  },
  {
    title: "Data Analyst",
    description: "Looking for a data analyst with strong SQL and dashboarding skills to turn hiring funnel data into insights for customers.",
    skills: ["SQL", "Python", "Power BI"],
    candidates: [
      {
        name: "Priya Nair",
        email: "priya.nair@example.com",
        resume: resume("Priya Nair", "Data Analyst, 4 years", ["Analyst at Finlytics: SQL, Python and Power BI reporting for 30 clients"]),
      },
      {
        name: "Arjun Verma",
        email: "arjun.verma@example.com",
        resume: resume("Arjun Verma", "Junior Analyst, 1 year", ["Junior Analyst at Retailio: Excel and SQL reports"]),
      },
    ],
  },
];

test.describe.configure({ mode: "serial" });

/** Runs SQL in system context (bypasses tenant isolation), like the app's withSystem. */
async function system<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    return (await sql.begin(async (tx) => {
      await tx`select set_config('app.system', 'on', true)`;
      return fn(tx);
    })) as T;
  } finally {
    await sql.end();
  }
}

/** Organizations owned by the demo account. */
const demoOrgs = (tx: postgres.TransactionSql) => tx<{ id: string }[]>`
  select m.organization_id as id from organization_members m join users u on u.id = m.user_id
  where u.email = ${DEMO.email} and m.role = 'owner'`;

/** SEED_RESET=1: removes the demo account, its workspace and its stored files. */
async function resetDemo() {
  const orgs = await system(async (tx) => {
    const orgs = await demoOrgs(tx);
    for (const o of orgs) await tx`delete from organizations where id = ${o.id}`;
    await tx`delete from users where email = ${DEMO.email}`;
    return orgs;
  });
  const dir = path.resolve(process.env.LOCAL_STORAGE_DIR ?? "./.storage");
  for (const o of orgs) await rm(path.join(dir, o.id), { recursive: true, force: true });
  if (orgs.length) console.log(`  reset: removed ${orgs.length} demo workspace(s)`);
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(DEMO.email);
  await page.getByLabel("Password").fill(DEMO.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function fillIfPresent(page: Page, label: RegExp | string, value: string) {
  const field = page.getByRole("dialog").getByLabel(label);
  if (await field.count()) {
    const tag = await field.first().evaluate((el) => el.tagName);
    if (tag === "SELECT") await field.first().selectOption({ index: 1 });
    else await field.first().fill(value);
  }
}

/** Invites a candidate from the open job page and returns the interview link. */
async function invite(page: Page, c: Candidate) {
  await page.getByRole("button", { name: "Invite candidate" }).click();
  await page.getByLabel("Full name").fill(c.name);
  await page.getByRole("textbox", { name: "Email" }).fill(c.email);
  await page.locator("#inv-file").setInputFiles({ name: `${c.name.replace(/ /g, "_")}_resume.txt`, mimeType: "text/plain", buffer: Buffer.from(c.resume) });
  await fillIfPresent(page, /Expected CTC/, "18");
  await fillIfPresent(page, "Notice period", "");
  await page.getByRole("button", { name: "Send invitation" }).click();
  const linkInput = page.locator("input[readonly]").first();
  await expect(linkInput).toHaveValue(/\/interview\//);
  const link = await linkInput.inputValue();
  await page.getByRole("button", { name: "Done" }).click();
  return link;
}

/** Takes the interview as the candidate, typing the prepared answers (demo AI mode). */
async function takeInterview(browser: Browser, link: string, answers: string[]) {
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"] });
  const cand = await ctx.newPage();
  await cand.goto(link);
  await cand.getByRole("link", { name: "Get started" }).click();
  await cand.getByRole("checkbox").click();
  await cand.getByRole("button", { name: /I agree/ }).click();
  await expect(cand).toHaveURL(/device-check/);
  await expect(cand.getByText(/We can hear you/)).toBeVisible({ timeout: 30_000 });
  await expect(cand.getByText("Test recording worked")).toBeVisible({ timeout: 20_000 });
  await expect(cand.getByText(/Photo taken/)).toBeVisible({ timeout: 60_000 });
  await cand.getByRole("button", { name: "I heard it" }).click();
  await expect(cand.getByText(/being prepared/)).toBeHidden({ timeout: 60_000 });
  await cand.getByRole("button", { name: "Continue to interview" }).click();
  await expect(cand).toHaveURL(/session/);
  await cand.getByRole("button", { name: "Start interview" }).click();

  for (let turn = 0; turn < 25; turn++) {
    const box = cand.locator("#typed");
    await Promise.race([box.waitFor({ state: "visible", timeout: 60_000 }), cand.waitForURL(/completed/, { timeout: 60_000 })]).catch(() => {});
    if (cand.url().includes("/completed")) break;
    await box.fill(answers[turn % answers.length]);
    await cand.getByRole("button", { name: "Done answering" }).click();
    await expect(box).toBeHidden();
  }
  await expect(cand).toHaveURL(/completed/, { timeout: 180_000 });
  await ctx.close();
}

test("seed demo workspace", async ({ page, browser }) => {
  test.setTimeout(30 * 60_000);

  if (process.env.SEED_RESET) await resetDemo();

  // Refuse to seed twice: the account is the marker.
  await page.goto("/login");
  await page.getByLabel("Work email").fill(DEMO.email);
  await page.getByLabel("Password").fill(DEMO.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  const loggedIn = await page.waitForURL(/\/dashboard/, { timeout: 8_000 }).then(() => true, () => false);
  if (loggedIn) throw new Error(`${DEMO.email} already exists — demo data is already seeded. Run with SEED_RESET=1 to start over.`);

  await page.goto("/signup?code=1");
  await page.getByLabel("Full name").fill(DEMO.name);
  await page.getByLabel("Work email").fill(DEMO.email);
  await page.getByLabel("Company / workspace name").fill(DEMO.company);
  await page.getByLabel("Access code").fill(process.env.SIGNUP_ACCESS_CODE ?? "");
  await page.getByLabel("Password").fill(DEMO.password);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // A demo workspace gets unlimited interviews (new workspaces start with a small free quota).
  await system(async (tx) => {
    for (const o of await demoOrgs(tx)) await tx`update organizations set interview_quota = null where id = ${o.id}`;
    await tx`update users set email_verified_at = coalesce(email_verified_at, now()) where email = ${DEMO.email}`;
  });

  for (const job of JOBS) {
    await page.goto("/jobs/new");
    await page.getByLabel("Job title").fill(job.title);
    await page.getByLabel("Job description").fill(job.description);
    for (const s of job.skills) {
      await page.getByLabel("Required skills").fill(s);
      await page.getByLabel("Required skills").press("Enter");
    }
    await page.getByLabel("Round 1 template").selectOption({ label: "Quick Screening (15 min) · 15 min" });
    await page.getByRole("button", { name: "Create job" }).click();
    await expect(page.getByRole("heading", { name: new RegExp(job.title) })).toBeVisible();
    const jobUrl = page.url();

    for (const c of job.candidates) {
      const link = await invite(page, c);
      if (c.answers) {
        console.log(`  interviewing ${c.name}…`);
        await takeInterview(browser, link, c.answers);
        await page.goto(jobUrl);
      }
      console.log(`  ✓ ${job.title}: ${c.name}${c.answers ? " (interview + video)" : " (invited)"}`);
    }
  }

  // Wait for the reports of the finished interviews.
  const finished = JOBS.flatMap((j) => j.candidates).filter((c) => c.answers).length;
  await expect.poll(() => system(async (tx) => {
    const [r] = await tx<{ n: number }[]>`select count(*)::int as n from interviews i join organizations o on o.id = i.organization_id
      where o.id in (select id from (${demoOrgs(tx)}) d) and i.status = 'report_ready'`;
    return r.n;
  }), { timeout: 180_000, message: "reports of the finished interviews" }).toBe(finished);
  await login(page);
});
