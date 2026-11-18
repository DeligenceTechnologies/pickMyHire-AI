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
import { CompanyPricingSchema, money, tierRange, type CompanyPricing, type Pricing } from "@/lib/pricing";

/** Admin: give one company its own volume prices, or keep it on standard pricing. */
export function CompanyPricingCard({ id, standard, initial }: { id: string; standard: Pricing; initial: CompanyPricing | null }) {
  const { run, pending } = useAction();
  const [custom, setCustom] = useState(!!initial);
  const [tiers, setTiers] = useState(initial?.tiers ?? standard.tiers);
  const [note, setNote] = useState(initial?.note ?? "");
  const value: CompanyPricing | null = custom ? { tiers, note: note.trim() || null } : null;
  const check = value ? CompanyPricingSchema.safeParse(value) : null;
  const problem = check && !check.success ? check.error.issues[0]?.message : null;
  const changed = JSON.stringify(value) !== JSON.stringify(initial);
  const shown = { ...standard, tiers: custom ? tiers : standard.tiers };
  return (
    <FormCard title="Pricing" description={custom ? "This company has its own prices." : "Standard pricing (Admin → Pricing)."}
      footer={<>
        {problem && <p className="mr-auto self-center text-sm text-destructive">{problem}</p>}
        <Button disabled={!changed || !!problem || !!pending} onClick={() => run("pricing", `/api/admin/companies/${id}/pricing`, { method: "PUT", body: { pricing: value }, success: custom ? "Company prices saved" : "Back on standard pricing" })}>
          {pending === "pricing" && <Loader2 className="animate-spin" />} Save
        </Button>
      </>}>
      <div className="flex items-center gap-3 text-sm font-medium">
        <Switch checked={custom} onCheckedChange={(c) => { setCustom(!!c); if (c && !initial) setTiers(standard.tiers); }} aria-label="Use this company's own prices" />
        <span aria-hidden>Own prices for this company</span>
      </div>
      {custom ? (
        <>
          <TiersEditor idPrefix={`co-${id}`} tiers={tiers} onChange={setTiers} />
          <div className="space-y-1.5">
            <Label htmlFor={`co-note-${id}`}>Note <span className="font-normal text-muted-foreground">(only admins see it)</span></Label>
            <Input id={`co-note-${id}`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Agency deal, agreed 12 Nov" />
          </div>
        </>
      ) : (
        <ul className="space-y-1 text-sm">
          {standard.tiers.map((t, i) => (
            <li key={i} className="flex justify-between"><span className="text-muted-foreground">{tierRange(i, shown)} interviews</span><span className="font-medium tabular">{money(t.cents)} each</span></li>
          ))}
        </ul>
      )}
    </FormCard>
  );
}
