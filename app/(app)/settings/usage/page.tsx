import Link from "next/link";
import { FormCard } from "@/components/settings/form-card";
import { requireAuth } from "@/lib/auth/session";
import { getUsage } from "@/lib/services/workspace";
import { getQuotaStatus } from "@/lib/services/quota";
import { formatDate } from "@/lib/format";
import { RedeemCouponBox } from "@/components/coupons/redeem-coupon";

export const metadata = { title: "Usage" };

const FEATURE: Record<string, string> = {
  resume_parser: "Resume parsing", job_parser: "Job parsing", interview_planner: "Interview planning", answer_analyzer: "Answer analysis",
  followup_engine: "Follow-up decisions", section_evaluator: "Section evaluation", report_generator: "Report generation", realtime_session: "Realtime sessions",
};

export default async function UsagePage() {
  const auth = await requireAuth("usage:view");
  const [{ byFeature, interviews }, quota] = await Promise.all([getUsage(auth.orgId), getQuotaStatus(auth.orgId)]);
  const totalTokens = byFeature.reduce((a, f) => a + f.input_tokens + f.output_tokens, 0);
  return (
    <>
      <FormCard title="Free interviews" description={quota.quota === null ? "Your plan has unlimited interviews." : `An interview counts once the candidate completes it (since ${formatDate(quota.countedFrom)}). Interviews sent but not finished hold a slot.`}>
        {quota.quota === null ? <p className="text-sm">{quota.used} completed · {quota.inProgress} in progress</p> : (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-2xl font-semibold tabular">{quota.used} <span className="text-base font-normal text-muted-foreground">of {quota.quota} used</span></p>
              <p className="text-sm text-muted-foreground tabular">{quota.inProgress} in progress · {quota.remaining} left</p>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
              <span className="bg-primary" style={{ width: `${Math.min(100, (quota.used / Math.max(1, quota.quota)) * 100)}%` }} />
              <span className="bg-primary/40" style={{ width: `${Math.min(100, (quota.inProgress / Math.max(1, quota.quota)) * 100)}%` }} />
            </div>
            {quota.remaining === 0 && <p className="text-sm text-muted-foreground">You&apos;ve reached your limit. <Link href="/#contact" className="font-medium text-primary hover:underline">Contact us</Link> to add more interviews, or apply a promo code below.</p>}
          </>
        )}
      </FormCard>
      <FormCard title="Promo code" description="Got a code from us? Apply it to add free interviews or extra trial days. Each code can be used once per company.">
        <div className="max-w-md"><RedeemCouponBox /></div>
      </FormCard>
      <div className="grid gap-4 sm:grid-cols-3">
        {[["Interviews completed (30d)", interviews.total], ["Interview minutes (30d)", interviews.minutes], ["AI tokens (30d)", totalTokens.toLocaleString()]].map(([k, v]) => (
          <div key={String(k)} className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">{k}</p><p className="mt-1 text-2xl font-semibold tabular">{v}</p></div>
        ))}
      </div>
      <FormCard title="AI calls by feature" description="Last 30 days. Realtime audio usage is billed by OpenAI per session minute and isn't tokenized here.">
        {byFeature.length === 0 ? <p className="text-sm text-muted-foreground">No AI usage recorded yet.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="pb-2 font-medium">Feature</th><th className="pb-2 text-right font-medium">Calls</th><th className="pb-2 text-right font-medium">Failures</th><th className="pb-2 text-right font-medium">Tokens in / out</th><th className="pb-2 text-right font-medium">Avg latency</th></tr></thead>
            <tbody className="divide-y">
              {byFeature.map((f) => (
                <tr key={f.feature}><td className="py-2">{FEATURE[f.feature] ?? f.feature}</td><td className="py-2 text-right tabular">{f.calls}</td><td className="py-2 text-right tabular">{f.failures}</td><td className="py-2 text-right tabular">{f.input_tokens.toLocaleString()} / {f.output_tokens.toLocaleString()}</td><td className="py-2 text-right tabular">{(f.avg_ms / 1000).toFixed(1)}s</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </FormCard>
    </>
  );
}
