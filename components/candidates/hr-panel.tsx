"use client";

import { useState } from "react";
import { Loader2, Lock, NotebookPen, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { useAction } from "@/lib/client/use-action";
import { formatDate } from "@/lib/format";
import type { HrDetails, HrPanel as HrPanelData } from "@/lib/services/candidate-notes";

const selectClass = "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const EMPTY: HrDetails = { current_ctc: null, expected_ctc: null, notice_period: null, joining_date: null, current_location: null, open_to_relocation: null, other_details: null };
const FIELDS: { key: Exclude<keyof HrDetails, "other_details">; label: string; placeholder?: string }[] = [
  { key: "current_ctc", label: "Current CTC", placeholder: "e.g. 12 LPA" },
  { key: "expected_ctc", label: "Expected CTC", placeholder: "e.g. 16 LPA" },
  { key: "notice_period", label: "Notice period", placeholder: "e.g. 30 days, serving" },
  { key: "joining_date", label: "Earliest joining date" },
  { key: "current_location", label: "Current location", placeholder: "e.g. Pune" },
  { key: "open_to_relocation", label: "Open to relocation" },
];

function shown(d: HrDetails, key: keyof HrDetails) {
  const v = d[key];
  if (v == null || v === "") return null;
  if (key === "open_to_relocation") return v ? "Yes" : "No";
  if (key === "joining_date") return formatDate(`${v}T00:00:00`);
  return String(v);
}

/**
 * HR details and the team's notes for a candidate. The same record appears on the
 * application page and the candidate page; a note added from an application is
 * tagged with that job.
 */
export function HrPanel({ candidateId, data, currentUserId, canEdit, jobId, jobTitle }: {
  candidateId: string; data: HrPanelData; currentUserId: string; canEdit: boolean; jobId?: string; jobTitle?: string;
}) {
  const { run, pending } = useAction();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<HrDetails>(EMPTY);
  const [note, setNote] = useState("");
  const [editNote, setEditNote] = useState<{ id: string; body: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const d = data.details ?? EMPTY;
  const hasDetails = FIELDS.some((f) => shown(d, f.key)) || !!d.other_details;
  const set = <K extends keyof HrDetails>(k: K, v: HrDetails[K]) => setForm((p) => ({ ...p, [k]: v }));
  const base = `/api/candidates/${candidateId}`;

  return (
    <section className="@container rounded-xl border bg-card" aria-labelledby="hr-title">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3.5">
        <h2 id="hr-title" className="flex items-center gap-2 font-semibold"><NotebookPen className="size-4 text-primary" /> HR details and notes</h2>
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Lock className="size-3" /> Owner, Admin and Recruiter only</span>
      </div>

      <div className="space-y-4 border-b p-5">
        {editing ? (
          <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run("hr", `${base}/hr`, { method: "PUT", body: form, success: "HR details saved" });
            if (ok) setEditing(false);
          }}>
            <div className="grid gap-3 @md:grid-cols-2">
              {FIELDS.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={`hr-${f.key}`}>{f.label}</Label>
                  {f.key === "open_to_relocation" ? (
                    <select id="hr-open_to_relocation" className={selectClass} value={form.open_to_relocation == null ? "" : form.open_to_relocation ? "yes" : "no"}
                      onChange={(e) => set("open_to_relocation", e.target.value === "" ? null : e.target.value === "yes")}>
                      <option value="">Not set</option><option value="yes">Yes</option><option value="no">No</option>
                    </select>
                  ) : f.key === "joining_date" ? (
                    <Input id="hr-joining_date" type="date" value={form.joining_date ?? ""} onChange={(e) => set("joining_date", e.target.value || null)} />
                  ) : (
                    <Input id={`hr-${f.key}`} maxLength={f.key === "current_location" ? 120 : 80} placeholder={f.placeholder} value={(form[f.key] as string | null) ?? ""} onChange={(e) => set(f.key, e.target.value)} />
                  )}
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hr-other">Other details</Label>
              <Textarea id="hr-other" rows={3} maxLength={4000} placeholder="Anything else: other offers, preferred work mode, availability…" value={form.other_details ?? ""} onChange={(e) => set("other_details", e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)} disabled={!!pending}>Cancel</Button>
              <Button type="submit" size="sm" disabled={!!pending}>{pending === "hr" && <Loader2 className="animate-spin" />}Save</Button>
            </div>
          </form>
        ) : (
          <>
            {hasDetails ? (
              <dl className="grid gap-x-6 gap-y-3 text-sm @md:grid-cols-2">
                {FIELDS.map((f) => (
                  <div key={f.key}><dt className="text-xs text-muted-foreground">{f.label}</dt><dd className="mt-0.5">{shown(d, f.key) ?? <span className="text-muted-foreground">—</span>}</dd></div>
                ))}
                {d.other_details && <div className="@md:col-span-2"><dt className="text-xs text-muted-foreground">Other details</dt><dd className="mt-0.5 whitespace-pre-wrap">{d.other_details}</dd></div>}
              </dl>
            ) : <p className="text-sm text-muted-foreground">No HR details yet: add CTC, notice period and joining date after the HR call.</p>}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{data.details ? `Updated ${formatDate(data.details.updated_at, true)}${data.details.updated_by_name ? ` by ${data.details.updated_by_name}` : ""}` : ""}</p>
              {canEdit && <Button size="sm" variant="outline" onClick={() => { setForm({ ...EMPTY, ...(data.details ?? {}) }); setEditing(true); }}><Pencil /> {hasDetails ? "Edit details" : "Add details"}</Button>}
            </div>
          </>
        )}
      </div>

      <div className="space-y-4 p-5">
        <h3 className="text-sm font-semibold">Notes</h3>
        {canEdit && (
          <form className="space-y-2" onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run("note", `${base}/notes`, { body: { body: note, job_id: jobId ?? null }, success: "Note added" });
            if (ok) setNote("");
          }}>
            <Label htmlFor="hr-note" className="sr-only">Add a note</Label>
            <Textarea id="hr-note" rows={3} maxLength={4000} placeholder="Add a note, e.g. HR call done: negotiable on CTC, can join in 30 days." value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{jobTitle ? `Tagged with ${jobTitle}` : ""}</p>
              <Button type="submit" size="sm" disabled={!!pending || !note.trim()}>{pending === "note" && <Loader2 className="animate-spin" />}Add note</Button>
            </div>
          </form>
        )}
        {data.notes.length === 0 ? <p className="text-sm text-muted-foreground">No notes yet.</p> : (
          <ul className="divide-y">
            {data.notes.map((n) => {
              const mine = canEdit && n.author_id === currentUserId;
              return (
                <li key={n.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{n.author_name ?? "Former member"}</span>
                    <span>{formatDate(n.created_at, true)}{n.updated_at.getTime() - n.created_at.getTime() > 1000 ? " · edited" : ""}</span>
                    {n.job_title && <span className="rounded-md bg-muted px-1.5 py-0.5">{n.job_title}</span>}
                    {mine && editNote?.id !== n.id && (
                      <span className="ml-auto flex gap-1">
                        <Button size="icon-sm" variant="ghost" aria-label="Edit note" onClick={() => setEditNote({ id: n.id, body: n.body })}><Pencil /></Button>
                        <Button size="icon-sm" variant="ghost" aria-label="Delete note" onClick={() => setRemoving(n.id)}><Trash2 /></Button>
                      </span>
                    )}
                  </div>
                  {editNote?.id === n.id ? (
                    <form className="mt-2 space-y-2" onSubmit={async (e) => {
                      e.preventDefault();
                      const ok = await run("edit", `${base}/notes/${n.id}`, { method: "PATCH", body: { body: editNote.body }, success: "Note updated" });
                      if (ok) setEditNote(null);
                    }}>
                      <Textarea aria-label="Edit note" rows={3} maxLength={4000} value={editNote.body} onChange={(e) => setEditNote({ id: n.id, body: e.target.value })} />
                      <div className="flex justify-end gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => setEditNote(null)}>Cancel</Button>
                        <Button type="submit" size="sm" disabled={!!pending || !editNote.body.trim()}>{pending === "edit" && <Loader2 className="animate-spin" />}Save</Button>
                      </div>
                    </form>
                  ) : <p className="mt-1 whitespace-pre-wrap text-sm">{n.body}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title="Delete this note?" description="This can't be undone."
        confirmLabel="Delete note" destructive onConfirm={async () => {
          if (removing) await run("delete", `${base}/notes/${removing}`, { method: "DELETE", success: "Note deleted" });
          setRemoving(null);
        }} />
    </section>
  );
}
