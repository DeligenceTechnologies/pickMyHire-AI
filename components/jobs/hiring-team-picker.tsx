"use client";

import { Mail, Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { roleLabel, type Role } from "@/lib/auth/permissions";
import { initials } from "@/lib/format";

export type TeamOption = { user_id: string; name: string; email: string; role: Role };

const selectClass = "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** What being on the team means for each role, in a few words. */
function effect(role: Role) {
  if (role === "interviewer") return { icon: Eye, text: "Can see this job's candidates and interviews" };
  if (role === "viewer") return { icon: Eye, text: "Sees every job already (read only)" };
  return { icon: Mail, text: "Gets this job's emails" };
}

/** Pick the job's hiring team: who gets its emails, and which interviewers can see it. */
export function HiringTeamPicker({ value, onChange, options, currentUserId }: {
  value: string[]; onChange: (ids: string[]) => void; options: TeamOption[]; currentUserId?: string;
}) {
  const chosen = value.map((id) => options.find((o) => o.user_id === id)).filter((o): o is TeamOption => !!o);
  const rest = options.filter((o) => !value.includes(o.user_id) && o.role !== "viewer");
  return (
    <div className="space-y-3">
      {chosen.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {chosen.map((m) => {
            const e = effect(m.role);
            return (
              <li key={m.user_id} className="flex items-center gap-3 px-3 py-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{initials(m.name)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.name}{m.user_id === currentUserId && <span className="font-normal text-muted-foreground"> (you)</span>} <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">{roleLabel[m.role]}</span></p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground"><e.icon className="size-3" aria-hidden />{e.text}</p>
                </div>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${m.name} from the hiring team`} onClick={() => onChange(value.filter((id) => id !== m.user_id))}><X /></Button>
              </li>
            );
          })}
        </ul>
      ) : <p className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">Nobody yet. Without a team, this job&apos;s emails go to all recruiters.</p>}
      {rest.length > 0 && (
        <select aria-label="Add a team member" className={selectClass} value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])}>
          <option value="">Add a team member…</option>
          {(["owner", "admin", "recruiter", "interviewer"] as Role[]).map((r) => {
            const people = rest.filter((o) => o.role === r);
            return people.length ? (
              <optgroup key={r} label={`${roleLabel[r]}s`}>
                {people.map((o) => <option key={o.user_id} value={o.user_id}>{o.name} ({o.email})</option>)}
              </optgroup>
            ) : null;
          })}
        </select>
      )}
    </div>
  );
}
