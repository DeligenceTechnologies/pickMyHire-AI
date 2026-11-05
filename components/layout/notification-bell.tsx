"use client";

import Link from "next/link";
import { DECISION_LABEL, formatInZone } from "@/lib/hiring";
import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/client/api";
import { timeAgo } from "@/lib/format";

type N = { id: string; type: string; payload: Record<string, string>; read_at: string | null; created_at: string };

const label = (n: N) =>
  n.type === "report.ready" ? `Report ready — ${n.payload.candidate} (${n.payload.job})`
  : n.type === "interview.completed" ? `${n.payload.candidate} completed the ${n.payload.job} interview`
  : n.type === "interview.issue_reported" ? `${n.payload.candidate} reported an issue with the ${n.payload.job} interview (${n.payload.category})`
  : n.type === "application.received" ? `New application — ${n.payload.candidate} for ${n.payload.job}`
  : n.type === "human_interview.assigned" ? `You're interviewing ${n.payload.candidate} (${n.payload.round}, ${n.payload.job})${n.payload.at && n.payload.tz ? ` on ${formatInZone(n.payload.at, n.payload.tz)}` : ""}`
  : n.type === "human_interview.scorecard" ? `${n.payload.interviewer} submitted a scorecard for ${n.payload.candidate} (${n.payload.round})${n.payload.recommendation ? `: ${DECISION_LABEL[n.payload.recommendation as keyof typeof DECISION_LABEL] ?? ""}` : ""}`
  : n.type === "support.reply" ? `PickMyHire.ai support replied: ${n.payload.subject}`
  : n.type === "email.failed" ? `An email couldn't be sent: “${n.payload.subject}” to ${n.payload.to}. Open the email outbox for the reason.`
  : n.type;

export function NotificationBell() {
  const [items, setItems] = useState<N[]>([]);
  const load = () => api<{ notifications: N[] }>("/api/notifications").then((r) => setItems(r.notifications)).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  const unread = items.filter((n) => !n.read_at).length;
  // Optimistic removal; reload from the server if the request fails.
  const dismiss = (id: string | null) => {
    setItems((prev) => (id ? prev.filter((n) => n.id !== id) : []));
    api(id ? `/api/notifications/${id}` : "/api/notifications", { method: "DELETE" }).catch(load);
  };
  return (
    <DropdownMenu onOpenChange={(open) => { if (open && unread) api("/api/notifications", { method: "POST", body: {} }).then(load).catch(() => {}); }}>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`} className="relative" />}>
        <Bell className="size-4" />
        {unread > 0 && <span className="absolute top-1 right-1 size-2 rounded-full bg-primary ring-2 ring-background" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {items.length > 0 && (
            <button type="button" onClick={() => dismiss(null)} className="text-xs font-medium text-muted-foreground hover:text-foreground">Clear all</button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {items.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>}
          {items.map((n) => (
            <div key={n.id} className="group relative border-b last:border-0 hover:bg-muted">
              <Link href={n.type === "email.failed" ? "/settings/notifications" : n.payload.ticket_id ? `/help/${n.payload.ticket_id}` : n.payload.application_id ? `/jobs/${n.payload.job_id}/applications/${n.payload.application_id}` : n.payload.human_interview_id ? `/interviews/human/${n.payload.human_interview_id}` : n.payload.interview_id ? `/interviews/${n.payload.interview_id}` : "/dashboard"} className="block py-2.5 pr-9 pl-3 text-sm">
                <p className={n.read_at ? "text-muted-foreground" : "font-medium"}>{label(n)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{timeAgo(n.created_at)}</p>
              </Link>
              <button
                type="button"
                aria-label="Clear notification"
                onClick={() => dismiss(n.id)}
                className="absolute top-2 right-2 rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
