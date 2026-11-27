import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Camera/mic are needed on the candidate interview pages only (same origin).
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Marketing images rarely change (new files get new names): let browsers and
  // proxies keep resized copies for a week instead of re-requesting them.
  images: { minimumCacheTTL: 7 * 24 * 60 * 60 },
  serverExternalPackages: ["postgres", "unpdf", "mammoth"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Face model files (several MB) are fixed per release of the face library.
      // The PDF resume is shown inside our own pages (next to the scorecard): framing by our own site only.
      { source: "/api/candidates/:id/resume/view", headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }, { key: "Content-Security-Policy", value: "frame-ancestors 'self'" }] },
      { source: "/models/face/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=2592000" }] },
      // Google Tag Assistant / GTM Preview open a public page with ?gtm_debug=… in a window they need to
      // keep talking to, which "same-origin" blocks. Only for that debug visit, and only on the public pages
      // where Tag Manager runs (no private data), relax it; every normal visit and every other page keeps
      // "same-origin".
      ...["/", "/pricing", "/demo", "/guide", "/apply/:slug"].map((source) => ({
        source,
        has: [{ type: "query" as const, key: "gtm_debug" }],
        headers: [{ key: "Cross-Origin-Opener-Policy", value: "unsafe-none" }],
      })),
      // Candidate links carry a secret token: never leak it via Referer or cache it.
      { source: "/interview/:token*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
