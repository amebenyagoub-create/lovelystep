import assert from "node:assert/strict";
import { buildZrParcelPayload, selectCityTerritory, selectDistrictTerritory, selectPickupHub, zrApiErrorMessage } from "../lib/zrexpress-contract.ts";

const cityId = "11111111-1111-4111-8111-111111111111";
const districtId = "22222222-2222-4222-8222-222222222222";
const territories = [
  { id: cityId, code: 16, name: "Alger", level: "city", parentId: null },
  { id: districtId, code: 1601, name: "Alger Centre", level: "district", parentId: cityId },
];

assert.equal(selectDistrictTerritory(territories, "Alger Centre")?.id, districtId);
assert.equal(selectDistrictTerritory(territories, "Alger-Centre")?.id, districtId);
assert.equal(selectCityTerritory(territories, "Alger", "16")?.id, cityId);
const hubId = "33333333-3333-4333-8333-333333333333";
assert.equal(selectPickupHub([{ id: hubId, name: "Bureau Alger Centre", isPickupPoint: true, address: { district: "Alger Centre", districtTerritoryId: districtId } }], districtId, "Alger Centre")?.id, hubId);

const order = {
  id: 1, orderNumber: "LS-TEST-001", customerId: null, firstName: "Lina", lastName: "Test", customerName: "Lina Test",
  phone: "+213550000001", city: "Alger Centre", wilayaCode: "16", wilayaName: "Alger", commune: "Alger Centre", address: "",
  deliveryType: "office", deliveryExternalId: null, deliverySyncStatus: "not_configured", deliverySyncError: null, notes: "Appeler avant",
  status: "confirmed", items: [{ productId: 7, slug: "ensemble", name: "Ensemble test", image: "", size: "3-4 ans", color: "Bleu", quantity: 2, unitPriceCents: 350000, unitCostCents: 180000 }],
  subtotalCents: 700000, shippingCents: 50000, totalCents: 750000, statusHistory: [], refunds: [], deliveryCost: null, attribution: null,
  createdAt: "2026-08-11T12:00:00.000Z", updatedAt: "2026-08-11T12:00:00.000Z",
};
const customerId = "44444444-4444-4444-8444-444444444444";
const payload = buildZrParcelPayload(order, { cityTerritoryId: cityId, districtTerritoryId: districtId }, 1, customerId, hubId);
assert.equal(payload.externalId, "LS-TEST-001");
assert.equal(payload.deliveryType, "pickup-point");
assert.equal(payload.amount, 7500);
assert.equal(payload.customer.phone.number1, "+213550000001");
assert.equal(payload.customer.customerId, customerId);
assert.equal(payload.deliveryAddress.cityTerritoryId, cityId);
assert.equal(payload.deliveryAddress.districtTerritoryId, districtId);
assert.equal(payload.hubId, hubId);
assert.equal(payload.orderedProducts[0].quantity, 2);
assert.equal(payload.orderedProducts[0].unitPrice, 3500);
assert.equal(payload.orderedProducts[0].stockType, "none");
assert.equal(payload.weight.weight, 1);
assert.ok(payload.description.length <= 250);

const validationError = zrApiErrorMessage({ title: "One or more validation errors occurred.", errors: { "Customer.CustomerId": ["The CustomerId field is required."] } }, 400);
assert.match(validationError, /Customer\.CustomerId/);
assert.match(validationError, /required/);

console.log(JSON.stringify({ ok: true, checks: 19 }, null, 2));
