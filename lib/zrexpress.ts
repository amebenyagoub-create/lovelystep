import "server-only";

import { findWilaya } from "./algeria";
import { listDeliveryRates, saveDeliveryRates } from "./db-postgres";
import type { DeliveryRate } from "./types";

const ZREXPRESS_BASE_URL = "https://api.zrexpress.app";

type ZrDeliveryPrice = {
  deliveryType?: unknown;
  price?: unknown;
};

type ZrRate = {
  toTerritoryCode?: unknown;
  toTerritoryLevel?: unknown;
  deliveryPrices?: unknown;
};

type ZrRatesPayload = {
  rates?: unknown;
  detail?: unknown;
  title?: unknown;
  message?: unknown;
};

export type ZrExpressStatus = {
  apiKeyConfigured: boolean;
  tenantConfigured: boolean;
  ready: boolean;
};

export function getZrExpressStatus(): ZrExpressStatus {
  const apiKeyConfigured = Boolean(process.env.ZREXPRESS_API_KEY?.trim());
  const tenantConfigured = Boolean(process.env.ZREXPRESS_TENANT_ID?.trim());
  return { apiKeyConfigured, tenantConfigured, ready: apiKeyConfigured && tenantConfigured };
}

function credentials(): { apiKey: string; tenantId: string } {
  const apiKey = process.env.ZREXPRESS_API_KEY?.trim() ?? "";
  const tenantId = process.env.ZREXPRESS_TENANT_ID?.trim() ?? "";
  if (!apiKey) throw new Error("La variable ZREXPRESS_API_KEY est absente du serveur.");
  if (!tenantId) throw new Error("La variable ZREXPRESS_TENANT_ID (X-Tenant) est absente du serveur.");
  return { apiKey, tenantId };
}

function errorMessage(payload: ZrRatesPayload, status: number): string {
  const detail = payload.detail ?? payload.message ?? payload.title;
  return typeof detail === "string" && detail.trim()
    ? `ZR Express : ${detail.trim().slice(0, 300)}`
    : `ZR Express a refusé la requête (${status}).`;
}

async function fetchRatesPayload(): Promise<ZrRatesPayload> {
  const { apiKey, tenantId } = credentials();
  const response = await fetch(`${ZREXPRESS_BASE_URL}/api/v1/delivery-pricing/rates`, {
    method: "GET",
    headers: {
      accept: "application/json",
      "X-Api-Key": apiKey,
      "X-Tenant": tenantId,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({})) as ZrRatesPayload;
  if (!response.ok) throw new Error(errorMessage(payload, response.status));
  return payload;
}

function deliveryType(value: unknown): "home" | "office" | null {
  const normalized = String(value ?? "").trim().toLocaleLowerCase("en");
  if (normalized === "home" || normalized.includes("domicile")) return "home";
  if (normalized === "pickup-point" || normalized.includes("pickup") || normalized.includes("bureau") || normalized.includes("office") || normalized.includes("relay")) return "office";
  return null;
}

function dzdToCents(value: unknown): number | null {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000) return null;
  return Math.round(amount * 100);
}

export async function syncZrExpressDeliveryRates(): Promise<{ rates: DeliveryRate[]; syncedWilayas: number; ignoredEntries: number }> {
  const [payload, currentRates] = await Promise.all([fetchRatesPayload(), listDeliveryRates()]);
  if (!Array.isArray(payload.rates)) throw new Error("ZR Express n’a renvoyé aucune grille de tarifs exploitable.");

  const updates = new Map<string, Partial<Pick<DeliveryRate, "homeCents" | "officeCents">>>();
  let ignoredEntries = 0;

  for (const entry of payload.rates as ZrRate[]) {
    const level = String(entry.toTerritoryLevel ?? "").trim().toLocaleLowerCase("fr");
    if (level && level !== "wilaya") { ignoredEntries += 1; continue; }
    const numericCode = Number(entry.toTerritoryCode);
    const code = Number.isInteger(numericCode) ? String(numericCode).padStart(2, "0") : "";
    if (!findWilaya(code) || !Array.isArray(entry.deliveryPrices)) { ignoredEntries += 1; continue; }

    const ratePatch = updates.get(code) ?? {};
    for (const item of entry.deliveryPrices as ZrDeliveryPrice[]) {
      const kind = deliveryType(item.deliveryType);
      const cents = dzdToCents(item.price);
      if (!kind || cents === null) continue;
      if (kind === "home") ratePatch.homeCents = cents;
      else ratePatch.officeCents = cents;
    }
    if (ratePatch.homeCents !== undefined || ratePatch.officeCents !== undefined) updates.set(code, ratePatch);
    else ignoredEntries += 1;
  }

  if (updates.size === 0) throw new Error("Aucun tarif par wilaya n’a pu être reconnu dans la réponse ZR Express.");
  const merged = currentRates.map((rate) => {
    const ratePatch = updates.get(rate.wilayaCode);
    return ratePatch ? { ...rate, ...ratePatch, active: true } : rate;
  });
  const rates = await saveDeliveryRates(merged);
  return { rates, syncedWilayas: updates.size, ignoredEntries };
}
