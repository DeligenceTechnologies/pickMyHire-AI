import { FormCard } from "@/components/settings/form-card";
import { requireAuth } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { countFailedEmails, listOutbox } from "@/lib/services/workspace";
import { AlertTriangle } from "lucide-react";

export const metadata = { title: "Email outbox" };

export default async function OutboxPage() {
  const auth = await requireAuth("interview:write");
  const [rows, failed] = await Promise.all([listOutbox(auth.orgId), countFailedEmails(auth.orgId)]);
  const provider = env().EMAIL_PROVIDER;
  return (
    <FormCard title="Email outbox" description={provider === "log" ? "No email provider is configured (EMAIL_PROVIDER=log), so emails are recorded here instead of being delivered. Copy links from here while developing." : `Emails are delivered via ${provider}.`}>
      {failed.failed > 0 && (
        <div role="status" className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p>
            <span className="font-medium">{failed.failed} {failed.failed === 1 ? "email" : "emails"} couldn&apos;t be sent in the last 30 days</span>
            {failed.last && <span className="text-muted-foreground"> (latest {formatDate(failed.last, true)})</span>}.
            {" "}Open one to see why. To send it again, use the action that sent it (for example “Resend invitation”), or copy the text and send it yourself.
          </p>
        </div>
      )}
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No emails yet.</p> : (
        <ul className="-my-2 divide-y">
          {rows.map((r) => (
            <li key={r.id} className="py-3">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-medium">{r.subject}</span><span className="text-muted-foreground">to {r.to_email}</span>
                  <span className={`ml-auto text-xs ${r.status === "sent" ? "text-muted-foreground" : "text-destructive"}`}>{r.status === "sent" ? (r.provider === "log" ? "logged" : "sent") : "failed"} · {formatDate(r.created_at, true)}</span>
                </summary>
                {r.status !== "sent" && <p className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">Not sent: {r.error || "the email provider refused it"}.</p>}
                <pre className="mt-2 overflow-x-auto rounded-lg bg-muted/60 p-3 font-sans text-sm whitespace-pre-wrap">{r.body_text}</pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </FormCard>
  );
}
