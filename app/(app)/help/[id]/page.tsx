import { notFound } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { SupportStatusBadge } from "@/components/support/badges";
import { Conversation } from "@/components/support/conversation";
import { CustomerReplyBox } from "@/components/support/reply-box";
import { Card, CardContent } from "@/components/ui/card";
import { requireAuth } from "@/lib/auth/session";
import { isUuid } from "@/lib/ids";
import { getMyTicket, SUPPORT_CATEGORY_LABEL } from "@/lib/services/support";
import { LocalTime } from "@/components/common/local-time";

export const metadata = { title: "Support request" };

export default async function SupportRequestPage(props: PageProps<"/help/[id]">) {
  const { id } = await props.params;
  const auth = await requireAuth();
  if (!isUuid(id)) notFound();
  const data = await getMyTicket(auth, id);
  if (!data) notFound();
  const { ticket, messages } = data;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        back={{ href: "/help", label: "Help and support" }}
        title={ticket.subject}
        meta={<>
          <SupportStatusBadge status={ticket.status} />
          <span>{SUPPORT_CATEGORY_LABEL[ticket.category]}</span>
          <span>Sent <LocalTime date={ticket.created_at} />{ticket.author ? ` by ${ticket.author}` : ""}</span>
        </>}
      />
      {ticket.page_url && <p className="mb-4 truncate text-sm text-muted-foreground">Page: <span className="text-foreground">{ticket.page_url}</span></p>}
      <Conversation messages={messages} viewer="customer" />
      <Card className="mt-6"><CardContent><CustomerReplyBox id={ticket.id} status={ticket.status} /></CardContent></Card>
    </div>
  );
}
