import "server-only";

import { findWilaya } from "./algeria";
import { listDeliveryRates, saveDeliveryRates } from "./db-postgres";
import { buildZrParcelPayload, selectCityTerritory, selectDistrictTerritory, selectPickupHub, zrApiErrorMessage, type ZrHub, type ZrTerritory } from "./zrexpress-contract";
import type { DeliveryRate, Order } from "./types";

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

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function zrRequest(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const { apiKey, tenantId } = credentials();
  const response = await fetch(`${ZREXPRESS_BASE_URL}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "X-Api-Key": apiKey,
      "X-Tenant": tenantId,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(zrApiErrorMessage(payload, response.status));
  return payload;
}

function territory(value: unknown): ZrTerritory | null {
  const item = record(value);
  const id = String(item.id ?? "");
  if (!validUuid(id)) return null;
  const numericCode = Number(item.code);
  return {
    id,
    code: Number.isFinite(numericCode) ? numericCode : null,
    name: String(item.name ?? ""),
    level: String(item.level ?? ""),
    parentId: validUuid(String(item.parentId ?? "")) ? String(item.parentId) : null,
  };
}

async function searchTerritories(keyword: string): Promise<ZrTerritory[]> {
  const payload = await zrRequest("/api/v1/territories/search", {
    method: "POST",
    body: JSON.stringify({ keyword, pageSize: 100, pageNumber: 1, includeUnavailable: false }),
  });
  const nested = record(payload.data);
  const values = Array.isArray(payload.items) ? payload.items : Array.isArray(nested.items) ? nested.items : [];
  return values.map(territory).filter((value): value is ZrTerritory => value !== null);
}

function hub(value: unknown): ZrHub | null {
  const item = record(value);
  const id = String(item.id ?? "");
  if (!validUuid(id)) return null;
  const address = record(item.address);
  const districtTerritoryId = String(address.districtTerritoryId ?? "");
  return {
    id,
    name: String(item.name ?? ""),
    isPickupPoint: item.isPickupPoint === true,
    address: {
      district: String(address.district ?? ""),
      districtTerritoryId: validUuid(districtTerritoryId) ? districtTerritoryId : null,
    },
  };
}

async function resolvePickupHub(order: Order, districtTerritoryId: string) {
  const payload = await zrRequest("/api/v1/hubs/search", {
    method: "POST",
    body: JSON.stringify({ keyword: order.commune, pageSize: 100, pageNumber: 1, includeServices: false }),
  });
  const nested = record(payload.data);
  const values = Array.isArray(payload.items) ? payload.items : Array.isArray(nested.items) ? nested.items : [];
  const selected = selectPickupHub(values.map(hub).filter((value): value is ZrHub => value !== null), districtTerritoryId, order.commune);
  if (!selected) throw new Error(`Aucun bureau ZR Express unique n’a été trouvé pour « ${order.commune} ». Choisissez une livraison à domicile ou vérifiez la commune.`);
  return selected.id;
}

async function resolveTerritories(order: Order) {
  const district = selectDistrictTerritory(await searchTerritories(order.commune), order.commune);
  if (!district) throw new Error(`ZR Express ne reconnaît pas la commune « ${order.commune} ».`);
  let cityTerritoryId = district.parentId;
  if (!cityTerritoryId) {
    const city = selectCityTerritory(await searchTerritories(order.wilayaName), order.wilayaName, order.wilayaCode);
    cityTerritoryId = city?.id ?? null;
  }
  if (!cityTerritoryId) throw new Error(`ZR Express ne reconnaît pas la wilaya « ${order.wilayaName} ».`);
  return { cityTerritoryId, districtTerritoryId: district.id };
}

function defaultWeightKg() {
  const value = Number(process.env.ZREXPRESS_DEFAULT_WEIGHT_KG ?? "1");
  return Number.isFinite(value) && value > 0 && value <= 100 ? value : 1;
}

export async function createZrExpressParcel(order: Order): Promise<{ id: string }> {
  const territoryIds = await resolveTerritories(order);
  const hubId = order.deliveryType === "office" ? await resolvePickupHub(order, territoryIds.districtTerritoryId) : undefined;
  const payload = await zrRequest("/api/v1/parcels", {
    method: "POST",
    body: JSON.stringify(buildZrParcelPayload(order, territoryIds, defaultWeightKg(), crypto.randomUUID(), hubId)),
  });
  const nested = record(payload.data);
  const id = String(payload.id ?? nested.id ?? "");
  if (!validUuid(id)) throw new Error("ZR Express a créé le colis sans renvoyer un identifiant valide.");
  return { id };
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
  if (!response.ok) throw new Error(zrApiErrorMessage(payload, response.status));
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
