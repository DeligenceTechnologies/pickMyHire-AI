"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, type ClientApiError } from "@/lib/client/api";
import { toastEmailResult } from "@/lib/client/email-result";
import { checkLocation, DEFAULT_CRITERIA, LOCATION_FIELD, LOCATION_LABEL, LOCATION_TYPES, utcToZoned, zonedToUtc, type LocationType } from "@/lib/hiring";
import { TagInput } from "@/components/common/tag-input";
import { cn } from "@/lib/utils";

export type PanelMember = { user_id: string; name: string; role: string };
export type ScheduleValues = { scheduledAt: string; durationMinutes: number; timezone: string; locationType: LocationType; location: string | null; message: string | null; interviewerIds: string[] };
type Mode =
  /** Without `roundId`: a one-off interview for this candidate (name and skills chosen here). */
  | { kind: "create"; jobId: string; candidateId: string; candidateName: string; roundId?: string; roundName: string }
  | { kind: "reschedule"; id: string; candidateName: string; roundName: string; initial: ScheduleValues };

const selectClass = "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const DURATIONS = [15, 30, 45, 60, 75, 90, 120];
const COMMON_ZONES = ["Asia/Kolkata", "UTC", "Europe/London", "Europe/Berlin", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney", "America/New_York", "America/Chicago", "America/Los_Angeles"];
const NO_LOCATIONS: Record<LocationType, string> = { video: "", phone: "", in_person: "" };

/** Tomorrow's date in `timeZone` (called when the dialog opens, not while rendering). */
function tomorrowIn(timeZone: string) {
  return utcToZoned(new Date(Date.now() + 86_400_000), timeZone).date;
}

function zones(current: string) {
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : COMMON_ZONES;
  return Array.from(new Set([current, ...COMMON_ZONES, ...all]));
}

/** A button that opens the schedule dialog (usable from server components). */
export function ScheduleButton({ label, mode, members, emailLive }: { label: string; mode: Extract<Mode, { kind: "create" }>; members: PanelMember[]; emailLive: boolean }) {
  return <ScheduleDialog mode={mode} members={members} emailLive={emailLive} trigger={(open) => <Button size="sm" variant="outline" onClick={open}><CalendarPlus /> {label}</Button>} />;
}

/** Schedule or reschedule a human interview. */
export function ScheduleDialog({ mode, members, emailLive, trigger }: { mode: Mode; members: PanelMember[]; emailLive: boolean; trigger: (open: () => void) => ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // One box per type, so a link typed for a video call isn't checked as an address after switching.
  const [v, setV] = useState({ date: "", time: "10:00", duration: 45, timezone: "UTC", locationType: "video" as LocationType, locations: NO_LOCATIONS, message: "", interviewers: [] as string[], reason: "", sendEmail: true });
  const [locationError, setLocationError] = useState<string | null>(null);
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));
  const extra = mode.kind === "create" && !mode.roundId;
  const [extraRound, setExtraRound] = useState({ name: "", criteria: DEFAULT_CRITERIA, guide: "" });

  const start = () => {
    if (mode.kind === "reschedule") {
      const i = mode.initial;
      const z = utcToZoned(i.scheduledAt, i.timezone);
      setV({ date: z.date, time: z.time, duration: i.durationMinutes, timezone: i.timezone, locationType: i.locationType, locations: { ...NO_LOCATIONS, [i.locationType]: i.location ?? "" }, message: i.message ?? "", interviewers: i.interviewerIds, reason: "", sendEmail: true });
    } else {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const tomorrow = tomorrowIn(tz);
      setV({ date: tomorrow, time: "10:00", duration: 45, timezone: tz, locationType: "video", locations: NO_LOCATIONS, message: "", interviewers: [], reason: "", sendEmail: true });
      setExtraRound({ name: "", criteria: DEFAULT_CRITERIA, guide: "" });
    }
    setLocationError(null);
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const where = checkLocation(v.locationType, v.locations[v.locationType]);
    if (where.error !== undefined) {
      setLocationError(where.error);
      document.getElementById("hi-location")?.focus();
      return;
    }
    if (!v.interviewers.length) return toast.error("Choose at least one interviewer.");
    if (extra && !extraRound.criteria.length) return toast.error("Add at least one skill to rate.");
    setBusy(true);
    try {
      const values = {
        scheduledAt: zonedToUtc(v.date, v.time, v.timezone), durationMinutes: v.duration, timezone: v.timezone, locationType: v.locationType,
        location: where.value, message: v.message.trim() || null, interviewerIds: v.interviewers, sendEmail: v.sendEmail,
      };
      if (mode.kind === "create") {
        const round = mode.roundId
          ? { roundId: mode.roundId }
          : { extra: { name: extraRound.name.trim(), criteria: extraRound.criteria, guide: extraRound.guide.trim() || null } };
        const res = await api<{ id: string; emailFailed?: string[] }>("/api/human-interviews", { body: { ...values, ...round, jobId: mode.jobId, candidateId: mode.candidateId } });
        toastEmailResult(res, `${mode.roundId ? mode.roundName : extraRound.name.trim()} interview scheduled`, "Use “Copy invite” and the calendar files on the next page to send it yourself.");
        setOpen(false);
        router.push(`/interviews/human/${res.id}`);
      } else {
        const res = await api(`/api/human-interviews/${mode.id}`, { method: "PATCH", body: { ...values, action: "reschedule", reason: v.reason.trim() || null } });
        toastEmailResult(res, "Interview rescheduled", "Use “Copy invite” and the calendar files on this page to send the new time yourself.");
        setOpen(false);
        router.refresh();
      }
    } catch (err) {
      toast.error((err as ClientApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {trigger(start)}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submit} className="contents">
            <DialogHeader>
              <DialogTitle>{extra ? "Schedule an extra interview" : mode.kind === "create" ? `Schedule ${mode.roundName}` : `Reschedule ${mode.roundName}`}</DialogTitle>
              <DialogDescription>
                {extra ? `A one-off human interview for ${mode.candidateName} only. The job's rounds don't change.` : `Human interview with ${mode.candidateName}. Interviewers fill in a scorecard afterwards.`}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              {extra && (
                <div className="grid gap-3 rounded-lg bg-muted/40 p-3">
                  <div className="space-y-1.5"><Label htmlFor="hi-name" required>Interview name</Label>
                    <Input id="hi-name" required maxLength={80} value={extraRound.name} onChange={(e) => setExtraRound((r) => ({ ...r, name: e.target.value }))} placeholder="e.g. Founder chat, Second technical" />
                  </div>
                  <div className="space-y-1.5"><Label htmlFor="hi-criteria" required>Skills to rate (1–5)</Label>
                    <TagInput id="hi-criteria" value={extraRound.criteria} onChange={(c) => setExtraRound((r) => ({ ...r, criteria: c.slice(0, 12) }))} placeholder="Add a skill and press Enter" />
                  </div>
                  <div className="space-y-1.5"><Label htmlFor="hi-guide">Interviewer guide <span className="font-normal text-muted-foreground">(optional)</span></Label>
                    <Textarea id="hi-guide" rows={2} maxLength={4000} value={extraRound.guide} onChange={(e) => setExtraRound((r) => ({ ...r, guide: e.target.value }))} placeholder="What to cover and why this extra interview is needed" />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1.2fr_1fr_1fr]">
                <div className="space-y-1.5"><Label htmlFor="hi-date" required>Date</Label><Input id="hi-date" type="date" required value={v.date} onChange={(e) => set({ date: e.target.value })} /></div>
                <div className="space-y-1.5"><Label htmlFor="hi-time" required>Start time</Label><Input id="hi-time" type="time" required value={v.time} onChange={(e) => set({ time: e.target.value })} /></div>
                <div className="col-span-2 space-y-1.5 sm:col-span-1"><Label htmlFor="hi-duration" required>Duration</Label>
                  <select id="hi-duration" className={selectClass} value={v.duration} onChange={(e) => set({ duration: Number(e.target.value) })}>
                    {DURATIONS.map((d) => <option key={d} value={d}>{d} min</option>)}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5"><Label htmlFor="hi-tz" required>Time zone</Label>
                <select id="hi-tz" className={selectClass} value={v.timezone} onChange={(e) => set({ timezone: e.target.value })}>
                  {zones(v.timezone).map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
                </select>
              </div>
              <fieldset className="space-y-1.5">
                <legend className="mb-1.5 text-sm font-medium">Where<span aria-hidden="true" className="ml-0.5 text-destructive">*</span></legend>
                <div className="flex flex-wrap gap-2">
                  {LOCATION_TYPES.map((t) => (
                    <button key={t} type="button" onClick={() => { set({ locationType: t }); setLocationError(null); }} aria-pressed={v.locationType === t}
                      className={cn("rounded-lg border px-3 py-1.5 text-sm", v.locationType === t ? "border-primary bg-primary/5 font-medium text-primary" : "hover:bg-muted")}>
                      {LOCATION_LABEL[t]}
                    </button>
                  ))}
                </div>
                <div className="space-y-1.5 pt-1">
                  <Label htmlFor="hi-location" required>{LOCATION_FIELD[v.locationType].label}</Label>
                  <Input id="hi-location" aria-required="true" maxLength={500} autoComplete="off"
                    type={v.locationType === "phone" ? "tel" : "text"} inputMode={v.locationType === "video" ? "url" : v.locationType === "phone" ? "tel" : "text"}
                    value={v.locations[v.locationType]} placeholder={LOCATION_FIELD[v.locationType].placeholder}
                    aria-invalid={!!locationError} aria-describedby="hi-location-help"
                    onChange={(e) => { set({ locations: { ...v.locations, [v.locationType]: e.target.value } }); if (locationError) setLocationError(null); }}
                    onBlur={() => { const t = v.locations[v.locationType]; if (t.trim()) setLocationError(checkLocation(v.locationType, t).error ?? null); }} />
                  <p id="hi-location-help" className={cn("text-xs", locationError ? "text-destructive" : "text-muted-foreground")}>{locationError ?? LOCATION_FIELD[v.locationType].hint}</p>
                </div>
              </fieldset>
              <fieldset className="space-y-1.5">
                <legend className="mb-1.5 text-sm font-medium">Interviewers<span aria-hidden="true" className="ml-0.5 text-destructive">*</span></legend>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {members.map((m) => (
                    <label key={m.user_id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted/60">
                      <Checkbox checked={v.interviewers.includes(m.user_id)}
                        onCheckedChange={(c) => set({ interviewers: c ? [...v.interviewers, m.user_id] : v.interviewers.filter((x) => x !== m.user_id) })} />
                      <span className="flex-1">{m.name}</span><span className="text-xs capitalize text-muted-foreground">{m.role}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">View-only members can&apos;t be interviewers. Add people in Settings → Team.</p>
              </fieldset>
              <div className="space-y-1.5"><Label htmlFor="hi-message">Message to the candidate <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Textarea id="hi-message" rows={2} maxLength={2000} value={v.message} onChange={(e) => set({ message: e.target.value })} placeholder="e.g. Please have your portfolio ready to share." />
              </div>
              {mode.kind === "reschedule" && (
                <div className="space-y-1.5"><Label htmlFor="hi-reason">Reason for the change <span className="font-normal text-muted-foreground">(optional)</span></Label>
                  <Input id="hi-reason" maxLength={500} value={v.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="e.g. Interviewer unavailable" />
                </div>
              )}
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={v.sendEmail} onCheckedChange={(c) => set({ sendEmail: !!c })} className="mt-0.5" />
                <span>Email {mode.kind === "create" ? "the invitation" : "the new time"} to the candidate and interviewers
                  {!emailLive && <span className="block text-xs text-muted-foreground">Email sending isn&apos;t set up yet, so it&apos;s saved to the outbox. Use “Copy invite” and the calendar file on the next page to send it yourself.</span>}
                </span>
              </label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />} {mode.kind === "create" ? "Schedule interview" : "Save new time"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
