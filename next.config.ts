import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "playwright", "sharp"],
  // Product photos are uploaded once and served for months. AVIF/WebP typically
  // cuts them by 60-80% against the source JPEG or PNG, and a one-year optimizer
  // cache means each size is encoded once rather than on every cold start.
  // localPatterns is deliberately not set: it would turn into an allowlist and
  // silently break any local path not listed.
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 31536000,
    deviceSizes: [360, 414, 640, 750, 828, 1080, 1200, 1920],
    imageSizes: [46, 64, 96, 128, 256, 384],
  },
  poweredByHeader: false,
  async headers() {
    const development = process.env.NODE_ENV !== "production";
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' https://connect.facebook.net${development ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://www.facebook.com",
      "font-src 'self' data:",
      `connect-src 'self' https://www.facebook.com https://connect.facebook.net${development ? " ws: wss:" : ""}`,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ");
    // HSTS is only sent in production: forcing it in development would pin
    // localhost to https in the browser for a year.
    const strictTransport = development ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }];
    return [{ source: "/:path*", headers: [
      ...strictTransport,
      { key: "Content-Security-Policy", value: csp },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ] }];
  },
};

export default nextConfig;
