"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ClientApiError } from "@/lib/client/api";

/** Before launch: buying online is closed; people with the access code can unlock it. */
export function PurchaseAccess({ contactHref }: { contactHref: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return setError("Enter the access code.");
    setBusy(true);
    setError(null);
    try {
      await api("/api/billing/access", { method: "POST", body: { code } });
      router.refresh();
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <p className="font-medium">Buying online is coming soon</p>
          <p className="mt-1 text-sm text-muted-foreground">Until then, contact us and we&apos;ll add interviews to your account.</p>
        </div>
        <a href={contactHref} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <MessageCircle className="size-4" aria-hidden />Contact us
        </a>
      </div>
      <div className="mt-4 border-t pt-3">
        {open ? (
          <form onSubmit={submit} className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1 sm:max-w-xs">
              <label htmlFor="buy-code" className="sr-only">Access code</label>
              <Input id="buy-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Access code" autoComplete="off" autoFocus aria-invalid={!!error} aria-describedby={error ? "buy-code-error" : undefined} />
              {error && <p id="buy-code-error" role="alert" className="mt-1.5 text-xs text-destructive">{error}</p>}
            </div>
            <Button type="submit" variant="outline" disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />}Unlock</Button>
          </form>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
            <KeyRound className="size-4" aria-hidden />Have an access code?
          </button>
        )}
      </div>
    </div>
  );
}
