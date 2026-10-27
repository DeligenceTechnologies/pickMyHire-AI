import Link from "next/link";
import { BookOpen, ChevronRight, ExternalLink, Inbox, MessageSquareText } from "lucide-react";
import { EmptyState } from "@/components/common/states";
import { PageHeader } from "@/components/common/page-header";
import { SupportStatusBadge } from "@/components/support/badges";
import { NewRequestForm } from "@/components/support/new-request-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAuth } from "@/lib/auth/session";
import { timeAgo } from "@/lib/format";
import { listMyTickets, SUPPORT_CATEGORY_LABEL } from "@/lib/services/support";

export const metadata = { title: "Help and support" };

export default async function HelpPage() {
  const auth = await requireAuth();
  const tickets = await listMyTickets(auth);
  const company = auth.role === "owner" || auth.role === "admin";
  return (
    <>
      <PageHeader title="Help and support" description="Write to the PickMyHire.ai team. We reply here, and you'll get an email too." />
      <a href="/guide" target="_blank" rel="noopener" className="mb-6 flex items-center gap-4 rounded-xl border bg-card p-4 hover:border-primary hover:bg-accent/40">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><BookOpen className="size-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Product guide</span>
          <span className="block text-sm text-muted-foreground">Step-by-step help with screenshots for every feature. Most questions are answered here.</span>
        </span>
        <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
      </a>
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Contact support</CardTitle>
            <CardDescription>Report a problem, ask a question or suggest a feature.</CardDescription>
          </CardHeader>
          <CardContent><NewRequestForm /></CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{company ? "Your company's requests" : "Your requests"}</CardTitle>
            <CardDescription>{company ? "Every request from your team, newest activity first." : "Requests you've sent, newest activity first."}</CardDescription>
          </CardHeader>
          <CardContent>
            {tickets.length === 0 ? <EmptyState icon={Inbox} title="No requests yet" description="Requests you send will appear here." /> : (
              <ul className="-mx-2 divide-y">
                {tickets.map((t) => (
                  <li key={t.id}>
                    <Link href={`/help/${t.id}`} className="flex items-center gap-3 rounded-lg px-2 py-3 hover:bg-muted">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{t.subject}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {SUPPORT_CATEGORY_LABEL[t.category]}{company && t.author ? ` · ${t.author}` : ""} · {timeAgo(t.last_message_at)}
                          {t.last_message_from_admin && t.status !== "resolved" && <span className="ml-1.5 inline-flex items-center gap-1 font-medium text-primary"><MessageSquareText className="size-3" />Support replied</span>}
                        </p>
                      </div>
                      <SupportStatusBadge status={t.status} />
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
