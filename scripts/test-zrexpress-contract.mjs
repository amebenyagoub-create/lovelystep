import assert from "node:assert/strict";
import { buildZrParcelPayload, selectCityTerritory, selectDistrictTerritory } from "../lib/zrexpress-contract.ts";

const cityId = "11111111-1111-4111-8111-111111111111";
const districtId = "22222222-2222-4222-8222-222222222222";
const territories = [
  { id: cityId, code: 16, name: "Alger", level: "city", parentId: null },
  { id: districtId, code: 1601, name: "Alger Centre", level: "district", parentId: cityId },
];

assert.equal(selectDistrictTerritory(territories, "Alger Centre")?.id, districtId);
assert.equal(selectDistrictTerritory(territories, "Alger-Centre")?.id, districtId);
assert.equal(selectCityTerritory(territories, "Alger", "16")?.id, cityId);

const order = {
  id: 1, orderNumber: "LS-TEST-001", customerId: null, firstName: "Lina", lastName: "Test", customerName: "Lina Test",
  phone: "+213550000001", city: "Alger Centre", wilayaCode: "16", wilayaName: "Alger", commune: "Alger Centre", address: "",
  deliveryType: "office", deliveryExternalId: null, deliverySyncStatus: "not_configured", deliverySyncError: null, notes: "Appeler avant",
  status: "confirmed", items: [{ productId: 7, slug: "ensemble", name: "Ensemble test", image: "", size: "3-4 ans", color: "Bleu", quantity: 2, unitPriceCents: 350000, unitCostCents: 180000 }],
  subtotalCents: 700000, shippingCents: 50000, totalCents: 750000, statusHistory: [], refunds: [], deliveryCost: null, attribution: null,
  createdAt: "2026-08-11T12:00:00.000Z", updatedAt: "2026-08-11T12:00:00.000Z",
};
const payload = buildZrParcelPayload(order, { cityTerritoryId: cityId, districtTerritoryId: districtId }, 1);
assert.equal(payload.externalId, "LS-TEST-001");
assert.equal(payload.deliveryType, "pickup-point");
assert.equal(payload.amount, 7500);
assert.equal(payload.customer.phone.number1, "+213550000001");
assert.equal(payload.deliveryAddress.cityTerritoryId, cityId);
assert.equal(payload.deliveryAddress.districtTerritoryId, districtId);
assert.equal(payload.orderedProducts[0].quantity, 2);
assert.equal(payload.orderedProducts[0].unitPrice, 3500);
assert.equal(payload.weight.weight, 1);

console.log(JSON.stringify({ ok: true, checks: 12 }, null, 2));
