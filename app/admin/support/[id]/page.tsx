import Link from "next/link";
import { notFound } from "next/navigation";
import { Mail } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { SupportStatusBadge } from "@/components/support/badges";
import { Conversation } from "@/components/support/conversation";
import { AdminReplyBox } from "@/components/support/reply-box";
import { Card, CardContent } from "@/components/ui/card";
import { roleLabel, type Role } from "@/lib/auth/permissions";
import { isUuid } from "@/lib/ids";
import { getSupportTicket, SUPPORT_CATEGORY_LABEL } from "@/lib/services/support";
import { LocalTime } from "@/components/common/local-time";

export const metadata = { title: "Support request" };

export default async function AdminSupportTicketPage(props: PageProps<"/admin/support/[id]">) {
  const { id } = await props.params;
  if (!isUuid(id)) notFound();
  const data = await getSupportTicket(id);
  if (!data) notFound();
  const { ticket, messages } = data;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        back={{ href: "/admin/support", label: "Support" }}
        title={ticket.subject}
        meta={<>
          <SupportStatusBadge status={ticket.status} />
          <span>{SUPPORT_CATEGORY_LABEL[ticket.category]}</span>
          <span>Sent <LocalTime date={ticket.created_at} /></span>
        </>}
      />
      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <Link href={`/admin/companies/${ticket.org_id}`} className="font-medium text-primary hover:underline">{ticket.org_name}</Link>
          <span>{ticket.author ?? "Former member"}{ticket.author_role ? ` · ${roleLabel[ticket.author_role as Role] ?? ticket.author_role}` : ""}</span>
          {ticket.author_email && <a href={`mailto:${ticket.author_email}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><Mail className="size-3.5" />{ticket.author_email}</a>}
          {ticket.page_url && <span className="w-full truncate text-muted-foreground">Page: <span className="text-foreground">{ticket.page_url}</span></span>}
        </CardContent>
      </Card>
      <Conversation messages={messages} viewer="admin" />
      <Card className="mt-6"><CardContent><AdminReplyBox id={ticket.id} status={ticket.status} /></CardContent></Card>
    </div>
  );
}
