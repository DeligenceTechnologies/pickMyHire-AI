import { readFileSync } from "node:fs";
import path from "node:path";
import { Marked } from "marked";

// The public product guide (/guide) is rendered from docs/PRODUCT-GUIDE.md, so the
// website and the repository always say the same thing. Only the numbered sections
// are shown: the title block, contents list and platform-admin appendix are left out.

export type GuideSection = { id: string; title: string };

/** GitHub's heading anchors, so links inside the guide work in both places. */
export function slugify(text: string) {
  return text.toLowerCase().trim().replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-");
}

/** The numbered `## n. Title` sections of the guide's Markdown. */
export function guideSections(md: string) {
  return md.split(/^(?=## )/m)
    .filter((chunk) => /^## \d+\. /.test(chunk))
    .map((chunk) => chunk.replace(/\n-{3,}\s*$/, "\n").trimEnd());
}

/** Screenshots live in public/product-guide; the Markdown points there relatively. */
export const imageSrc = (href: string) => href.replace(/^(\.\.\/)?public\//, "/");

function render(md: string) {
  const sections = guideSections(md);
  const toc: GuideSection[] = sections.map((s) => {
    const title = s.slice(3, s.indexOf("\n") === -1 ? undefined : s.indexOf("\n")).trim();
    return { id: slugify(title), title };
  });
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth, text }) {
        return `<h${depth} id="${slugify(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
      image({ href, text }) {
        const src = imageSrc(href);
        return `<a href="${src}" target="_blank" rel="noopener" class="guide-shot"><img src="${src}" alt="${text}" loading="lazy" decoding="async"></a>`;
      },
      link({ href, tokens }) {
        const external = /^https?:\/\//.test(href);
        const target = external ? ` target="_blank" rel="noopener noreferrer"` : "";
        return `<a href="${href}"${target}>${this.parser.parseInline(tokens)}</a>`;
      },
    },
  });
  const html = sections.map((s) => `<section>${marked.parse(s, { async: false })}</section>`).join("\n");
  return { html, toc };
}

let cached: ReturnType<typeof render> | null = null;

/** The guide as HTML plus its table of contents. Rendered once per server. */
export function getGuide() {
  if (!cached || process.env.NODE_ENV === "development") {
    cached = render(readFileSync(path.join(/* turbopackIgnore: true */ process.cwd(), "docs", "PRODUCT-GUIDE.md"), "utf8"));
  }
  return cached;
}
