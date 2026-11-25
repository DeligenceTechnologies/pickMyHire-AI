import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, MapPin, Users } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { DecisionBadge } from "@/components/hiring/badges";
import { DecisionControl } from "@/components/hiring/decision-control";
import { HumanActions } from "@/components/hiring/human-actions";
import { ScorecardForm, Stars } from "@/components/hiring/scorecard-form";
import { FormCard } from "@/components/settings/form-card";
import { can } from "@/lib/auth/permissions";
import { requireAuth } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { DECISION_LABEL, formatInZone, LOCATION_LABEL } from "@/lib/hiring";
import { isUuid } from "@/lib/ids";
import { formatDate } from "@/lib/format";
import { getHumanInterview, inviteMessage, listPanelCandidates } from "@/lib/services/human-interviews";
import { getCandidate } from "@/lib/services/candidates";
import { candidateJobsInScope } from "@/lib/auth/job-scope";
import { shortExperience } from "@/lib/resume/experience";
import { ResumeButtons, ResumeSplit, type ResumeInfo } from "@/components/hiring/resume-split";
import { LocalTime } from "@/components/common/local-time";

export const metadata = { title: "Human interview" };

type Scorecard = Awaited<ReturnType<typeof getHumanInterview>> extends infer H ? H extends { scorecards: (infer S)[] } ? S : never : never;

