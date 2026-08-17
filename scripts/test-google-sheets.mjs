import assert from "node:assert/strict";
import { ORDER_SHEET_HEADERS, orderSheetRow, verifyGoogleSheetsConnection } from "../lib/google-sheets.ts";

const sample = {
  id: 1,
  orderNumber: "LS-TEST-NOT-WRITTEN",
  customerId: null,
  firstName: "Lina",
  lastName: "Test",
  customerName: "Lina Test",
  phone: "+213550000001",
  city: "Alger Centre",
  wilayaCode: "16",
  wilayaName: "Alger",
  commune: "Alger Centre",
  address: "",
  deliveryType: "home",
  deliveryExternalId: null,
  deliverySyncStatus: "not_configured",
  deliverySyncError: null,
  notes: "Appeler avant",
  status: "new",
  items: [{ productId: 7, slug: "ensemble", name: "Ensemble test", image: "", size: "110", color: "Bleu", quantity: 2, unitPriceCents: 350000 }],
  subtotalCents: 700000,
  shippingCents: 50000,
  totalCents: 750000,
  statusHistory: [],
  refunds: [],
  deliveryCost: null,
  attribution: null,
  createdAt: "2026-08-17T12:00:00.000Z",
  updatedAt: "2026-08-17T12:00:00.000Z",
};

const row = orderSheetRow(sample);
assert.equal(row.length, ORDER_SHEET_HEADERS.length);
assert.equal(row[4], "0550000001");
assert.equal(row[5], "+213550000001");
assert.match(row[12], /2-3 ans/);
assert.equal(row[14], 7500);
assert.equal(row[15], "home");

const connection = await verifyGoogleSheetsConnection();
console.log(JSON.stringify({ ok: true, spreadsheetId: connection.spreadsheetId, tabName: connection.tabName, columns: ORDER_SHEET_HEADERS.length }, null, 2));
