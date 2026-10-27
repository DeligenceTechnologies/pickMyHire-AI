import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getGuide, guideSections, imageSrc, slugify } from "@/lib/guide";

describe("product guide", () => {
  it("makes GitHub-style anchors", () => {
    expect(slugify("1. Before you start")).toBe("1-before-you-start");
    expect(slugify("11. The candidate page and the shortlist")).toBe("11-the-candidate-page-and-the-shortlist");
    expect(slugify("Appendix: Platform admin")).toBe("appendix-platform-admin");
  });

  it("keeps only the numbered sections", () => {
    const md = "# Title\n\n## Contents\n\n- a\n\n---\n\n## 1. One\n\nText\n\n---\n\n## 2. Two\n\nMore\n\n---\n\n## Appendix: Platform admin\n\nInternal";
    const s = guideSections(md);
    expect(s.map((x) => x.split("\n")[0])).toEqual(["## 1. One", "## 2. Two"]);
    expect(s[0]).not.toMatch(/---/);
  });

  it("serves screenshots from public/", () => {
    expect(imageSrc("../public/product-guide/01-signup.jpg")).toBe("/product-guide/01-signup.jpg");
  });

  it("renders the real guide without the admin appendix, with every screenshot present", () => {
    const { html, toc } = getGuide();
    expect(toc[0]).toEqual({ id: "1-before-you-start", title: "1. Before you start" });
    expect(html).not.toContain("Platform admin");
    const srcs = [...html.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThan(30);
    for (const src of srcs) expect(existsSync(path.join(process.cwd(), "public", src))).toBe(true);
    for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) expect(html).toContain(`id="${id}"`);
  });
});
