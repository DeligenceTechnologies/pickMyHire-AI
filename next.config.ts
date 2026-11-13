import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Camera/mic are needed on the candidate interview pages only (same origin).
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // The parts of a CSP that can't break scripts, styles, media or AI/WebRTC connections:
  // no plugins, no <base> hijacking, forms only post here, and no framing (clickjacking).
  // A full nonce-based script-src needs every page rendered dynamically and browser
  // testing of the interview room (face models, recording, realtime), so it's a separate step.
  {
    key: "Content-Security-Policy",
    value: ["object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
      ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : [])].join("; "),
  },
  // HTTPS only for a year (browsers ignore it on plain-HTTP localhost). No "preload": that can't be undone quickly.
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
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
      { source: "/models/face/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=2592000" }] },
      // Candidate links carry a secret token: never leak it via Referer or cache it.
      { source: "/interview/:token*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
