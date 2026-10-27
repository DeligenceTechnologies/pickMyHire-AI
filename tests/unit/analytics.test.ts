import { describe, expect, it } from "vitest";
import { cleanLocation, cleanReferrer, isBannerPath, isTrackableUrl, isTrackedPath } from "@/lib/analytics";

const u = (s: string) => new URL(s, "https://pickmyhire.ai");

describe("analytics pages", () => {
  it("tracks only the public pages", () => {
    for (const p of ["/", "/demo", "/guide", "/apply/frontend-dev-abc"]) expect(isTrackedPath(p)).toBe(true);
    for (const p of ["/login", "/signup", "/reset-password", "/verify-email", "/dashboard", "/candidates/1", "/interview/tok123", "/interview/tok123/session", "/admin", "/cookies", "/help", "/apply/x/extra"]) {
      expect(isTrackedPath(p)).toBe(false);
    }
    expect(isBannerPath("/cookies")).toBe(true);
    expect(isBannerPath("/interview/tok123")).toBe(false);
  });

  it("never sends private parameters", () => {
    expect(cleanLocation(u("/?utm_source=linkedin&code=SECRET&utm_campaign=launch#faq"))).toBe("https://pickmyhire.ai/?utm_source=linkedin&utm_campaign=launch");
    expect(cleanLocation(u("/demo"))).toBe("https://pickmyhire.ai/demo");
    expect(isTrackableUrl(u("/?utm_medium=social"))).toBe(true);
    expect(isTrackableUrl(u("/?code=SECRET"))).toBe(false);
    expect(isTrackableUrl(u("/dashboard"))).toBe(false);
  });

  it("keeps only safe referrers", () => {
    expect(cleanReferrer("https://pickmyhire.ai/candidates/123?x=1", "https://pickmyhire.ai")).toBe("https://pickmyhire.ai");
    expect(cleanReferrer("https://www.linkedin.com/feed/?trk=abc", "https://pickmyhire.ai")).toBe("https://www.linkedin.com/feed/");
    expect(cleanReferrer("", "https://pickmyhire.ai")).toBe("");
    expect(cleanReferrer("not a url", "https://pickmyhire.ai")).toBe("");
  });
});
