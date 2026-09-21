import "server-only";

import { marketingAllowed, parseConsent, CONSENT_COOKIE } from "../meta/consent";

export type TikTokRequestContext = {
  consentGranted: boolean;
  ttp?: string;
  ttclid?: string;
  ip?: string;
  userAgent?: string;
  url?: string;
  referrer?: string;
};

function cookie(cookieHeader: string, name: string): string | undefined {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  if (!match) return undefined;
  const value = decodeURIComponent(match[1]).trim();
  return value && value.length <= 300 ? value : undefined;
}

export function tiktokRequestContext(request: Request): TikTokRequestContext {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const consent = parseConsent(cookie(cookieHeader, CONSENT_COOKIE));
  const consentGranted = marketingAllowed(consent);
  if (!consentGranted) return { consentGranted: false };

  const referrer = request.headers.get("referer") ?? undefined;
  let ttclid = cookie(cookieHeader, "ttclid");
  if (!ttclid && referrer) {
    try { ttclid = new URL(referrer).searchParams.get("ttclid")?.slice(0, 300) || undefined; } catch { /* invalid referrer */ }
  }
  return {
    consentGranted: true,
    ttp: cookie(cookieHeader, "_ttp"),
    ttclid,
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || undefined,
    userAgent: request.headers.get("user-agent") ?? undefined,
    url: referrer,
    referrer: request.headers.get("origin") ?? undefined,
  };
}

