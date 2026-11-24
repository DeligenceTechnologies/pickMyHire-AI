"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";

type Round = { id: string; name: string; kind?: "ai" | "human"; template_id: string | null; template_name: string | null; minutes: number };
type State = { completedAt: string | null; completedCount: number; pending: boolean; started: number };
type Template = { id: string; name: string; minutes: number };

/** What the invite request needs to know about the round. */
export type RoundChoice = {
  roundId: string | null;
  templateId: string | null;
  newRoundName: string | null;
  reinvite: boolean;
  reason: string | null;
  /** Length of the chosen template (for how many interviews it uses); not sent to the server. */
  minutes?: number | null;
};
export const emptyChoice: RoundChoice = { roundId: null, templateId: null, newRoundName: null, reinvite: false, reason: null, minutes: null };

const OTHER = "__other__";
const selectClass = "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const day = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/**
 * Pick which interview round to invite to: one of the job's rounds (defaulting
 * to the candidate's next one) or any other template, optionally saved to the
 * job as a new round. Repeating a completed round needs an explicit confirmation.
 * `onChange(choice, blocked)` — blocked when the candidate already has an unfinished invite for that round.
 */
export function RoundPicker({ jobId, candidateId, candidateName, onChange }: {
  jobId: string;
  candidateId: string | null;
  candidateName?: string;
  onChange: (choice: RoundChoice, blocked: boolean) => void;
}) {
  const [data, setData] = useState<{ rounds: Round[]; states: Record<string, State>; templates: Template[] } | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [templateId, setTemplateId] = useState("");
  const [saveAsRound, setSaveAsRound] = useState(false);
  const [roundName, setRoundName] = useState("");
  const [reason, setReason] = useState("");
  const [humanRounds, setHumanRounds] = useState(0);

  useEffect(() => {
    if (!jobId) return;
    let live = true;
    api<{ rounds: Round[]; states: Record<string, State>; templates: Template[] }>(`/api/jobs/${jobId}/rounds${candidateId ? `?candidateId=${candidateId}` : ""}`)
      .then((all) => {
        if (!live) return;
        // Human rounds are scheduled from the candidate's profile, not sent as AI interviews.
        const d = { ...all, rounds: all.rounds.filter((r) => r.kind !== "human") };
        setHumanRounds(all.rounds.length - d.rounds.length);
        setData(d);
        // Default: the first round this candidate hasn't completed and isn't waiting on.
        const next = d.rounds.find((r) => !d.states[r.id]?.completedCount && !d.states[r.id]?.pending) ?? d.rounds[0];
        setSelected(next?.id ?? OTHER);
        setTemplateId(d.templates[0]?.id ?? "");
      })
      .catch(() => live && setData({ rounds: [], states: {}, templates: [] }));
    return () => { live = false; };
  }, [jobId, candidateId]);

  const state = selected && selected !== OTHER ? data?.states[selected] : undefined;
  const round = data?.rounds.find((r) => r.id === selected);
  const repeat = !!state?.completedCount && !state.pending;
  const blocked = !!state?.pending;

  useEffect(() => {
    if (!data) return;
    if (selected === OTHER) {
      const tpl = data.templates.find((t) => t.id === templateId);
      onChange({ ...emptyChoice, templateId: templateId || null, newRoundName: saveAsRound ? (roundName.trim() || tpl?.name || null) : null, minutes: tpl?.minutes ?? null }, !templateId);
    } else {
      onChange({ ...emptyChoice, roundId: selected || null, reinvite: repeat, reason: repeat ? reason.trim() || null : null, minutes: round?.template_id ? round.minutes : null }, blocked);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selected, templateId, saveAsRound, roundName, reason, repeat, blocked]);

  if (!jobId) return null;
  if (!data) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading interview rounds…</p>;

  const who = candidateName?.split(" ")[0] ?? "This candidate";
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1.5 text-sm font-medium">Interview round<span aria-hidden="true" className="ml-0.5 text-destructive">*</span></legend>
      <div className="space-y-1.5">
        {data.rounds.map((r, i) => {
          const s = data.states[r.id];
          return (
            <label key={r.id} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm", selected === r.id ? "border-primary bg-primary/5" : "hover:bg-muted/50")}>
              <input type="radio" name="round" className="accent-[var(--primary)]" checked={selected === r.id} onChange={() => setSelected(r.id)} />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{i + 1}. {r.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{r.template_name ? `${r.template_name} · ${r.minutes} min` : "No template set"}</span>
              </span>
              {s?.pending ? <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">Invite pending</span>
                : s?.completedAt ? <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Done {day(s.completedAt)}</span>
                : null}
            </label>
          );
        })}
        {humanRounds > 0 && <p className="text-xs text-muted-foreground">This job also has {humanRounds} human interview round{humanRounds === 1 ? "" : "s"}: schedule {humanRounds === 1 ? "it" : "them"} from the candidate&apos;s profile.</p>}
        <label className={cn("flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm", selected === OTHER ? "border-primary bg-primary/5" : "hover:bg-muted/50")}>
          <input type="radio" name="round" className="accent-[var(--primary)]" checked={selected === OTHER} onChange={() => setSelected(OTHER)} />
          <span className="font-medium">Another template…</span>
        </label>
      </div>

      {selected === OTHER && (
        <div className="space-y-3 rounded-lg bg-muted/40 p-3">
          <div className="space-y-1.5">
            <Label htmlFor="rp-template" required>Template</Label>
            <select id="rp-template" className={selectClass} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {data.templates.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.minutes} min</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={saveAsRound} onCheckedChange={(c) => setSaveAsRound(!!c)} /> Also add it to this job as a new round
          </label>
          {saveAsRound && (
            <div className="space-y-1.5">
              <Label htmlFor="rp-name" info="Your team sees this. Leave it empty to use the template name.">Round name</Label>
              <Input id="rp-name" value={roundName} maxLength={80} placeholder={data.templates.find((t) => t.id === templateId)?.name ?? "e.g. Technical"} onChange={(e) => setRoundName(e.target.value)} />
            </div>
          )}
        </div>
      )}

      {blocked && round && (
        <p role="alert" className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {who} already has a {round.name} invite that hasn&apos;t been completed. Resend or cancel it from the interview page instead.
        </p>
      )}
      {repeat && round && (
        <div className="space-y-2 rounded-lg bg-sky-50 px-3 py-2.5 text-sm text-sky-950 dark:bg-sky-950 dark:text-sky-100">
          <p className="flex gap-2"><RotateCcw className="mt-0.5 size-4 shrink-0" />
            {who} completed {round.name}{state?.completedAt ? ` on ${day(state.completedAt)}` : ""}. This invite will be attempt {(state?.started ?? 1) + 1}; the earlier interview and report are kept.
          </p>
          <Input aria-label="Reason for another attempt" value={reason} maxLength={300} placeholder="Reason (optional), e.g. technical issue in the first attempt" onChange={(e) => setReason(e.target.value)} className="bg-background" />
        </div>
      )}
    </fieldset>
  );
}
