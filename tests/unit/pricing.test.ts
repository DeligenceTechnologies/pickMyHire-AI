import { describe, expect, it } from "vitest";
import { CompanyPricingSchema, DEFAULT_PRICING as P, defaultQty, effectivePricing, fitDurations, interviewsFor, money, PricingSchema, quote, tierRange } from "@/lib/pricing";

describe("pay-per-interview quotes", () => {
  it("any number from 10 up, with the volume price for the whole purchase", () => {
    expect(quote(10, P)).toMatchObject({ unitCents: 299, totalCents: 2990, savingsCents: 0, belowMin: false, contact: false });
    expect(quote(12, P).totalCents).toBe(3588);
    expect(quote(23, P).totalCents).toBe(6877);
    expect(quote(55, P)).toMatchObject({ unitCents: 249, totalCents: 13695, savingsCents: 2750, savingPct: 17 });
    expect(quote(100, P)).toMatchObject({ unitCents: 219, totalCents: 21900, savingPct: 27 });
  });

  it("below the smallest pack, and talk-to-us for big ones", () => {
    expect(quote(9, P).belowMin).toBe(true);
    expect(quote(249, P).contact).toBe(false);
    expect(quote(250, P).contact).toBe(true);
  });

  it("points out when a bigger pack costs less in total", () => {
    expect(quote(45, P).better).toEqual({ qty: 50, totalCents: 12450, savesCents: 13455 - 12450 });
    expect(quote(40, P).better).toBeNull(); // 40 × 2.99 = 119.60 < 124.50
    expect(quote(95, P).better).toEqual({ qty: 100, totalCents: 21900, savesCents: 23655 - 21900 });
    expect(quote(50, P).better).toBeNull();
  });

  it("labels tiers for the pricing page", () => {
    expect([0, 1, 2].map((i) => tierRange(i, P))).toEqual(["10–49", "50–99", "100–249"]);
    expect(tierRange(2, { ...P, contactFrom: null })).toBe("100+");
    expect(money(299)).toBe("$2.99");
    expect(money(13695)).toBe("$136.95");
    expect(defaultQty(P)).toBe(50);
    expect(defaultQty({ ...P, recommended: null })).toBe(10);
  });

  it("a company's own prices replace only the tiers", () => {
    const own = { tiers: [{ min: 10, cents: 199 }], note: "Agency" };
    expect(effectivePricing(P, own)).toEqual({ ...P, tiers: own.tiers });
    expect(effectivePricing(P, null)).toBe(P);
    expect(quote(30, effectivePricing(P, own)).totalCents).toBe(5970);
    // "Recommended 50" stays only while the company can buy 50 online.
    expect(effectivePricing(P, { tiers: [{ min: 100, cents: 199 }], note: null }).recommended).toBeNull();
  });
});

describe("interview length", () => {
  it("up to the set length is one interview, longer counts as two", () => {
    expect([1, 30, 50, 51, 100].map((m) => interviewsFor(m, P))).toEqual([1, 1, 1, 2, 2]); // default: 50 minutes
    expect([40, 41, 80].map((m) => interviewsFor(m, { minutesPerInterview: 40 }))).toEqual([1, 2, 2]);
  });

  it("shortens sections in proportion to fit 40 minutes, keeping each at least a minute", () => {
    const secs = [5, 7, 10, 12, 7, 5, 3].map((d) => ({ duration_minutes: d, enabled: true }));
    const out = fitDurations(secs, 40);
    expect(out.reduce((a, b) => a + b, 0)).toBe(40);
    expect(out.every((d, i) => d >= 1 && d <= secs[i].duration_minutes)).toBe(true);
    const withOff = [{ duration_minutes: 30, enabled: true }, { duration_minutes: 50, enabled: false }, { duration_minutes: 30, enabled: true }];
    expect(fitDurations(withOff, 40)).toEqual([20, 50, 20]); // the switched-off section isn't touched
    expect(fitDurations([{ duration_minutes: 1, enabled: true }, { duration_minutes: 60, enabled: true }], 40)).toEqual([1, 39]);
    expect(fitDurations(secs.slice(0, 2), 40)).toEqual([5, 7]); // already short enough
  });
});

describe("admin price checks", () => {
  it("accepts the defaults and rejects broken tiers", () => {
    expect(PricingSchema.safeParse(P).success).toBe(true);
    expect(PricingSchema.safeParse({ ...P, tiers: [{ min: 10, cents: 299 }, { min: 10, cents: 249 }] }).success).toBe(false);
    expect(PricingSchema.safeParse({ ...P, tiers: [{ min: 10, cents: 249 }, { min: 50, cents: 299 }] }).success).toBe(false);
    expect(PricingSchema.safeParse({ ...P, contactFrom: 5 }).success).toBe(false);
    expect(PricingSchema.safeParse({ ...P, advertisedMinutes: 55 }).success).toBe(false);
    expect(PricingSchema.safeParse({ ...P, recommended: 5 }).success).toBe(false); // below the smallest pack
    expect(PricingSchema.safeParse({ ...P, recommended: 300 }).success).toBe(false); // "talk to us" range
    expect(PricingSchema.safeParse({ ...P, recommended: null }).success).toBe(true);
    expect(CompanyPricingSchema.safeParse({ tiers: [{ min: 10, cents: 0 }], note: null }).success).toBe(false);
  });
});
