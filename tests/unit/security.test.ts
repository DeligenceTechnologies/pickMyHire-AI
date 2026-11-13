import { describe, expect, it } from "vitest";
import { assignableRoles, can } from "@/lib/auth/permissions";
import { hashPassword, verifyPassword } from "@/lib/security/password";
import { clientIp, isRateLimited, rateLimit } from "@/lib/security/rate-limit";
import { safeNext } from "@/lib/security/safe-redirect";
import { generateToken, hashToken, isWellFormedToken } from "@/lib/security/tokens";

describe("permissions", () => {
  it("grants owners everything", () => {
    expect(can("owner", "billing:manage")).toBe(true);
    expect(can("owner", "data:delete")).toBe(true);
  });
  it("keeps viewers read-only", () => {
    expect(can("viewer", "report:view")).toBe(true);
    expect(can("viewer", "job:write")).toBe(false);
    expect(can("viewer", "recording:view")).toBe(false);
  });
  it("lets interviewers view but not manage", () => {
    expect(can("interviewer", "recording:view")).toBe(true);
    expect(can("interviewer", "interview:write")).toBe(false);
  });
  it("limits candidate data to hiring roles", () => {
    for (const r of ["owner", "admin", "recruiter"] as const) expect(can(r, "candidate:view")).toBe(true);
    for (const r of ["interviewer", "viewer"] as const) expect(can(r, "candidate:view")).toBe(false);
  });
  it("limits usage to owners and admins", () => {
    expect(can("owner", "usage:view")).toBe(true);
    expect(can("admin", "usage:view")).toBe(true);
    for (const r of ["recruiter", "interviewer", "viewer"] as const) expect(can(r, "usage:view")).toBe(false);
  });
  it("lets recruiters manage templates", () => {
    expect(can("recruiter", "template:write")).toBe(true);
  });
  it("restricts role assignment", () => {
    expect(assignableRoles("owner")).not.toContain("owner");
    expect(assignableRoles("admin")).not.toContain("admin");
    expect(assignableRoles("recruiter")).toEqual([]);
  });
});

describe("tokens", () => {
  it("generates high-entropy, well-formed tokens", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(isWellFormedToken(a)).toBe(true);
  });
  it("hashes deterministically and never returns the token", () => {
    const t = generateToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toContain(t);
  });
  it("rejects malformed tokens", () => {
    expect(isWellFormedToken("short")).toBe(false);
    expect(isWellFormedToken("../../etc/passwd" + "a".repeat(40))).toBe(false);
  });
});

describe("passwords", () => {
  it("verifies correct and rejects wrong passwords", async () => {
    const h = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
});

describe("rate limit", () => {
  it("blocks after the limit", () => {
    const key = `t-${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(rateLimit(key, 3, 1000).ok).toBe(true);
    expect(rateLimit(key, 3, 1000).ok).toBe(false);
  });
});

describe("rate limit hardening", () => {
  it("peeks without counting, for limits that count only failures", () => {
    const key = `peek-${Math.random()}`;
    for (let i = 0; i < 5; i++) expect(isRateLimited(key, 2, 1000).limited).toBe(false);
    rateLimit(key, 2, 1000);
    rateLimit(key, 2, 1000);
    expect(isRateLimited(key, 2, 1000).limited).toBe(true);
  });

  it("can't be reset by flooding new keys", () => {
    const key = `victim-${Math.random()}`;
    for (let i = 0; i < 3; i++) rateLimit(key, 3, 60_000);
    for (let i = 0; i < 60_000; i++) rateLimit(`flood-${i}-${Math.random()}`, 3, 60_000);
    expect(rateLimit(key, 3, 60_000).ok).toBe(false);
  });
});

describe("client IP", () => {
  const h = (xff: string, extra: Record<string, string> = {}) => new Headers({ "x-forwarded-for": xff, ...extra });
  it("uses the entry the trusted proxy appended, not the one the client sent", () => {
    expect(clientIp(h("6.6.6.6, 1.2.3.4"), { hops: 1 })).toBe("1.2.3.4");
    expect(clientIp(h("6.6.6.6, 1.2.3.4, 10.0.0.1"), { hops: 2 })).toBe("1.2.3.4");
    expect(clientIp(h("1.2.3.4"), { hops: 3 })).toBe("1.2.3.4");
  });
  it("prefers the edge's own client-IP header when configured", () => {
    expect(clientIp(h("6.6.6.6", { "cf-connecting-ip": "1.2.3.4" }), { header: "cf-connecting-ip" })).toBe("1.2.3.4");
  });
  it("keeps the old behaviour when nothing is configured", () => {
    expect(clientIp(h("1.2.3.4, 10.0.0.1"), {})).toBe("1.2.3.4");
    expect(clientIp(new Headers(), {})).toBe("local");
  });
});

describe("post-login redirect", () => {
  it("allows same-site paths only", () => {
    expect(safeNext("/jobs/1?tab=rounds#x")).toBe("/jobs/1?tab=rounds#x");
    for (const bad of ["//evil.com", "/\\evil.com", "/\tevil.com", "/\t/evil.com", "https://evil.com", "javascript:alert(1)", "", null]) {
      expect(safeNext(bad)).toBeNull();
    }
  });
});
