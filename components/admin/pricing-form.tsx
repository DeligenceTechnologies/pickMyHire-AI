"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { FormCard } from "@/components/settings/form-card";
import { TiersEditor } from "@/components/pricing/tiers-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/lib/client/use-action";
import { money, PricingSchema, tierRange, type PriceTier, type Pricing } from "@/lib/pricing";
import type { CostAssumptions } from "@/lib/services/pricing";

const LENGTHS = [15, 30, 40];

/** Profit per interview at a few interview lengths, for each volume price. Admin only. */
export function MarginPreview({ tiers, costs, pricing }: { tiers: PriceTier[]; costs: CostAssumptions; pricing: Pricing }) {
  const p = { ...pricing, tiers };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-muted-foreground">
          <th className="py-2 pr-3 font-medium">Interviews</th><th className="py-2 pr-3 font-medium">Price</th>
          {LENGTHS.map((m) => <th key={m} className="py-2 pr-3 text-right font-medium">{m}-min interview</th>)}
        </tr></thead>
        <tbody className="divide-y">
          {tiers.map((t, i) => {
            const price = t.cents / 100;
            const card = (price * costs.cardPercent) / 100 + costs.cardFixed / t.min; // card fee shared over the smallest purchase in this tier
            return (
              <tr key={i}>
                <td className="py-2 pr-3 tabular">{tierRange(i, p)}</td>
                <td className="py-2 pr-3 font-medium tabular">{money(t.cents)}</td>
                {LENGTHS.map((m) => {
                  const cost = m * costs.perMinute + costs.fixedPerInterview + card;
                  const margin = Math.round(((price - cost) / price) * 100);
                  return (
                    <td key={m} className={`py-2 pr-3 text-right tabular ${margin < 0 ? "font-semibold text-red-600 dark:text-red-400" : margin < 20 ? "text-amber-700 dark:text-amber-400" : ""}`}>
                      {margin}% <span className="text-xs text-muted-foreground">({money(Math.round((price - cost) * 100))})</span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">Profit per interview after AI, server and card fees. Red = loses money, amber = under 20%.</p>
    </div>
  );
}

function Num({ id, label, value, onChange, step = 1, hint, min = 0 }: { id: string; label: string; value: number; onChange: (n: number) => void; step?: number; hint?: string; min?: number }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} required>{label}</Label>
      <Input id={id} type="number" min={min} step={step} value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} className="tabular" />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function PricingForm({ initial, initialCosts, trialInterviews }: { initial: Pricing; initialCosts: CostAssumptions; trialInterviews: number }) {
  const { run, pending } = useAction();
  const [p, setP] = useState<Pricing>(initial);
  const [costs, setCosts] = useState<CostAssumptions>(initialCosts);
  const set = (patch: Partial<Pricing>) => setP((x) => ({ ...x, ...patch }));
  const setC = (patch: Partial<CostAssumptions>) => setCosts((x) => ({ ...x, ...patch }));
  const check = PricingSchema.safeParse(p);
  const problem = check.success ? null : check.error.issues[0]?.message;
  const changed = JSON.stringify(p) !== JSON.stringify(initial) || JSON.stringify(costs) !== JSON.stringify(initialCosts);
  return (
    <div className="space-y-6">
      <FormCard title="Prices" description={`Every company pays these unless it has its own prices (set on the company's page). New companies also get ${trialInterviews} free interviews (Settings → Free trial).`}>
        <TiersEditor idPrefix="std" tiers={p.tiers} onChange={(tiers) => set({ tiers })} />
        <div className="space-y-2 border-t pt-4">
          <div className="flex items-center gap-3 text-sm font-medium">
            <Switch checked={p.contactFrom !== null} onCheckedChange={(c) => set({ contactFrom: c ? Math.max(p.tiers[p.tiers.length - 1].min * 2, 250) : null })} aria-label="Large purchases: talk to us" />
            <span aria-hidden>Large purchases: “Talk to us” instead of buying online</span>
          </div>
          {p.contactFrom !== null && (
            <div className="max-w-xs"><Num id="contact-from" label="From (interviews)" min={2} value={p.contactFrom} onChange={(n) => set({ contactFrom: Math.max(2, Math.floor(n)) })} /></div>
          )}
        </div>
      </FormCard>

      <FormCard title="Interview length and recordings">
        <div className="grid gap-4 sm:grid-cols-2">
          <Num id="advertised" label="Advertised length (minutes)" value={p.advertisedMinutes} onChange={(n) => set({ advertisedMinutes: Math.floor(n) })} hint="Shown on the pricing page: “up to 30 minutes”." />
          <Num id="per-interview" label="Counts as one interview up to (minutes)" value={p.minutesPerInterview} onChange={(n) => set({ minutesPerInterview: Math.floor(n) })} hint="Longer templates count as 2. Companies confirm this when saving the template." />
          <Num id="max-minutes" label="Longest interview allowed (minutes)" value={p.maxMinutes} onChange={(n) => set({ maxMinutes: Math.floor(n) })} />
          <Num id="recording-months" label="Keep recordings for (months)" value={p.recordingMonths} onChange={(n) => set({ recordingMonths: Math.floor(n) })} hint="Reports, transcripts and scores stay while the account is active." />
        </div>
        <div className="space-y-2 border-t pt-4">
          <div className="flex items-center gap-3 text-sm font-medium">
            <Switch checked={p.recommended !== null} onCheckedChange={(c) => set({ recommended: c ? (p.tiers[1]?.min ?? p.tiers[0].min) : null })} aria-label="Mark a recommended pack" />
            <span aria-hidden>Mark a pack as “Recommended” on the pricing page and in Billing</span>
          </div>
          {p.recommended !== null && (
            <div className="max-w-xs"><Num id="recommended" label="Recommended pack (interviews)" min={1} value={p.recommended} onChange={(n) => set({ recommended: Math.max(1, Math.floor(n)) })} hint="It's also the number chosen first in the calculator." /></div>
          )}
        </div>
      </FormCard>

      <FormCard title="Profit preview" description="Your cost assumptions. Only platform admins see this; it's never shown to companies."
        footer={<>
          {problem && <p className="mr-auto self-center text-sm text-destructive">{problem}</p>}
          <Button variant="ghost" disabled={!changed || !!pending} onClick={() => { setP(initial); setCosts(initialCosts); }}>Undo changes</Button>
          <Button disabled={!changed || !!problem || !!pending} onClick={() => run("save", "/api/admin/pricing", { method: "PUT", body: { pricing: p, costs }, success: "Pricing saved. The pricing page and every company without its own prices now use it." })}>
            {pending === "save" && <Loader2 className="animate-spin" />} Save pricing
          </Button>
        </>}>
        <div className="grid gap-4 sm:grid-cols-4">
          <Num id="c-min" label="AI per minute ($)" step={0.001} value={costs.perMinute} onChange={(n) => setC({ perMinute: n })} />
          <Num id="c-fixed" label="Server per interview ($)" step={0.01} value={costs.fixedPerInterview} onChange={(n) => setC({ fixedPerInterview: n })} />
          <Num id="c-pct" label="Card fee (%)" step={0.1} value={costs.cardPercent} onChange={(n) => setC({ cardPercent: n })} />
          <Num id="c-fix" label="Card fee per payment ($)" step={0.01} value={costs.cardFixed} onChange={(n) => setC({ cardFixed: n })} />
        </div>
        <MarginPreview tiers={p.tiers} costs={costs} pricing={p} />
      </FormCard>
    </div>
  );
}
