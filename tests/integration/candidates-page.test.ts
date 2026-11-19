import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { json, withSystem } from "@/lib/database/db";
import { DEFAULT_TEMPLATES } from "@/lib/interview/default-templates";
import { archiveCandidate, restoreCandidate } from "@/lib/services/candidate-archive";
import { listCandidatePage } from "@/lib/services/candidate-list";
import { getMatch, matchCandidate } from "@/lib/services/candidate-match";
import { cancelInterview, createInterview } from "@/lib/services/interviews";
import { setStage } from "@/lib/services/pipeline";
import { saveRounds } from "@/lib/services/rounds";
import { insertTemplate } from "@/lib/services/templates";

// The Candidates page: job and stage filters, archive (by hand and automatic), and the resume-vs-job check.
// AI runs in mock mode here (vitest.config sets AI_PROVIDER=mock).
const id = Date.now().toString(36);
let orgId = "", owner = "", bde = "", eng = "";
const people: Record<string, string> = {};

const profile = (skills: string[], roles: { title: string; start: string | null; end: string | null }[]) => ({
  name: null, headline: null, years_experience: null, skills, companies: [], projects: [], responsibilities: [], achievements: [],
  education: [], certifications: [], uncertainties: [], roles: roles.map((r) => ({ ...r, company: "Acme", highlights: [] })),
});
async function person(name: string, p: ReturnType<typeof profile>, months: number | null) {
  const [c] = await withSystem((tx) => tx<{ id: string }[]>`
    insert into candidates (organization_id, name, email, resume_file_path, resume_text, parsed_profile, parse_status, experience_months)
    values (${orgId}, ${name}, ${`${name.split(" ")[0].toLowerCase()}-${id}@cands.test`}, 'test/resume.pdf', ${`Resume of ${name}. Skills: ${p.skills.join(", ")}.`}, ${json(p)}, 'completed', ${months})
    returning id`);
  people[name] = c.id;
  return c.id;
}
const page = (o: Parameters<typeof listCandidatePage>[1] = {}) => listCandidatePage(orgId, o);
const names = (r: Awaited<ReturnType<typeof page>>) => r.rows.map((x) => x.name).sort();

beforeAll(async () => {
  await withSystem(async (tx) => {
    const [o] = await tx<{ id: string }[]>`insert into organizations (name, slug, interview_quota) values (${`Cands Co ${id}`}, ${`cands-co-${id}`}, null) returning id`;
    orgId = o.id;
    const [u] = await tx<{ id: string }[]>`insert into users (email, name, password_hash) values (${`owner-${id}@cands.test`}, 'Owner', 'x') returning id`;
    owner = u.id;
    await tx`insert into organization_members (organization_id, user_id, role) values (${orgId}, ${owner}, 'owner')`;
    for (const [i, t] of DEFAULT_TEMPLATES.entries()) await insertTemplate(tx, orgId, owner, t, i === 0);
    const [tpl] = await tx<{ id: string }[]>`select id from interview_templates where organization_id = ${orgId} order by created_at limit 1`;
    const [a] = await tx<{ id: string }[]>`insert into jobs (organization_id, title, status, required_skills) values (${orgId}, 'BDE', 'active', ${["Sales", "Negotiation", "CRM"]}) returning id`;
    const [b] = await tx<{ id: string }[]>`insert into jobs (organization_id, title, status, required_skills) values (${orgId}, 'AI Engineer', 'active', ${["Python", "PyTorch"]}) returning id`;
    bde = a.id; eng = b.id;
    await saveRounds(tx, orgId, bde, [{ name: "Screening", kind: "ai", template_id: tpl.id }]);
    await saveRounds(tx, orgId, eng, [{ name: "Screening", kind: "ai", template_id: tpl.id }]);
  });
  await person("Sam Seller", profile(["Sales", "Negotiation", "CRM"], [{ title: "BDE", start: "Jan 2020", end: "Present" }]), 70);
  await person("Ivy Infer", profile(["Python", "PyTorch"], [{ title: "ML Engineer", start: "2019", end: "2023" }]), 48);
  await person("Nia New", profile(["Excel"], []), null);
  await createInterview(orgId, owner, { jobId: bde, candidateId: people["Sam Seller"], sendInvite: false });
  await createInterview(orgId, owner, { jobId: eng, candidateId: people["Ivy Infer"], sendInvite: false });
});
afterAll(async () => {
  const clean = () => withSystem(async (tx) => {
    await tx`delete from organizations where id = ${orgId}`;
    await tx`delete from users where id = ${owner}`;
  });
  await clean().catch(async () => { await new Promise((r) => setTimeout(r, 300)); await clean(); });
});

