import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSystem } from "@/lib/database/db";
import { DEFAULT_PRICING } from "@/lib/pricing";
import { DEFAULT_COSTS, getPricing, getPricingFor, listCompanyPricing, saveCompanyPricing, savePricing } from "@/lib/services/pricing";
import { createTemplate } from "@/lib/services/templates";

const id = Date.now().toString(36);
let orgId = "", adminId = "";
let savedBefore: { value: unknown } | undefined;
const section = (m: number) => ({ name: "Part", description: "", objective: "", instructions: "", duration_minutes: m, min_questions: 1, max_questions: 2, max_followups: 1, evaluation_criteria: [], scoring_enabled: false, enabled: true });

beforeAll(async () => {
  await withSystem(async (tx) => {
    [savedBefore] = await tx<{ value: unknown }[]>`select value from platform_settings where key = 'pricing'`;
    const [o] = await tx<{ id: string }[]>`insert into organizations (name, slug, interview_quota) values (${`Price Co ${id}`}, ${`price-co-${id}`}, null) returning id`;
    orgId = o.id;
    const [u] = await tx<{ id: string }[]>`insert into users (email, name, password_hash) values (${`owner-${id}@price.test`}, 'Owner', 'x') returning id`;
    adminId = u.id;
    await tx`insert into organization_members (organization_id, user_id, role) values (${orgId}, ${adminId}, 'owner')`;
  });
});

afterAll(async () => {
  await withSystem(async (tx) => {
    if (savedBefore) await tx`update platform_settings set value = ${tx.json(savedBefore.value as never)} where key = 'pricing'`;
    else await tx`delete from platform_settings where key in ('pricing', 'pricing_costs')`;
    await tx`delete from organizations where id = ${orgId}`;
    await tx`delete from users where id = ${adminId}`;
  });
});

describe("pricing settings", () => {
  it("standard prices apply to every company until the admin gives one its own", async () => {
    await savePricing(adminId, { ...DEFAULT_PRICING, tiers: [{ min: 10, cents: 349 }, { min: 50, cents: 299 }] }, DEFAULT_COSTS);
    expect((await getPricing()).tiers[0].cents).toBe(349);
    expect(await getPricingFor(orgId)).toMatchObject({ custom: false, pricing: { tiers: [{ min: 10, cents: 349 }, { min: 50, cents: 299 }] } });

    await saveCompanyPricing(adminId, orgId, { tiers: [{ min: 5, cents: 199 }], note: "Agency deal" });
    expect(await getPricingFor(orgId)).toMatchObject({ custom: true, pricing: { tiers: [{ min: 5, cents: 199 }], maxMinutes: DEFAULT_PRICING.maxMinutes } });
    expect((await listCompanyPricing()).find((c) => c.id === orgId)?.pricing.note).toBe("Agency deal");

    await saveCompanyPricing(adminId, orgId, null);
    expect((await getPricingFor(orgId)).custom).toBe(false);
  });

  it("templates can't be longer than the longest interview allowed", async () => {
    await savePricing(adminId, DEFAULT_PRICING, DEFAULT_COSTS);
    await expect(createTemplate(orgId, adminId, { name: "Long", description: "", sections: [section(50), section(40)] })).rejects.toThrow(/up to 80 minutes/);
    await expect(createTemplate(orgId, adminId, { name: "Two credits", description: "", sections: [section(45), section(30)] })).resolves.toBeTruthy();
  });
});
