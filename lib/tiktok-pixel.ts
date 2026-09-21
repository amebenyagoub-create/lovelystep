import { marketingAllowed, readConsentCookie } from "./meta/consent";
import type { MetaCustomData, MetaStandardEvent } from "./meta/events";
import { tiktokProperties } from "./tiktok/events";

export type PendingTikTokEvent = { eventName: MetaStandardEvent; parameters: MetaCustomData; eventId: string };

export interface TikTokQueue extends Array<unknown> {
  methods?: string[];
  setAndDefer?: (target: TikTokQueue, method: string) => void;
  instance?: (pixelId: string) => TikTokQueue;
  load: (pixelId: string, options?: Record<string, unknown>) => void;
  track: (...args: unknown[]) => void;
  page: (...args: unknown[]) => void;
  _i?: Record<string, TikTokQueue & { _u?: string }>;
  _t?: Record<string, number>;
  _o?: Record<string, Record<string, unknown>>;
}

declare global {
  interface Window {
    ttq?: TikTokQueue;
    TiktokAnalyticsObject?: string;
    _lovelyStepTikTokPixel?: string;
    _lovelyStepPendingTikTokEvents?: PendingTikTokEvent[];
  }
}

const SERVER_EVENTS = new Set<MetaStandardEvent>(["ViewContent", "AddToCart", "InitiateCheckout", "CompleteRegistration"]);

export function trackTikTok(eventName: MetaStandardEvent, parameters: MetaCustomData, eventId: string): void {
  if (typeof window === "undefined" || !marketingAllowed(readConsentCookie())) return;
  const pending = { eventName, parameters, eventId };
  if (!window.ttq || typeof window.ttq.track !== "function") {
    (window._lovelyStepPendingTikTokEvents ??= []).push(pending);
    return;
  }
  try { window.ttq.track(eventName, tiktokProperties(parameters), { event_id: eventId }); } catch { /* tracking never breaks shopping */ }
  if (SERVER_EVENTS.has(eventName)) {
    void fetch("/api/tiktok/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventName, eventId, customData: parameters }),
      keepalive: true,
    }).catch(() => undefined);
  }
}

export function flushPendingTikTokEvents(): void {
  const pending = window._lovelyStepPendingTikTokEvents ?? [];
  window._lovelyStepPendingTikTokEvents = [];
  for (const event of pending) trackTikTok(event.eventName, event.parameters, event.eventId);
}
