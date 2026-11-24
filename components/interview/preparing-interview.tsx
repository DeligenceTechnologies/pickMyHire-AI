"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * Shown when the candidate arrives before their questions are ready (they're prepared in the background
 * right after the invite). Checks every few seconds and opens the interview by itself, without a reload,
 * so the click that brought them here still lets the introduction play.
 */
export function PreparingInterview({ token }: { token: string }) {
  const router = useRouter();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    let stopped = false;
    const started = Date.now();
    const check = async () => {
      if (stopped) return;
      try {
        const res = await fetch(`/api/public/interview/${token}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (data.plan_ready || data.plan_failed || !res.ok) { router.refresh(); return; }
      } catch { /* try again */ }
      if (Date.now() - started > 90_000) setSlow(true);
      setTimeout(check, 4000);
    };
    const t = setTimeout(check, 3000);
    return () => { stopped = true; clearTimeout(t); };
  }, [token, router]);
  return (
    <div className="mx-auto max-w-md rounded-xl border bg-card p-8 text-center">
      <Loader2 className="mx-auto size-8 animate-spin text-primary" aria-hidden />
      <h1 className="mt-4 text-lg font-semibold">Getting your interview ready</h1>
      <p aria-live="polite" className="mt-2 text-sm text-muted-foreground">
        {slow ? "This is taking longer than usual. Keep this page open; it will open by itself, or reload it in a minute."
          : "Your questions are being prepared. This usually takes under a minute, and this page opens by itself."}
      </p>
    </div>
  );
}
