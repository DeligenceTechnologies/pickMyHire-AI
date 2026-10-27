import "server-only";
// HR details (CTC, notice period, …) and the team's notes on a candidate. One
// shared record per candidate, shown on both the application page and the
// candidate page. Only roles that can see candidates see it, and it is never
// sent to the AI.

import { z } from "zod";
import { withOrg } from "@/lib/database/db";
import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api";

const text = (max: number) => z.string().trim().max(max).transform((s) => s || null).nullable().default(null);

export const HrDetailsSchema = z.object({
  current_ctc: text(80),
  expected_ctc: text(80),
  notice_period: text(80),
  joining_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  current_location: text(120),
  open_to_relocation: z.boolean().nullable().default(null),
  other_details: text(4000),
});
export type HrDetails = z.infer<typeof HrDetailsSchema>;

export const NoteSchema = z.object({ body: z.string().trim().min(1, "Write a note first").max(4000), job_id: z.string().uuid().nullable().optional() });

export type CandidateNote = { id: string; body: string; job_id: string | null; job_title: string | null; author_id: string | null; author_name: string | null; created_at: Date; updated_at: Date };
export type HrPanel = { details: (HrDetails & { updated_at: Date; updated_by_name: string | null }) | null; notes: CandidateNote[] };

export async function getHrPanel(orgId: string, candidateId: string): Promise<HrPanel> {
  return withOrg(orgId, async (tx) => {
    const [details] = await tx<(HrDetails & { updated_at: Date; updated_by_name: string | null })[]>`
      select d.current_ctc, d.expected_ctc, d.notice_period, to_char(d.joining_date, 'YYYY-MM-DD') as joining_date, d.current_location,
        d.open_to_relocation, d.other_details, d.updated_at, u.name as updated_by_name
      from candidate_hr_details d left join users u on u.id = d.updated_by
      where d.candidate_id = ${candidateId} and d.organization_id = ${orgId}`;
    const notes = await tx<CandidateNote[]>`
      select n.id, n.body, n.job_id, j.title as job_title, n.author_id, u.name as author_name, n.created_at, n.updated_at
      from candidate_notes n left join jobs j on j.id = n.job_id left join users u on u.id = n.author_id
      where n.candidate_id = ${candidateId} and n.organization_id = ${orgId} order by n.created_at desc`;
    return { details: details ?? null, notes };
  });
}

async function assertCandidate(tx: Parameters<Parameters<typeof withOrg>[1]>[0], orgId: string, candidateId: string) {
  const [c] = await tx`select 1 from candidates where id = ${candidateId} and organization_id = ${orgId}`;
  if (!c) throw new ApiError(404, "Candidate not found");
}

export async function saveHrDetails(orgId: string, userId: string, candidateId: string, input: HrDetails) {
  await withOrg(orgId, async (tx) => {
    await assertCandidate(tx, orgId, candidateId);
    await tx`
      insert into candidate_hr_details (candidate_id, organization_id, current_ctc, expected_ctc, notice_period, joining_date, current_location, open_to_relocation, other_details, updated_by)
      values (${candidateId}, ${orgId}, ${input.current_ctc}, ${input.expected_ctc}, ${input.notice_period}, ${input.joining_date}, ${input.current_location},
        ${input.open_to_relocation}, ${input.other_details}, ${userId})
      on conflict (candidate_id) do update set current_ctc = excluded.current_ctc, expected_ctc = excluded.expected_ctc, notice_period = excluded.notice_period,
        joining_date = excluded.joining_date, current_location = excluded.current_location, open_to_relocation = excluded.open_to_relocation,
        other_details = excluded.other_details, updated_by = excluded.updated_by`;
    // Values aren't copied into the audit log: salary details stay in one place.
    await audit(tx, { orgId, userId, action: "candidate.hr_details_updated", entityType: "candidate", entityId: candidateId });
  });
}

export async function addNote(orgId: string, userId: string, candidateId: string, input: z.infer<typeof NoteSchema>) {
  return withOrg(orgId, async (tx) => {
    await assertCandidate(tx, orgId, candidateId);
    if (input.job_id) {
      const [j] = await tx`select 1 from jobs where id = ${input.job_id} and organization_id = ${orgId}`;
      if (!j) throw new ApiError(404, "Job not found");
    }
    const [n] = await tx<{ id: string }[]>`
      insert into candidate_notes (organization_id, candidate_id, job_id, author_id, body)
      values (${orgId}, ${candidateId}, ${input.job_id ?? null}, ${userId}, ${input.body}) returning id`;
    await audit(tx, { orgId, userId, action: "candidate.note_added", entityType: "candidate", entityId: candidateId, metadata: { note_id: n.id } });
    return { id: n.id };
  });
}

/** Notes can be edited or deleted only by the person who wrote them. */
async function ownNote(tx: Parameters<Parameters<typeof withOrg>[1]>[0], orgId: string, userId: string, candidateId: string, noteId: string) {
  const [n] = await tx<{ author_id: string | null }[]>`
    select author_id from candidate_notes where id = ${noteId} and candidate_id = ${candidateId} and organization_id = ${orgId} for update`;
  if (!n) throw new ApiError(404, "Note not found");
  if (n.author_id !== userId) throw new ApiError(403, "You can only change your own notes.");
}

export async function updateNote(orgId: string, userId: string, candidateId: string, noteId: string, body: string) {
  await withOrg(orgId, async (tx) => {
    await ownNote(tx, orgId, userId, candidateId, noteId);
    await tx`update candidate_notes set body = ${body} where id = ${noteId}`;
    await audit(tx, { orgId, userId, action: "candidate.note_updated", entityType: "candidate", entityId: candidateId, metadata: { note_id: noteId } });
  });
}

export async function deleteNote(orgId: string, userId: string, candidateId: string, noteId: string) {
  await withOrg(orgId, async (tx) => {
    await ownNote(tx, orgId, userId, candidateId, noteId);
    await tx`delete from candidate_notes where id = ${noteId}`;
    await audit(tx, { orgId, userId, action: "candidate.note_deleted", entityType: "candidate", entityId: candidateId, metadata: { note_id: noteId } });
  });
}
