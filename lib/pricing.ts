// Pay-per-interview pricing, shared by the pricing page, Billing, templates and the platform admin.
// Prices are whole cents. Buying more interviews at once lowers the price of every interview in that purchase.
import { z } from "zod";

export type PriceTier = { min: number; cents: number };

export type Pricing = {
  /** Sorted by `min`. The first tier's `min` is the smallest purchase. */
  tiers: PriceTier[];
  /** From this many interviews, buyers talk to us instead (null = no limit). */
  contactFrom: number | null;
  /** The length we advertise per interview ("up to 30 minutes"). */
  advertisedMinutes: number;
  /** Interviews up to this length count as 1; longer ones count as 2 (and so on). */
  minutesPerInterview: number;
  /** Longest interview a template can have. */
  maxMinutes: number;
  /** Recordings are deleted after this many months; reports and transcripts stay while the account is active. */
  recordingMonths: number;
  /** The pack size marked "Recommended" and chosen first (null = none). */
  recommended: number | null;
};

/** The "running low" warning shows at or below this many interviews left. */
export const LOW_BALANCE = 5;

export const DEFAULT_PRICING: Pricing = {
  tiers: [{ min: 10, cents: 299 }, { min: 50, cents: 249 }, { min: 100, cents: 219 }],
  contactFrom: 250,
  advertisedMinutes: 30,
  minutesPerInterview: 50,
  maxMinutes: 80,
  recordingMonths: 6,
  recommended: 50,
};

/** A company's own prices, set by the platform admin. Everything else follows the standard pricing. */
export type CompanyPricing = { tiers: PriceTier[]; note: string | null };

const TierSchema = z.object({ min: z.number().int().min(1).max(100_000), cents: z.number().int().min(1).max(100_000) });

const TiersSchema = z.array(TierSchema).min(1).max(8).superRefine((tiers, ctx) => {
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].min <= tiers[i - 1].min) ctx.addIssue({ code: "custom", path: [i, "min"], message: "Each tier must start at a larger quantity than the one before." });
    if (tiers[i].cents > tiers[i - 1].cents) ctx.addIssue({ code: "custom", path: [i, "cents"], message: "Bigger tiers can't cost more per interview." });
  }
});

export const PricingSchema = z.object({
  tiers: TiersSchema,
  contactFrom: z.number().int().min(2).max(1_000_000).nullable(),
  advertisedMinutes: z.number().int().min(5).max(120),
  minutesPerInterview: z.number().int().min(5).max(120),
  maxMinutes: z.number().int().min(5).max(240),
  recordingMonths: z.number().int().min(1).max(60),
  recommended: z.number().int().min(1).max(100_000).nullable(),
}).superRefine((p, ctx) => {
  if (p.advertisedMinutes > p.minutesPerInterview) ctx.addIssue({ code: "custom", path: ["advertisedMinutes"], message: "The advertised length can't be longer than the length that counts as one interview." });
  if (p.maxMinutes < p.minutesPerInterview) ctx.addIssue({ code: "custom", path: ["maxMinutes"], message: "The longest interview must be at least the length that counts as one interview." });
  if (p.contactFrom !== null && p.contactFrom <= p.tiers[0].min) ctx.addIssue({ code: "custom", path: ["contactFrom"], message: "\"Talk to us\" must start above the smallest purchase." });
  if (p.recommended !== null && (p.recommended < p.tiers[0].min || (p.contactFrom !== null && p.recommended >= p.contactFrom))) {
    ctx.addIssue({ code: "custom", path: ["recommended"], message: "The recommended pack must be one people can buy online." });
  }
});

export const CompanyPricingSchema = z.object({ tiers: TiersSchema, note: z.string().trim().max(300).nullable() });

/** Standard pricing with the company's own prices on top, if it has any. */
export function effectivePricing(standard: Pricing, company: CompanyPricing | null): Pricing {
  if (!company) return standard;
  const p = { ...standard, tiers: company.tiers };
  // Keep "Recommended" only if this company can still buy that pack online.
  const ok = p.recommended !== null && p.recommended >= p.tiers[0].min && (p.contactFrom === null || p.recommended < p.contactFrom);
  return ok ? p : { ...p, recommended: null };
}

export const minPurchase = (p: Pricing) => p.tiers[0].min;

export function tierFor(qty: number, p: Pricing): PriceTier {
  let t = p.tiers[0];
  for (const x of p.tiers) if (qty >= x.min) t = x;
  return t;
}

