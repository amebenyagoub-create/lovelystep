import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "playwright", "sharp"],
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
    return [{ source: "/:path*", headers: [
      { key: "Content-Security-Policy", value: csp },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ] }];
  },
};

export default nextConfig;