function ScorecardView({ s, showName = true }: { s: Scorecard; showName?: boolean }) {
  return (
    <div className="space-y-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {showName ? <p className="font-medium">{s.name}</p> : <span />}
        <span className="flex flex-wrap items-center gap-1.5">
          {s.edited_after_decision && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900">Edited after decision</span>}
          {s.recommendation && <DecisionBadge decision={s.recommendation} />}
        </span>
      </div>
      <ul className="space-y-1.5">
        {s.ratings.map((r) => (
          <li key={r.criterion} className="text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2"><span>{r.criterion}</span><Stars value={r.rating} label={`${s.name}'s rating for ${r.criterion}`} /></div>
            {r.comment && <p className="text-xs text-muted-foreground">{r.comment}</p>}
          </li>
        ))}
      </ul>
      {s.notes && <p className="whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2 text-sm">{s.notes}</p>}
      {s.versions.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-primary">Earlier version{s.versions.length === 1 ? "" : `s (${s.versions.length})`}</summary>
          <ol className="mt-2 space-y-2">
            {[...s.versions].reverse().map((v, i) => (
              <li key={i} className="rounded-md bg-muted/40 px-3 py-2">
                <p className="text-xs text-muted-foreground">Replaced <LocalTime date={v.replaced_at} />{v.recommendation ? ` · recommended ${DECISION_LABEL[v.recommendation]}` : ""}</p>
                <p className="mt-1 text-xs">{v.ratings.map((r) => `${r.criterion}: ${r.rating ?? "–"}/5`).join(" · ")}</p>
                {v.notes && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{v.notes}</p>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

const HISTORY_LABEL: Record<string, string> = { scheduled: "Scheduled", rescheduled: "Rescheduled", cancelled: "Cancelled", completed: "Marked completed", no_show: "Marked no-show", reopened: "Moved back to scheduled" };

type HistoryEntry = { type: string; to?: string; decision?: keyof typeof DECISION_LABEL | null; detail?: string; afterDecision?: boolean };
function historyText(e: HistoryEntry, tz: string) {
  if (e.type === "decided") return `Marked ${e.decision ? DECISION_LABEL[e.decision] : ""}`;
  if (e.type === "decision_cleared") return `Decision reopened${e.decision ? ` (was ${DECISION_LABEL[e.decision]})` : ""}`;
  if (e.type === "scorecard_edited") return `Scorecard edited${e.afterDecision ? " after the decision was reopened" : ""}${e.detail ? `: ${e.detail}` : ""}`;
  return `${HISTORY_LABEL[e.type] ?? e.type}${e.to && e.type !== "cancelled" ? `: ${formatInZone(e.to, tz)}` : ""}`;
}

export default async function HumanInterviewPage(props: PageProps<"/interviews/human/[id]">) {
  const auth = await requireAuth("interview:view");
  const { id } = await props.params;
  if (!isUuid(id)) notFound();
  const h = await getHumanInterview(auth.orgId, id, auth);
  if (!h) notFound();
  const canManage = can(auth.role, "interview:write");
  const canDecide = can(auth.role, "decision:write");
  const onPanel = h.panel.some((p) => p.user_id === auth.userId);
  const mine = h.scorecards.find((s) => s.user_id === auth.userId) ?? null;
  // Interviewers see their own scorecard; people who decide see everyone's submitted ones.
  const others = h.scorecards.filter((s) => s.submitted_at && s.user_id !== auth.userId && (canDecide || auth.role !== "interviewer"));
  const submitted = h.scorecards.filter((s) => s.submitted_at);
  const recs = submitted.map((s) => s.recommendation).filter(Boolean);
  const hint = recs.length ? `${recs.length} of ${h.panel.length} interviewer${h.panel.length === 1 ? "" : "s"} recommend: ${Object.entries(recs.reduce<Record<string, number>>((a, r) => ({ ...a, [r!]: (a[r!] ?? 0) + 1 }), {})).map(([d, n]) => `${DECISION_LABEL[d as keyof typeof DECISION_LABEL]} (${n})`).join(", ")}` : h.status === "completed" ? "No scorecards submitted yet." : null;
  const members = canManage ? await listPanelCandidates(auth.orgId) : [];
  const isLink = h.location_type === "video" && h.location && /^https?:\/\//i.test(h.location);
  const names = new Map([...h.panel, ...members].map((m) => [m.user_id, m.name]));
  // The resume, for people who can see this candidate (Owners, Admins, Recruiters, the job's team).
  const seesCandidate = can(auth.role, "candidate:view") && (await candidateJobsInScope(auth, h.candidate_id).then((j) => !j || j.length > 0));
  const cand = seesCandidate ? await getCandidate(auth.orgId, h.candidate_id) : null;
  const doc = cand?.documents[0];
  const resume: ResumeInfo | null = cand && doc ? { candidateId: cand.id, name: cand.name, fileName: doc.file_name, isPdf: doc.mime_type === "application/pdf", text: doc.mime_type === "application/pdf" ? null : cand.resume_text } : null;
  const skills = (cand?.parsed_profile as { skills?: string[] } | null)?.skills?.slice(0, 6) ?? [];
  // Worked out from the resume dates (selected with the rest of the candidate row).
  const exp = cand as unknown as { experience_months: number | null; experience_approximate: boolean } | null;
  return (
    <>
      <PageHeader
        back={can(auth.role, "candidate:view") ? { href: `/candidates/${h.candidate_id}`, label: h.candidate_name } : { href: "/dashboard", label: "Dashboard" }}
        title={<span className="flex flex-wrap items-center gap-3">{h.round_name}: {h.candidate_name} <StatusBadge status={h.status} /></span>}
        meta={<>
          <span>Human interview</span>
          {can(auth.role, "job:write") || canManage ? <Link href={`/jobs/${h.job_id}`} className="hover:text-foreground">{h.job_title}</Link> : <span>{h.job_title}</span>}
          {h.attempt > 1 && <span>Attempt {h.attempt}</span>}
        </>}
      />
      <ResumeSplit resume={resume}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <FormCard title="Interview details" description={h.status === "cancelled" ? `Cancelled${h.cancel_reason ? `: ${h.cancel_reason}` : ""}` : undefined}>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="flex gap-2"><Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><div><dt className="sr-only">When</dt><dd className="font-medium">{formatInZone(h.scheduled_at, h.timezone, { withYear: true })}</dd><dd className="text-xs text-muted-foreground">{h.duration_minutes} minutes · {h.timezone.replace(/_/g, " ")}</dd></div></div>
              <div className="flex gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><div className="min-w-0"><dt className="sr-only">Where</dt><dd className="font-medium">{LOCATION_LABEL[h.location_type]}</dd>
                {h.location && <dd className="truncate text-xs">{isLink ? <a href={h.location} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{h.location}</a> : h.location}</dd>}</div></div>
              <div className="flex gap-2 sm:col-span-2"><Users className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><div><dt className="sr-only">Interviewers</dt><dd>{h.panel.map((p) => p.name).join(", ")}</dd></div></div>
              {h.message && <div className="rounded-lg bg-muted/50 px-3 py-2 sm:col-span-2"><dt className="text-xs text-muted-foreground">Message to the candidate</dt><dd className="mt-0.5 whitespace-pre-wrap">{h.message}</dd></div>}
            </dl>
            <HumanActions id={h.id} status={h.status} candidateName={h.candidate_name} roundName={h.round_name} inviteText={inviteMessage(h)} canManage={canManage}
              emailLive={env().EMAIL_PROVIDER !== "log"} members={members.map((m) => ({ user_id: m.user_id, name: m.name, role: m.role }))}
              schedule={{ scheduledAt: h.scheduled_at.toISOString(), durationMinutes: h.duration_minutes, timezone: h.timezone, locationType: h.location_type, location: h.location, message: h.message, interviewerIds: h.panel.map((p) => p.user_id) }} />
          </FormCard>

          {onPanel && can(auth.role, "scorecard:write") && h.status !== "cancelled" && (h.decision ? (
            <FormCard title="Your scorecard" description={`Locked: the round decision was made${h.decided_at ? ` on ${formatDate(h.decided_at)}` : ""}. Ask a recruiter to clear the decision if you need to change it.`}>
              {mine?.submitted_at ? <ScorecardView s={mine} showName={false} /> : <p className="text-sm text-muted-foreground">You didn&apos;t submit a scorecard before the decision was made.</p>}
            </FormCard>
          ) : (
            <FormCard title="Your scorecard" description={mine?.submitted_at ? "Submitted. You can update it until the round decision is made." : "Rate each skill from 1 to 5. Your team sees it once you submit."}>
              <ScorecardForm id={h.id} criteria={h.criteria} submitted={!!mine?.submitted_at}
                initial={mine ? { ratings: mine.ratings, notes: mine.notes, recommendation: mine.recommendation } : null} />
            </FormCard>
          ))}

          {others.length > 0 && (
            <FormCard title="Scorecards from the panel">
              <ul className="space-y-5">
                {others.map((s) => <li key={s.user_id}><ScorecardView s={s} /></li>)}
              </ul>
            </FormCard>
          )}
          {!onPanel && others.length === 0 && h.status !== "cancelled" && (
            <p className="rounded-xl border border-dashed px-5 py-6 text-center text-sm text-muted-foreground">Scorecards appear here once the interviewers submit them.</p>
          )}
        </div>

        <div className="min-w-0 space-y-6">
          {cand && (
            <FormCard title="Candidate">
              <div className="space-y-3 text-sm">
                <div>
                  <p className="font-medium">{cand.name}</p>
                  {exp?.experience_months != null && <p className="text-xs text-muted-foreground">{exp.experience_approximate ? "About " : ""}{shortExperience(exp.experience_months)} experience</p>}
                </div>
                {skills.length > 0 && <div className="flex flex-wrap gap-1.5">{skills.map((k) => <span key={k} className="rounded-md bg-muted px-2 py-0.5 text-xs">{k}</span>)}</div>}
                {resume ? <ResumeButtons resume={resume} /> : <p className="text-xs text-muted-foreground">No resume uploaded.</p>}
              </div>
            </FormCard>
          )}
          <FormCard title="Decision" description="Your team's call for this round. Scorecards are recommendations, and they lock once you decide (clear the decision to unlock them).">
            <DecisionControl endpoint={`/api/human-interviews/${h.id}/decision`} decision={h.decision} note={h.decision_note} decidedBy={h.decided_by_name}
              decidedOn={h.decided_at ? formatDate(h.decided_at) : null} canEdit={canDecide && h.status !== "cancelled"} hint={hint}
              email={can(auth.role, "candidate:write") ? { candidateId: h.candidate_id, jobId: h.job_id, name: h.candidate_name } : undefined} />
          </FormCard>
          <FormCard title="Interview guide">
            <div className="space-y-3 text-sm">
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Assess</p>
                <ul className="flex flex-wrap gap-1.5">{h.criteria.map((c) => <li key={c} className="rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">{c}</li>)}</ul>
              </div>
              {h.guide ? <p className="whitespace-pre-wrap text-muted-foreground">{h.guide}</p> : <p className="text-muted-foreground">No guide for this round. Add one by editing the job&apos;s rounds.</p>}
            </div>
          </FormCard>
          <FormCard title="History">
            <ol className="space-y-2 text-sm">
              {[...h.history].reverse().map((e, i) => (
                <li key={i}>
                  <p className={e.type === "decision_cleared" || (e.type === "scorecard_edited" && e.afterDecision) ? "font-medium text-amber-800 dark:text-amber-300" : undefined}>{historyText(e, h.timezone)}</p>
                  <p className="text-xs text-muted-foreground">{names.get(e.by) ?? "Someone"} · {new Date(e.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}{e.reason ? ` · ${e.reason}` : ""}</p>
                </li>
              ))}
            </ol>
          </FormCard>
        </div>
      </div>
      </ResumeSplit>
    </>
  );
}
