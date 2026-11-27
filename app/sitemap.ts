import type { MetadataRoute } from "next";
import { SITE_URL, SITEMAP_PAGES } from "@/lib/site-pages";

export default function sitemap(): MetadataRoute.Sitemap {
  return SITEMAP_PAGES.map((p) => ({ url: `${SITE_URL}${p.path === "/" ? "" : p.path}`, changeFrequency: p.changeFrequency, priority: p.priority }));
}
