import assert from "node:assert/strict";
import { filterAdminOrders, orderElapsedLabel } from "../lib/admin-order-filter.ts";

const orders = [
  { status: "new", orderNumber: "LS-101", customerName: "Amélie Test", firstName: "Amélie", lastName: "Test", phone: "0555 12 34 56", city: "Alger", wilayaName: "Alger", commune: "Bab Ezzouar", deliveryHubName: null, deliveryTracking: "ZR-900", deliveryExternalId: null, items: [{ name: "Ensemble bleu", size: "3 ans", color: "Bleu" }] },
  { status: "delivered", orderNumber: "LS-102", customerName: "Samir", firstName: "Samir", lastName: "", phone: "0661 00 00 00", city: "Oran", wilayaName: "Oran", commune: "Bir El Djir", deliveryHubName: null, deliveryTracking: null, deliveryExternalId: null, items: [{ name: "Cardigan beige", size: "4 ans", color: "Beige" }] },
];

assert.deepEqual(filterAdminOrders(orders, "new", ""), [orders[0]]);
assert.deepEqual(filterAdminOrders(orders, "all", "amelie"), [orders[0]]);
assert.deepEqual(filterAdminOrders(orders, "all", "0555123456"), [orders[0]]);
assert.deepEqual(filterAdminOrders(orders, "delivered", "cardigan"), [orders[1]]);
assert.deepEqual(filterAdminOrders(orders, "new", "Oran"), []);
assert.equal(orderElapsedLabel("2026-09-12T10:00:00Z", Date.parse("2026-09-12T10:00:30Z")), "À l’instant");
assert.equal(orderElapsedLabel("2026-09-12T10:00:00Z", Date.parse("2026-09-12T12:07:00Z")), "Il y a 2 h 7 min");
assert.equal(orderElapsedLabel("2026-09-10T10:00:00Z", Date.parse("2026-09-12T13:04:00Z")), "Il y a 2 j 3 h 4 min");

console.log("Admin order filters and elapsed time: OK");
