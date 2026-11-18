import { describe, expect, it } from "vitest";
import { expiredUnused, refundShare } from "@/lib/services/billing";

describe("refunds take back the refunded share of a purchase", () => {
  const p = { quantity: 50, total_cents: 12_450, interviews_added: 50, interviews_expired: 0 };
  it("full refund takes back every interview", () => {
    expect(refundShare(p, 12_450)).toEqual({ refunded: 12_450, keep: 0, takeBack: 50, full: true });
  });
  it("half refund takes back half", () => {
    expect(refundShare(p, 6_225)).toMatchObject({ keep: 25, takeBack: 25, full: false });
  });
  it("a small refund rounds in the customer's favour (never takes back more than paid for)", () => {
    expect(refundShare(p, 100)).toMatchObject({ keep: 49, takeBack: 1 });
  });
  it("a refund larger than the total is capped", () => {
    expect(refundShare(p, 99_999)).toMatchObject({ refunded: 12_450, keep: 0, full: true });
  });
  it("interviews that already expired aren't taken back twice", () => {
    expect(refundShare({ ...p, interviews_added: 30, interviews_expired: 20 }, 12_450)).toMatchObject({ keep: 0, takeBack: 30 });
    expect(refundShare({ ...p, interviews_added: 30, interviews_expired: 20 }, 6_225)).toMatchObject({ keep: 5, takeBack: 25 });
  });
});

describe("expiry removes only what's left of the expiring purchase", () => {
  it("nothing used: the whole purchase expires", () => {
    expect(expiredUnused(50, 0, [50])).toEqual([50]);
  });
  it("some used: older interviews were used first, so only the rest expires", () => {
    expect(expiredUnused(20, 0, [50])).toEqual([20]);
  });
  it("a newer valid purchase keeps its interviews", () => {
    // 50 old (expiring) + 100 new; 30 used in total → 120 left. The new 100 stay; 20 of the old ones expire.
    expect(expiredUnused(120, 100, [50])).toEqual([20]);
    // Balance already below the newer purchase: nothing of the old one is left.
    expect(expiredUnused(80, 100, [50])).toEqual([0]);
  });
  it("two purchases expiring together, oldest first", () => {
    // 10 + 50 expiring, 100 still valid, 130 left → 30 of the second expiring purchase are left, none of the first.
    expect(expiredUnused(130, 100, [10, 50])).toEqual([0, 30]);
    expect(expiredUnused(160, 100, [10, 50])).toEqual([10, 50]);
  });
  it("never goes negative", () => {
    expect(expiredUnused(-5, 0, [10])).toEqual([0]);
  });
});
