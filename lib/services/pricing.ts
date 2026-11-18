import "server-only";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import { json, withSystem } from "@/lib/database/db";
import { CompanyPricingSchema, DEFAULT_PRICING, effectivePricing, PricingSchema, type CompanyPricing, type Pricing } from "@/lib/pricing";
import { platformAudit, writeSetting } from "./platform";

// Standard pricing is in platform_settings ('pricing'); a company's own prices are in organizations.pricing.
// Cost assumptions ('pricing_costs') are for the admin's margin preview only and never leave the admin area.

export type CostAssumptions = {
  /** All AI cost per interview minute, in dollars (OpenAI bill ÷ interview minutes). */
  perMinute: number;
  /** Server, database and email per interview, in dollars. */
  fixedPerInterview: number;
  /** Card fee: percent of the payment, plus a fixed amount per payment. */
  cardPercent: number;
  cardFixed: number;
};
export const DEFAULT_COSTS: CostAssumptions = { perMinute: 0.064, fixedPerInterview: 0.16, cardPercent: 4.5, cardFixed: 0.22 };
export const CostSchema = z.object({
  perMinute: z.number().min(0).max(10), fixedPerInterview: z.number().min(0).max(100),
  cardPercent: z.number().min(0).max(20), cardFixed: z.number().min(0).max(10),
});

async function read<T>(key: string): Promise<T | null> {
  const [row] = await withSystem((tx) => tx<{ value: T }[]>`select value from platform_settings where key = ${key}`);
  return row?.value ?? null;
}

/** Standard pricing (what the public pricing page shows). Falls back to the defaults if a saved value is broken. */
export async function getPricing(): Promise<Pricing> {
  const saved = await read<unknown>("pricing");
  const parsed = PricingSchema.safeParse({ ...DEFAULT_PRICING, ...(saved && typeof saved === "object" ? saved : {}) });
  return parsed.success ? parsed.data : DEFAULT_PRICING;
}

export async function getCostAssumptions(): Promise<CostAssumptions> {
  const parsed = CostSchema.safeParse({ ...DEFAULT_COSTS, ...((await read<object>("pricing_costs")) ?? {}) });
  return parsed.success ? parsed.data : DEFAULT_COSTS;
}

export async function getCompanyPricing(orgId: string): Promise<CompanyPricing | null> {
  const [row] = await withSystem((tx) => tx<{ pricing: unknown }[]>`select pricing from organizations where id = ${orgId}`);
  const parsed = CompanyPricingSchema.safeParse(row?.pricing);
  return parsed.success ? parsed.data : null;
}

/** The prices this company pays: its own prices if the admin set any, otherwise standard pricing. */
export async function getPricingFor(orgId: string): Promise<{ pricing: Pricing; custom: boolean }> {
  const [standard, company] = await Promise.all([getPricing(), getCompanyPricing(orgId)]);
  return { pricing: effectivePricing(standard, company), custom: !!company };
}

export async function savePricing(adminId: string, pricing: Pricing, costs: CostAssumptions) {
  await withSystem(async (tx) => {
    await writeSetting(tx, "pricing", pricing, adminId);
    await writeSetting(tx, "pricing_costs", costs, adminId);
    await platformAudit(tx, { adminId, action: "pricing.updated", targetType: "platform", details: { pricing } });
  });
}

export async function saveCompanyPricing(adminId: string, orgId: string, pricing: CompanyPricing | null) {
  await withSystem(async (tx) => {
    const [org] = await tx<{ name: string }[]>`update organizations set pricing = ${pricing ? json(pricing) : null} where id = ${orgId} returning name`;
    if (!org) throw new ApiError(404, "Company not found");
    await platformAudit(tx, { adminId, action: pricing ? "company.pricing_set" : "company.pricing_cleared", targetType: "organization", targetId: orgId, details: { name: org.name, pricing } });
  });
}

/** Companies with their own prices, for the admin pricing page. */
export async function listCompanyPricing() {
  const rows = await withSystem((tx) => tx<{ id: string; name: string; pricing: unknown }[]>`
    select id, name, pricing from organizations where pricing is not null order by name`);
  return rows.flatMap((r) => {
    const p = CompanyPricingSchema.safeParse(r.pricing);
    return p.success ? [{ id: r.id, name: r.name, pricing: p.data }] : [];
  });
}
