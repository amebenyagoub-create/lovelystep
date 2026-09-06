// Marketing consent state. Read by the Pixel (browser) and by the CAPI route handlers (server).
//
// Measurement is ON by default: a missing cookie means the visitor has not opted out, so the
// Pixel, the CAPI and store attribution all run. Only an explicit "denied" turns them off.
// That single rule is what every other module reads, so the opt-out path stays intact across
// trackMeta, metaRequestContext, sendPurchaseEvent and AttributionTracker without any of them
// knowing the default changed. Visitors opt out from the privacy page.

export const CONSENT_COOKIE = "lovelystep_consent";
export type ConsentState = "granted" | "denied" | "unset";

export function parseConsent(value: string | undefined | null): ConsentState {
  return value === "granted" || value === "denied" ? value : "unset";
}

export function marketingAllowed(state: ConsentState): boolean {
  return state !== "denied";
}

/** Browser-side read. Returns "unset" during SSR. */
export function readConsentCookie(): ConsentState {
  if (typeof document === "undefined") return "unset";
  const match = document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE}=([^;]*)`));
  return parseConsent(match ? decodeURIComponent(match[1]) : null);
}

export function writeConsentCookie(state: "granted" | "denied"): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${state}; Path=/; Max-Age=${60 * 60 * 24 * 180}; SameSite=Lax${secure}`;
}
