import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSystem } from "@/lib/database/db";
import { addNote, deleteNote, getHrPanel, HrDetailsSchema, saveHrDetails, updateNote } from "@/lib/services/candidate-notes";

// HR details and notes against the local database, with a throwaway company.
const id = Date.now().toString(36);
let orgId = "", otherOrg = "", candidateId = "", jobId = "";
const users: string[] = [];

beforeAll(async () => {
  await withSystem(async (tx) => {
    const [o] = await tx<{ id: string }[]>`insert into organizations (name, slug) values (${`Notes Co ${id}`}, ${`notes-co-${id}`}) returning id`;
    const [o2] = await tx<{ id: string }[]>`insert into organizations (name, slug) values (${`Other ${id}`}, ${`notes-other-${id}`}) returning id`;
    orgId = o.id; otherOrg = o2.id;
    for (const name of ["Rita Recruiter", "Hari HR"]) {
      const [u] = await tx<{ id: string }[]>`insert into users (email, name, password_hash) values (${`${users.length}-${id}@notes.test`}, ${name}, 'x') returning id`;
      users.push(u.id);
      await tx`insert into organization_members (organization_id, user_id, role) values (${orgId}, ${u.id}, 'recruiter')`;
    }
    const [j] = await tx<{ id: string }[]>`insert into jobs (organization_id, title, status) values (${orgId}, 'Sr. SEO Executive', 'active') returning id`;
    jobId = j.id;
    const [c] = await tx<{ id: string }[]>`insert into candidates (organization_id, name, email) values (${orgId}, 'Diya', ${`diya-${id}@notes.test`}) returning id`;
    candidateId = c.id;
  });
});

afterAll(async () => {
  await withSystem(async (tx) => {
    await tx`delete from organizations where id = any(${[orgId, otherOrg]})`;
    await tx`delete from users where id = any(${users})`;
  });
});

describe("HR details and notes", () => {
  it("keeps one HR record per candidate, and updates it in place", async () => {
    await saveHrDetails(orgId, users[0], candidateId, HrDetailsSchema.parse({ current_ctc: "8 LPA", expected_ctc: "11 LPA", notice_period: "30 days", joining_date: "2026-12-01", open_to_relocation: true }));
    await saveHrDetails(orgId, users[1], candidateId, HrDetailsSchema.parse({ current_ctc: "8 LPA", expected_ctc: "12 LPA", other_details: "Has another offer" }));
    const { details } = await getHrPanel(orgId, candidateId);
    expect(details).toMatchObject({ expected_ctc: "12 LPA", notice_period: null, joining_date: null, other_details: "Has another offer", updated_by_name: "Hari HR" });
    // Empty fields are stored as empty, not as blank strings.
    expect(HrDetailsSchema.parse({ current_ctc: "  " }).current_ctc).toBeNull();
  });

  it("shares notes everywhere, tagged with the job they were written from", async () => {
    await addNote(orgId, users[0], candidateId, { body: "HR call done: can join in 30 days.", job_id: jobId });
    await addNote(orgId, users[1], candidateId, { body: "Prefers hybrid." });
    const { notes } = await getHrPanel(orgId, candidateId);
    expect(notes.map((n) => [n.body, n.job_title, n.author_name])).toEqual([
      ["Prefers hybrid.", null, "Hari HR"],
      ["HR call done: can join in 30 days.", "Sr. SEO Executive", "Rita Recruiter"],
    ]);
  });

  it("lets only the author change or delete a note", async () => {
    const { notes } = await getHrPanel(orgId, candidateId);
    const ritas = notes.find((n) => n.author_name === "Rita Recruiter")!;
    await expect(updateNote(orgId, users[1], candidateId, ritas.id, "changed")).rejects.toMatchObject({ status: 403 });
    await expect(deleteNote(orgId, users[1], candidateId, ritas.id)).rejects.toMatchObject({ status: 403 });
    await updateNote(orgId, users[0], candidateId, ritas.id, "HR call done: can join in 45 days.");
    expect((await getHrPanel(orgId, candidateId)).notes.find((n) => n.id === ritas.id)?.body).toBe("HR call done: can join in 45 days.");
    await deleteNote(orgId, users[0], candidateId, ritas.id);
    expect((await getHrPanel(orgId, candidateId)).notes).toHaveLength(1);
  });

  it("keeps companies apart", async () => {
    expect(await getHrPanel(otherOrg, candidateId)).toEqual({ details: null, notes: [] });
    await expect(addNote(otherOrg, users[0], candidateId, { body: "x" })).rejects.toMatchObject({ status: 404 });
    await expect(saveHrDetails(otherOrg, users[0], candidateId, HrDetailsSchema.parse({}))).rejects.toMatchObject({ status: 404 });
  });

  it("removes everything with the candidate", async () => {
    await withSystem((tx) => tx`delete from candidates where id = ${candidateId}`);
    const left = await withSystem((tx) => tx`select (select count(*) from candidate_notes where candidate_id = ${candidateId})::int as n,
      (select count(*) from candidate_hr_details where candidate_id = ${candidateId})::int as d`);
    expect(left[0]).toEqual({ n: 0, d: 0 });
  });
});
