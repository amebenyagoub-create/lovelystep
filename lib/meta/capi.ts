import "server-only";

import crypto from "node:crypto";
import { isTrackingDisabledByAdmin } from "../db-postgres";
import { metaConfig } from "./config";
import { cleanCustomData, type MetaCustomData, type MetaStandardEvent } from "./events";

/**
 * Server-side Conversions API client.
 *
 * Rules enforced here:
 * - Personal data is SHA-256 hashed before it leaves this process. Raw values never reach Meta or a log.
 * - `_fbp` / `_fbc` / IP / user-agent are NOT hashed (Meta requires them raw) and are only sent with consent.
 * - Failures never throw to the caller: tracking must not break checkout.
 */

export type MetaUserData = {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  externalId?: string;
  fbp?: string;
  fbc?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
};

export type MetaServerEvent = {
  eventName: MetaStandardEvent;
  eventId: string;
  eventTime?: number;
  eventSourceUrl?: string;
  actionSource?: "website" | "phone_call" | "system_generated" | "other";
  userData: MetaUserData;
  customData?: MetaCustomData;
};

export type MetaSendResult = { ok: boolean; status: number; eventsReceived?: number; error?: string; skipped?: "disabled" | "no_consent" };

const sha256 = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");

// Normalization rules below follow Meta's customer information parameters documentation
// (verified 2026-08-10). Getting these wrong does not error: it silently lowers match quality.

/** Names/email: trimmed, lowercased, internal whitespace collapsed. */
function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
}

/**
 * Phone: digits only, no symbols, no leading zeros, country code required.
 * Store data arrives as E.164 (+213…) from normalizeAlgerianPhone, so the leading-zero
 * strip is a safety net for any other caller rather than the normal path.
 */
function normalizePhone(value: string): string {
  return value.replace(/[^\d]/g, "").replace(/^0+/, "");
}

/** City/state: lowercase letters and digits only — no punctuation, spaces or special characters. */
function normalizePlace(value: string): string {
  return value.trim().toLocaleLowerCase("en").replace(/[^a-z0-9]/g, "");
}

/** Zip: lowercase, no spaces, no dash. */
function normalizeZip(value: string): string {
  return value.trim().toLocaleLowerCase("en").replace(/[^a-z0-9]/g, "");
}

/** Two-letter ISO 3166-1 alpha-2 country code, lowercased. */
function normalizeCountry(value: string): string {
  return value.trim().toLocaleLowerCase("en").replace(/[^a-z]/g, "").slice(0, 2);
}

function hashed(value: string | undefined, normalize: (input: string) => string): string | undefined {
  if (!value) return undefined;
  const normalized = normalize(value);
  return normalized ? sha256(normalized) : undefined;
}

function buildUserData(user: MetaUserData): Record<string, string | string[]> {
  const payload: Record<string, string | string[]> = {};
  // Hashed identifiers. Meta expects arrays for the multi-value fields.
  const email = hashed(user.email, normalizeText);
  const phone = hashed(user.phone, normalizePhone);
  const firstName = hashed(user.firstName, normalizeText);
  const lastName = hashed(user.lastName, normalizeText);
  const city = hashed(user.city, normalizePlace);
  const state = hashed(user.state, normalizePlace);
  const zip = hashed(user.zip, normalizeZip);
  const country = hashed(user.country, normalizeCountry);
  const externalId = hashed(user.externalId, (value) => value.trim());
  if (email) payload.em = [email];
  if (phone) payload.ph = [phone];
  if (firstName) payload.fn = [firstName];
  if (lastName) payload.ln = [lastName];
  if (city) payload.ct = [city];
  if (state) payload.st = [state];
  if (zip) payload.zp = [zip];
  if (country) payload.country = [country];
  if (externalId) payload.external_id = [externalId];
  // Never hashed: Meta matches these verbatim.
  if (user.fbp) payload.fbp = user.fbp;
  if (user.fbc) payload.fbc = user.fbc;
  if (user.clientIpAddress) payload.client_ip_address = user.clientIpAddress;
  if (user.clientUserAgent) payload.client_user_agent = user.clientUserAgent;
  return payload;
}

/** Strips anything that could carry personal data out of an error string before it is stored or logged. */
export function redact(message: string): string {
  return message
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]")
    .replace(/\b[a-f0-9]{64}\b/gi, "[hash]")
    .replace(/(access_token=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 500);
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * Sends one event. Retries only on transient failures, with bounded backoff.
 * `consentGranted` gates the whole call: without consent nothing is transmitted.
 */
export async function sendServerEvent(event: MetaServerEvent, consentGranted: boolean, attempts = 3): Promise<MetaSendResult> {
  const config = metaConfig();
  if (!config.enabled) return { ok: false, status: 0, skipped: "disabled" };
  if (!consentGranted) return { ok: false, status: 0, skipped: "no_consent" };
  // Admin kill switch, checked on every send so it takes effect immediately.
  if (await isTrackingDisabledByAdmin().catch(() => false)) return { ok: false, status: 0, skipped: "disabled" };

  const body: Record<string, unknown> = {
    data: [{
      event_name: event.eventName,
      event_time: event.eventTime ?? Math.floor(Date.now() / 1000),
      event_id: event.eventId,
      action_source: event.actionSource ?? "website",
      ...(event.eventSourceUrl ? { event_source_url: event.eventSourceUrl } : {}),
      user_data: buildUserData(event.userData),
      ...(event.customData ? { custom_data: cleanCustomData(event.customData) } : {}),
    }],
  };
  if (config.testEventCode) body.test_event_code = config.testEventCode;

  const url = `https://graph.facebook.com/${config.graphApiVersion}/${config.datasetId}/events`;
  let lastError = "";
  let lastStatus = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.accessToken}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      const payload = await response.json().catch(() => ({})) as { events_received?: number; error?: { message?: string; code?: number } };
      lastStatus = response.status;
      if (response.ok) return { ok: true, status: response.status, eventsReceived: Number(payload.events_received ?? 0) };
      lastError = redact(String(payload.error?.message ?? `HTTP ${response.status}`));
      if (!RETRYABLE_STATUS.has(response.status)) return { ok: false, status: response.status, error: lastError };
    } catch (error) {
      lastStatus = 0;
      lastError = redact(error instanceof Error ? error.message : "Unknown transport error");
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** (attempt - 1)));
  }
  return { ok: false, status: lastStatus, error: lastError };
}

/** Exported for tests: verifies normalization/hashing without performing a network call. */
export const __testing = { buildUserData, normalizeText, normalizePhone, normalizePlace, normalizeZip, normalizeCountry, sha256 };
