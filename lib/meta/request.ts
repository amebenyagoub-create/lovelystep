import "server-only";

import { marketingAllowed, parseConsent, CONSENT_COOKIE } from "./consent";

/** Everything the CAPI needs from an incoming request, with consent already resolved. */
export type MetaRequestContext = {
  consentGranted: boolean;
  fbp?: string;
  fbc?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
  eventSourceUrl?: string;
};

function cookieValue(cookieHeader: string, name: string): string | undefined {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  if (!match) return undefined;
  const value = decodeURIComponent(match[1]);
  // Meta's browser cookies follow fb.<subdomainIndex>.<creationTime>.<payload>; reject anything else.
  return /^fb\.\d\.\d+\..+$/.test(value) ? value : undefined;
}

export function metaRequestContext(request: Request): MetaRequestContext {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const consent = parseConsent(cookieHeader.match(new RegExp(`(?:^|;\\s*)${CONSENT_COOKIE}=([^;]*)`))?.[1]);
  const consentGranted = marketingAllowed(consent);
  // Without consent, no identifiers are collected at all: not the cookies, not the IP, not the agent.
  if (!consentGranted) return { consentGranted: false };
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    consentGranted: true,
    fbp: cookieValue(cookieHeader, "_fbp"),
    fbc: cookieValue(cookieHeader, "_fbc"),
    clientIpAddress: forwarded || request.headers.get("x-real-ip") || undefined,
    clientUserAgent: request.headers.get("user-agent") ?? undefined,
    eventSourceUrl: request.headers.get("referer") ?? undefined,
  };
}
