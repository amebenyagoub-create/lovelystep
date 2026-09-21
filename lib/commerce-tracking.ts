import { trackMeta } from "./meta-pixel";
import { cleanCustomData, randomEventId, type MetaCustomData, type MetaStandardEvent } from "./meta/events";
import { trackTikTok } from "./tiktok-pixel";

/** One storefront call emits the same commerce event to Meta and TikTok. */
export function trackCommerce(eventName: MetaStandardEvent, parameters: MetaCustomData = {}, eventId?: string): void {
  const sharedEventId = eventId ?? randomEventId();
  const clean = cleanCustomData(parameters);
  trackMeta(eventName, clean, sharedEventId);
  trackTikTok(eventName, clean, sharedEventId);
}

