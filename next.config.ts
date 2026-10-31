import type { NextConfig } from "next";

/**
 * Static security headers applied to every response.
 * The Content-Security-Policy is per-request (it carries a nonce) and is set in src/proxy.ts.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Every page in this app is personal and request-time (session + live market data),
  // so the classic dynamic rendering model is used instead of Cache Components.
  cacheComponents: false,
  poweredByHeader: false,
  reactStrictMode: true,
  // The MongoDB driver has optional native dependencies; keep it out of the bundle.
  serverExternalPackages: ["mongodb"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