describe("candidates page", () => {
  it("shows everyone with their job and interview stage, with counts per stage and job", async () => {
    const all = await page();
    expect(names(all)).toEqual(["Ivy Infer", "Nia New", "Sam Seller"]);
    expect(all.byStage).toMatchObject({ invited: 2, not_invited: 1, completed: 0 });
    expect(all.rows.find((r) => r.name === "Sam Seller")).toMatchObject({ job_title: "BDE", stage: "invited", interview_status: "created" });
    expect(all.jobs.map((j) => [j.title, j.n]).sort()).toEqual([["AI Engineer", 1], ["BDE", 1]]);
  });

  it("filters by job, stage and search, and sorts by experience", async () => {
    expect(names(await page({ jobId: bde }))).toEqual(["Sam Seller"]);
    expect(names(await page({ stage: "not_invited" }))).toEqual(["Nia New"]);
    expect(names(await page({ q: "pytorch" }))).toEqual(["Ivy Infer"]);
    expect((await page({ sort: "experience" })).rows.map((r) => r.name)).toEqual(["Sam Seller", "Ivy Infer", "Nia New"]);
  });

  it("follows the interview: a finished one counts as Completed, a cancelled one as Not invited", async () => {
    await withSystem((tx) => tx`update interviews set status = 'report_ready', completed_at = now() where candidate_id = ${people["Sam Seller"]}`);
    expect((await page({ stage: "completed" })).rows.map((r) => r.name)).toEqual(["Sam Seller"]);
    const [{ id: iv }] = await withSystem((tx) => tx<{ id: string }[]>`select id from interviews where candidate_id = ${people["Ivy Infer"]}`);
    await cancelInterview(orgId, owner, iv);
    expect((await page({ jobId: eng })).rows[0]).toMatchObject({ stage: "not_invited", interview_status: "cancelled" });
  });

  it("checks a resume against a job: a sales resume fits BDE, an AI one doesn't", async () => {
    const good = await matchCandidate(orgId, people["Sam Seller"], bde);
    const bad = await matchCandidate(orgId, people["Ivy Infer"], bde);
    expect(good).toMatchObject({ status: "completed", source: "candidate", met: 3, total: 3 });
    expect(bad).toMatchObject({ status: "completed", met: 0, total: 3 });
    expect(bad!.level).not.toBe(good!.level);
    expect((await page({ jobId: bde })).rows[0]).toMatchObject({ name: "Sam Seller", match_met: 3, match_total: 3 });
    expect(await getMatch(orgId, people["Nia New"], bde)).toBeNull();
  });

  it("archives by hand with a reason, and restores", async () => {
    await archiveCandidate(orgId, owner, people["Nia New"], "Budget");
    expect(names(await page())).not.toContain("Nia New");
    const arch = await page({ archived: true });
    expect(arch.rows.map((r) => [r.name, r.archived_reason])).toEqual([["Nia New", "Budget"]]);
    expect(arch.archivedCount).toBe(1);
    await restoreCandidate(orgId, owner, people["Nia New"]);
    expect(names(await page())).toContain("Nia New");
  });

  it("archives automatically when rejected in every job, and brings them back if that changes", async () => {
    const sam = people["Sam Seller"];
    await setStage(orgId, owner, { jobId: bde, candidateId: sam, stage: "rejected", note: "Not a fit" });
    expect((await page({ archived: true })).rows.map((r) => [r.name, r.archived_reason])).toEqual([["Sam Seller", "Rejected"]]);
    await setStage(orgId, owner, { jobId: bde, candidateId: sam, stage: "in_progress" });
    expect(names(await page({ archived: true }))).toEqual([]);
  });

  it("a hand-archived candidate stays archived when stages change, until invited again", async () => {
    const ivy = people["Ivy Infer"];
    await archiveCandidate(orgId, owner, ivy, "Location");
    await setStage(orgId, owner, { jobId: eng, candidateId: ivy, stage: "in_progress" });
    expect(names(await page({ archived: true }))).toEqual(["Ivy Infer"]);
    await createInterview(orgId, owner, { jobId: eng, candidateId: ivy, sendInvite: false });
    expect(names(await page({ archived: true }))).toEqual([]);
  });
});
