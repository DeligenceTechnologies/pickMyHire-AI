import type { MetadataRoute } from "next";
import { ROBOTS_DISALLOW, SITE_URL } from "@/lib/site-pages";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ROBOTS_DISALLOW }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
