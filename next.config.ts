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
  // Native binaries / dynamic requires: load from node_modules at runtime instead of bundling.
  serverExternalPackages: ["postgres", "unpdf", "mammoth", "bullmq", "ioredis", "ffmpeg-static", "@aws-sdk/client-s3", "@aws-sdk/lib-storage", "@aws-sdk/s3-request-presigner"],
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
