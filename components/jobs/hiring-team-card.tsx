import Link from "next/link";
import { Mail, Users } from "lucide-react";
import { roleLabel } from "@/lib/auth/permissions";
import { initials } from "@/lib/format";
import type { JobTeamMember } from "@/lib/services/job-team";

/** The job's hiring team on the job page: who gets its emails, and which interviewers can see it. */
export function HiringTeamCard({ jobId, team, canEdit }: { jobId: string; team: JobTeamMember[]; canEdit: boolean }) {
  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold"><Users className="size-4 text-muted-foreground" aria-hidden /> Hiring team</h2>
        {canEdit && <Link href={`/jobs/${jobId}/edit#hiring-team`} className="text-xs text-primary hover:underline">Edit team</Link>}
      </div>
      {team.length ? (
        <ul className="space-y-2.5">
          {team.map((m) => (
            <li key={m.user_id} className="flex items-center gap-2.5 text-sm">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">{initials(m.name)}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{roleLabel[m.role]}</span>
              {m.role !== "interviewer" && m.role !== "viewer" && <Mail className="size-3.5 shrink-0 text-muted-foreground" aria-label="Gets this job's emails" />}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">Nobody yet. Emails for this job go to all recruiters.</p>}
    </section>
  );
}
