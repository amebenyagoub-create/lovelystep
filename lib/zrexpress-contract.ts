import type { Order } from "./types";

export type ZrTerritory = {
  id: string;
  code: number | null;
  name: string;
  level: string;
  parentId: string | null;
};

export type ZrParcelPayload = {
  customer: { name: string; phone: { number1: string } };
  deliveryAddress: { cityTerritoryId: string; districtTerritoryId: string; street: string | null };
  orderedProducts: Array<{ productName: string; productSku: string; unitPrice: number; quantity: number; stockType: "local" }>;
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

export function buildZrParcelPayload(order: Order, territoryIds: { cityTerritoryId: string; districtTerritoryId: string }, weightKg: number): ZrParcelPayload {
  const itemSummary = order.items.map((item) => `${item.quantity}× ${item.name} (${item.size}${item.color ? `, ${item.color}` : ""})`).join(" · ");
  const description = [`Lovely Step ${order.orderNumber}`, itemSummary, order.notes].filter(Boolean).join(" — ").slice(0, 500);
  return {
    customer: { name: order.customerName, phone: { number1: order.phone } },
    deliveryAddress: {
      cityTerritoryId: territoryIds.cityTerritoryId,
      districtTerritoryId: territoryIds.districtTerritoryId,
      street: order.address.trim() || null,
    },
    orderedProducts: order.items.map((item) => ({
      productName: item.name.slice(0, 160),
      productSku: `${item.productId}-${item.size}-${item.color ?? ""}`.slice(0, 120),
      unitPrice: item.unitPriceCents / 100,
      quantity: item.quantity,
      stockType: "local",
    })),
    deliveryType: order.deliveryType === "office" ? "pickup-point" : "home",
    description,
    amount: order.totalCents / 100,
    weight: { weight: weightKg },
    externalId: order.orderNumber,
  };
}
