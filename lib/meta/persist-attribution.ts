import "server-only";

import { recordMetaAttribution } from "../db-postgres";
import { isMetaTouch, type AttributionState, type AttributionTouch } from "./attribution";
import type { MetaRequestContext } from "./request";

/**
 * Validates and stores the attribution payload posted with an order.
 *
 * The payload comes from the browser and is therefore untrusted: every field is length-capped
 * and type-checked before it reaches the database. It carries no personal data by design —
 * only click identifiers and campaign tags.
 */

const text = (value: unknown, max = 200): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

const timestamp = (value: unknown): string | null => {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  // Reject nonsense dates rather than storing them.
  if (!Number.isFinite(parsed)) return null;
  const now = Date.now();
  if (parsed > now + 86_400_000 || parsed < now - 400 * 86_400_000) return null;
  return new Date(parsed).toISOString();
};

function parseTouch(value: unknown): AttributionTouch | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  return {
    at: timestamp(raw.at) ?? new Date().toISOString(),
    fbclid: text(raw.fbclid) ?? undefined,
    utmSource: text(raw.utmSource, 100) ?? undefined,
    utmMedium: text(raw.utmMedium, 100) ?? undefined,
    utmCampaign: text(raw.utmCampaign, 150) ?? undefined,
    utmContent: text(raw.utmContent, 150) ?? undefined,
    utmTerm: text(raw.utmTerm, 150) ?? undefined,
    landingPage: text(raw.landingPage) ?? undefined,
    referrer: text(raw.referrer) ?? undefined,
  };
}

export function parseAttributionPayload(value: unknown): AttributionState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const first = parseTouch(raw.first);
  const last = parseTouch(raw.last);
  if (!first || !last) return null;
  return { first, last };
}

/**
 * Persists attribution for an order. Never throws: an order is already committed by this point.
 * Falls back to the server-observed _fbc/_fbp when the browser sent no campaign touch, so a
 * Meta click is still recorded even if localStorage was unavailable.
 */
export async function persistOrderAttribution(orderId: number, state: AttributionState | null, context: MetaRequestContext): Promise<void> {
  try {
    if (!context.consentGranted) return;
    // An _fbc cookie only exists because a Meta click created it, so it is itself Meta evidence.
    const fbcIndicatesMeta = Boolean(context.fbc);
    if (!state && !fbcIndicatesMeta) return;

    await recordMetaAttribution({
      orderId,
      fbc: context.fbc ?? null,
      fbp: context.fbp ?? null,
      fbclid: state?.last.fbclid ?? null,
      utmSource: state?.last.utmSource ?? null,
      utmMedium: state?.last.utmMedium ?? null,
      utmCampaign: state?.last.utmCampaign ?? null,
      utmContent: state?.last.utmContent ?? null,
      utmTerm: state?.last.utmTerm ?? null,
      landingPage: state?.last.landingPage ?? null,
      referrer: state?.last.referrer ?? null,
      firstFbclid: state?.first.fbclid ?? null,
      firstUtmSource: state?.first.utmSource ?? null,
      firstUtmMedium: state?.first.utmMedium ?? null,
      firstUtmCampaign: state?.first.utmCampaign ?? null,
      firstLandingPage: state?.first.landingPage ?? null,
      firstReferrer: state?.first.referrer ?? null,
      isMetaLastTouch: (state ? isMetaTouch(state.last) : false) || fbcIndicatesMeta,
      isMetaFirstTouch: (state ? isMetaTouch(state.first) : false) || (!state && fbcIndicatesMeta),
      firstTouchAt: state?.first.at ?? null,
      lastTouchAt: state?.last.at ?? null,
    });
  } catch {
    // Attribution is reporting metadata: losing it must never affect the order.
  }
}
