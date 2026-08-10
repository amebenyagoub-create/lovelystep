import { marketingAllowed, readConsentCookie } from "./meta/consent";
import { cleanCustomData, randomEventId, type MetaCustomData, type MetaStandardEvent } from "./meta/events";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    _lovelyStepMetaPixel?: string;
  }
}

/**
 * Fires a browser Pixel event.
 *
 * `eventId` must be supplied for any event that is ALSO sent server-side (Purchase), using the
 * exact id the server used; otherwise Meta counts the conversion twice. Browser-only events get
 * a random id so a future server counterpart can still deduplicate.
 *
 * Returns silently when consent is absent or the Pixel has not loaded: tracking never throws
 * into a checkout or render path.
 */
export function trackMeta(eventName: MetaStandardEvent, parameters: MetaCustomData = {}, eventId?: string): void {
  if (typeof window === "undefined" || typeof window.fbq !== "function") return;
  if (!marketingAllowed(readConsentCookie())) return;
  try {
    window.fbq("track", eventName, cleanCustomData(parameters), { eventID: eventId ?? randomEventId() });
  } catch {
    // A tracking failure must never break the surrounding user action.
  }
}
