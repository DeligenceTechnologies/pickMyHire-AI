import { describe, expect, it } from "vitest";
import { assignableRoles, can } from "@/lib/auth/permissions";
import { hashPassword, verifyPassword } from "@/lib/security/password";
import { rateLimit } from "@/lib/security/rate-limit";
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
  it("limits candidate data to hiring roles, and Interviewers to their own jobs without salary details", () => {
    for (const r of ["owner", "admin", "recruiter"] as const) {
      expect(can(r, "candidate:view")).toBe(true);
      expect(can(r, "candidate:salary")).toBe(true);
      expect(can(r, "job:all")).toBe(true);
    }
    expect(can("viewer", "candidate:view")).toBe(false);
    expect(can("viewer", "job:all")).toBe(true);
    // Interviewers see candidates and add notes, but only on the jobs whose hiring team they're on.
    expect(can("interviewer", "candidate:view")).toBe(true);
    expect(can("interviewer", "note:write")).toBe(true);
    expect(can("interviewer", "job:all")).toBe(false);
    expect(can("interviewer", "candidate:salary")).toBe(false);
    expect(can("interviewer", "candidate:write")).toBe(false);
    expect(can("interviewer", "decision:write")).toBe(false);
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
