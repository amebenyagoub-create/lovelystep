import type { Order } from "./types";

export type ZrTerritory = {
  id: string;
  code: number | null;
  name: string;
  level: string;
  parentId: string | null;
};

export type ZrHub = {
  id: string;
  name: string;
  isPickupPoint: boolean;
  address: {
    district: string;
    districtTerritoryId: string | null;
  };
};

export type ZrParcelPayload = {
  customer: { customerId: string; name: string; phone: { number1: string } };
  deliveryAddress: { cityTerritoryId: string; districtTerritoryId: string; street: string | null };
  hubId?: string;
  orderedProducts: Array<{ productName: string; productSku: string; unitPrice: number; quantity: number; stockType: "none" }>;
  deliveryType: "home" | "pickup-point";
  description: string;
  amount: number;
  weight: { weight: number };
  externalId: string;
};

const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, " ").trim().toLocaleLowerCase("fr");
const levelIs = (territory: ZrTerritory, values: string[]) => values.some((value) => normalized(territory.level).includes(value));

export function selectDistrictTerritory(territories: ZrTerritory[], commune: string) {
  const expected = normalized(commune);
  const exact = territories.filter((territory) => normalized(territory.name) === expected);
  return exact.find((territory) => levelIs(territory, ["district", "commune"])) ?? exact[0] ?? null;
}

export function selectCityTerritory(territories: ZrTerritory[], wilayaName: string, wilayaCode: string) {
  const expectedName = normalized(wilayaName);
  const expectedCode = Number(wilayaCode);
  const candidates = territories.filter((territory) => normalized(territory.name) === expectedName || territory.code === expectedCode);
  return candidates.find((territory) => levelIs(territory, ["city", "wilaya"])) ?? candidates[0] ?? null;
}

export function selectPickupHub(hubs: ZrHub[], districtTerritoryId: string, commune: string) {
  const pickupPoints = hubs.filter((hub) => hub.isPickupPoint);
  const byTerritory = pickupPoints.filter((hub) => hub.address.districtTerritoryId === districtTerritoryId);
  if (byTerritory.length === 1) return byTerritory[0];
  const expected = normalized(commune);
  const exactDistrict = (byTerritory.length ? byTerritory : pickupPoints).filter((hub) => normalized(hub.address.district) === expected);
  if (exactDistrict.length === 1) return exactDistrict[0];
  return pickupPoints.length === 1 ? pickupPoints[0] : null;
}

function validationMessages(value: unknown, path = ""): string[] {
  if (typeof value === "string" && value.trim()) return [`${path ? `${path} : ` : ""}${value.trim()}`];
  if (Array.isArray(value)) return value.flatMap((item) => validationMessages(item, path));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => validationMessages(item, path ? `${path}.${key}` : key));
}

export function zrApiErrorMessage(payload: unknown, status: number) {
  const body = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  const errors = validationMessages(body.errors);
  if (errors.length) return `ZR Express : ${errors.join(" · ").slice(0, 450)}`;
  const detail = body.detail ?? body.message ?? body.title;
  return typeof detail === "string" && detail.trim()
    ? `ZR Express : ${detail.trim().slice(0, 300)}`
    : `ZR Express a refusé la requête (${status}).`;
}

export function buildZrParcelPayload(order: Order, territoryIds: { cityTerritoryId: string; districtTerritoryId: string }, weightKg: number, customerId: string, hubId?: string): ZrParcelPayload {
  const itemSummary = order.items.map((item) => `${item.quantity}× ${item.name} (${item.size}${item.color ? `, ${item.color}` : ""})`).join(" · ");
  const description = [`Lovely Step ${order.orderNumber}`, itemSummary, order.notes].filter(Boolean).join(" — ").slice(0, 250);
  return {
    customer: { customerId, name: order.customerName.slice(0, 100), phone: { number1: order.phone } },
    deliveryAddress: {
      cityTerritoryId: territoryIds.cityTerritoryId,
      districtTerritoryId: territoryIds.districtTerritoryId,
      street: order.address.trim() || null,
    },
    ...(hubId ? { hubId } : {}),
    orderedProducts: order.items.map((item) => ({
      productName: item.name.slice(0, 160),
      productSku: `${item.productId}-${item.size}-${item.color ?? ""}`.slice(0, 120),
      unitPrice: item.unitPriceCents / 100,
      quantity: item.quantity,
      stockType: "none",
    })),
    deliveryType: order.deliveryType === "office" ? "pickup-point" : "home",
    description,
    amount: order.totalCents / 100,
    weight: { weight: weightKg },
    externalId: order.orderNumber,
  };
}
