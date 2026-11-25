import { LifeBuoy } from "lucide-react";
import { cn } from "@/lib/utils";
import { LocalTime } from "@/components/common/local-time";

export type ThreadMessage = { id: string; from_admin: boolean; body: string; created_at: string | Date; author: string | null };

/** A support conversation. `viewer` decides whose messages sit on the right. */
export function Conversation({ messages, viewer }: { messages: ThreadMessage[]; viewer: "customer" | "admin" }) {
  return (
    <ol className="space-y-4">
      {messages.map((m) => {
        const mine = viewer === "admin" ? m.from_admin : !m.from_admin;
        const who = m.from_admin ? (viewer === "admin" ? `${m.author ?? "Admin"} · PickMyHire.ai support` : "PickMyHire.ai support") : (m.author ?? "Customer");
        return (
          <li key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[85%] rounded-2xl border px-4 py-3", m.from_admin ? "border-primary/20 bg-primary/5" : "bg-card")}>
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                {m.from_admin && <LifeBuoy className="size-3.5 text-primary" />}{who} · <LocalTime date={m.created_at} />
              </p>
              <p className="mt-1.5 text-sm whitespace-pre-wrap break-words">{m.body}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
