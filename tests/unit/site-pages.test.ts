import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

describe("robots.txt and sitemap", () => {
  it("lists only public pages, never apply or interview links", () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls).toContain("https://pickmyhire.ai");
    expect(urls).toContain("https://pickmyhire.ai/pricing");
    expect(urls.some((u) => /\/apply\/|\/interview\/|\/dashboard|\/admin/.test(u))).toBe(false);
  });

  it("keeps crawlers out of the app and interview links, but not apply pages (they use noindex)", () => {
    const r = robots();
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rule.disallow).toEqual(expect.arrayContaining(["/api/", "/interview/", "/admin", "/dashboard", "/login"]));
    expect(rule.disallow).not.toContain("/apply/");
    expect(r.sitemap).toBe("https://pickmyhire.ai/sitemap.xml");
  });
});
