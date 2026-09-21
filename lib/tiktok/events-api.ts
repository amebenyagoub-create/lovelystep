import "server-only";

import crypto from "node:crypto";
import { isTrackingDisabledByAdmin } from "../db-postgres";
import type { MetaCustomData, MetaStandardEvent } from "../meta/events";
import { tiktokConfig } from "./config";
import { tiktokProperties } from "./events";

export type TikTokUserData = {
  phone?: string;
  externalId?: string;
  ttp?: string;
  ttclid?: string;
  ip?: string;
  userAgent?: string;
};

export type TikTokServerEvent = {
  eventName: MetaStandardEvent;
  eventId: string;
  eventTime?: number;
  user: TikTokUserData;
  customData?: MetaCustomData;
  url?: string;
  referrer?: string;
};

export type TikTokSendResult = { ok: boolean; status: number; error?: string; skipped?: "disabled" | "no_consent" };

const sha256 = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const normalizePhone = (value: string) => value.replace(/[^\d]/g, "").replace(/^0+/, "");
const clean = <T extends Record<string, unknown>>(value: T): Partial<T> => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== "")) as Partial<T>;

function userPayload(user: TikTokUserData): Record<string, string> {
  const phone = user.phone ? normalizePhone(user.phone) : "";
  return clean({
    phone: phone ? sha256(phone) : undefined,
    external_id: user.externalId ? sha256(user.externalId.trim()) : undefined,
    ttp: user.ttp,
    ttclid: user.ttclid,
    ip: user.ip,
    user_agent: user.userAgent,
  }) as Record<string, string>;
}

function safeError(value: unknown): string {
  return String(value ?? "TikTok Events API error")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]")
    .replace(/\b[a-f0-9]{64}\b/gi, "[hash]")
    .slice(0, 500);
}

export async function sendTikTokEvent(event: TikTokServerEvent, consentGranted: boolean): Promise<TikTokSendResult> {
  const config = tiktokConfig();
  if (!config.eventsApiEnabled) return { ok: false, status: 0, skipped: "disabled" };
  if (!consentGranted) return { ok: false, status: 0, skipped: "no_consent" };
  if (await isTrackingDisabledByAdmin().catch(() => false)) return { ok: false, status: 0, skipped: "disabled" };

  const body = {
    event_source: "web",
    event_source_id: config.pixelId,
    data: [{
      event: event.eventName,
      event_time: event.eventTime ?? Math.floor(Date.now() / 1000),
      event_id: event.eventId,
      user: userPayload(event.user),
      properties: tiktokProperties(event.customData),
      page: clean({ url: event.url, referrer: event.referrer }),
    }],
  };

  try {
    const response = await fetch("https://business-api.tiktok.com/open_api/v1.3/event/track/", {
      method: "POST",
      headers: { "content-type": "application/json", "Access-Token": config.accessToken },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => ({})) as { code?: number; message?: string };
    const ok = response.ok && Number(payload.code ?? 0) === 0;
    return { ok, status: response.status, ...(ok ? {} : { error: safeError(payload.message ?? `HTTP ${response.status}`) }) };
  } catch (error) {
    return { ok: false, status: 0, error: safeError(error instanceof Error ? error.message : error) };
  }
}

export const __testing = { normalizePhone, sha256, tiktokProperties, userPayload };
