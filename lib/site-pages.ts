/** The live website address used in robots.txt and the sitemap. */
export const SITE_URL = "https://pickmyhire.ai";

/** Public pages that should appear in search results. Apply pages are left out on purpose: each is one job and temporary. */
export const SITEMAP_PAGES: { path: string; priority: number; changeFrequency: "weekly" | "monthly" | "yearly" }[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/pricing", priority: 0.9, changeFrequency: "monthly" },
  { path: "/demo", priority: 0.8, changeFrequency: "monthly" },
  { path: "/guide", priority: 0.7, changeFrequency: "monthly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
  { path: "/refunds", priority: 0.3, changeFrequency: "yearly" },
  { path: "/cookies", priority: 0.3, changeFrequency: "yearly" },
];

/**
 * Areas search engines shouldn't crawl: the app, admin, sign-in pages, the API and candidate interview links.
 * Apply pages are not listed here: they carry a "noindex" tag instead, which only works if Google can read the page.
 */
export const ROBOTS_DISALLOW = [
  "/api/", "/interview/", "/admin", "/dashboard", "/jobs", "/candidates", "/interviews", "/templates", "/settings", "/help",
  "/login", "/forgot-password", "/reset-password", "/verify-email",
];