export type Quote = {
  qty: number;
  unitCents: number;
  totalCents: number;
  /** Saving against the smallest tier's price. */
  savingsCents: number;
  savingPct: number;
  /** Below the smallest purchase. */
  belowMin: boolean;
  /** At or above `contactFrom`: talk to us. */
  contact: boolean;
  /** Buying this many instead costs less in total (e.g. 50 instead of 48). */
  better: { qty: number; totalCents: number; savesCents: number } | null;
};

export function quote(rawQty: number, p: Pricing): Quote {
  const qty = Math.max(0, Math.floor(rawQty || 0));
  const t = tierFor(qty, p);
  const base = p.tiers[0].cents;
  const totalCents = qty * t.cents;
  let better: Quote["better"] = null;
  for (const x of p.tiers) {
    if (x.min <= qty || (p.contactFrom !== null && x.min >= p.contactFrom)) continue;
    const alt = x.min * x.cents;
    if (alt <= totalCents && (!better || alt < better.totalCents)) better = { qty: x.min, totalCents: alt, savesCents: totalCents - alt };
  }
  return {
    qty, unitCents: t.cents, totalCents,
    savingsCents: qty * (base - t.cents), savingPct: Math.round((1 - t.cents / base) * 100),
    belowMin: qty < minPurchase(p), contact: p.contactFrom !== null && qty >= p.contactFrom, better,
  };
}

/** How many interviews one interview of this length uses (1 up to `minutesPerInterview`, then 2, …). */
export function interviewsFor(minutes: number, p: Pick<Pricing, "minutesPerInterview">): number {
  return Math.max(1, Math.ceil(minutes / p.minutesPerInterview));
}

export function money(cents: number, opts: { whole?: boolean } = {}): string {
  const whole = opts.whole && cents % 100 === 0;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(cents / 100);
}

/**
 * An amount Stripe gives in a currency's smallest unit (paise, cents, or whole yen), e.g. what a buyer
 * paid in their own currency: localMoney(254000, "inr") → "₹2,540.00".
 */
export function localMoney(amount: number, currency: string): string {
  try {
    const f = new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() });
    const digits = f.resolvedOptions().maximumFractionDigits ?? 2;
    return f.format(amount / 10 ** digits);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/** "$29.90 USD (paid ₹2,540.00 INR)" style note, or null when the buyer paid in USD. */
export function localPaidNote(p: { local_amount?: number | null; local_currency?: string | null }): string | null {
  return p.local_amount != null && p.local_currency ? `${localMoney(p.local_amount, p.local_currency)} ${p.local_currency.toUpperCase()}` : null;
}

const TIER_NAMES = ["Starter", "Growth", "Scale", "Volume"];
/** A short name for each volume price, for the pack cards. */
export const tierName = (i: number) => TIER_NAMES[i] ?? `Pack ${i + 1}`;

/** The pack size to suggest and select first: the recommended one, or the smallest. */
export const defaultQty = (p: Pricing) => p.recommended ?? minPurchase(p);

/** "10–49", "50–99", "100+" (or "100–249" when talk-to-us starts at 250). */
export function tierRange(i: number, p: Pricing): string {
  const t = p.tiers[i];
  const next = p.tiers[i + 1]?.min ?? p.contactFrom;
  return next ? `${t.min}–${next - 1}` : `${t.min}+`;
}

/**
 * Shorten enabled sections in proportion so their total fits `target` minutes (each at least 1 minute).
 * Returns new durations in the same order; disabled sections are left alone.
 */
export function fitDurations(sections: { duration_minutes: number; enabled: boolean }[], target: number): number[] {
  const on = sections.map((s, i) => ({ i, d: s.duration_minutes })).filter((_, i) => sections[i].enabled);
  const total = on.reduce((a, s) => a + s.d, 0);
  const out = sections.map((s) => s.duration_minutes);
  if (total <= target || !on.length) return out;
  const scaled = on.map((s) => ({ ...s, exact: (s.d * target) / total }));
  for (const s of scaled) out[s.i] = Math.max(1, Math.floor(s.exact));
  let left = target - scaled.reduce((a, s) => a + out[s.i], 0);
  // Hand back the rounding minutes to the sections that lost the most, then trim if the 1-minute floor overshot.
  for (const s of [...scaled].sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)))) {
    if (left <= 0) break;
    out[s.i]++; left--;
  }
  for (const s of [...scaled].sort((a, b) => out[b.i] - out[a.i])) {
    if (left >= 0) break;
    if (out[s.i] > 1) { out[s.i]--; left++; }
  }
  return out;
}
