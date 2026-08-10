// Phase 6 verification: attribution touch capture, first/last touch rules, Meta detection,
// store-attributed totals and payload validation.
// Imports the REAL modules. Run via: npm run test:attribution
import assert from "node:assert/strict";
import { isMetaTouch, mergeAttribution, readTouch } from "../lib/meta/attribution.ts";
import { attributedTotals } from "../lib/finance/kpis.ts";

const checks = [];
const check = (label, fn) => { fn(); checks.push({ label, ok: true }); };

// --- touch capture ------------------------------------------------------------------
check("a Meta click is captured from fbclid", () => {
  const touch = readTouch("https://shop.dz/produits/a?fbclid=IwAR123", "https://facebook.com/");
  assert.ok(touch);
  assert.equal(touch.fbclid, "IwAR123");
  assert.equal(touch.landingPage, "/produits/a");
});

check("UTM parameters are captured", () => {
  const touch = readTouch("https://shop.dz/?utm_source=facebook&utm_medium=cpc&utm_campaign=ete&utm_content=ad7", "");
  assert.equal(touch.utmSource, "facebook");
  assert.equal(touch.utmMedium, "cpc");
  assert.equal(touch.utmCampaign, "ete");
  assert.equal(touch.utmContent, "ad7");
});

check("an internal navigation without campaign params is NOT a touch", () => {
  // Otherwise browsing the site would overwrite the campaign that brought the visitor.
  assert.equal(readTouch("https://shop.dz/produits/b", "https://shop.dz/"), null);
});

check("an external referrer without params still counts as a touch", () => {
  const touch = readTouch("https://shop.dz/", "https://google.com/search");
  assert.ok(touch, "organic arrivals should be recorded");
  assert.equal(touch.referrer, "https://google.com/search");
});

check("a malformed URL yields no touch instead of throwing", () => {
  assert.equal(readTouch("not-a-url", ""), null);
});

check("captured values are length-capped", () => {
  const touch = readTouch(`https://shop.dz/?utm_campaign=${"x".repeat(500)}`, "");
  assert.ok(touch.utmCampaign.length <= 200);
});

// --- first / last touch ---------------------------------------------------------------
check("the first touch is written once and never overwritten", () => {
  const first = { at: "2026-08-01T00:00:00.000Z", fbclid: "A" };
  const second = { at: "2026-08-05T00:00:00.000Z", fbclid: "B" };
  const third = { at: "2026-08-09T00:00:00.000Z", utmSource: "google" };
  let state = mergeAttribution(null, first);
  state = mergeAttribution(state, second);
  state = mergeAttribution(state, third);
  assert.equal(state.first.fbclid, "A", "first touch must be preserved");
  assert.equal(state.last.utmSource, "google", "last touch must advance");
});

// --- Meta detection -----------------------------------------------------------------------
check("fbclid marks a touch as Meta", () => {
  assert.equal(isMetaTouch({ at: "", fbclid: "IwAR1" }), true);
});
check("known Meta utm_source values are recognised, case-insensitively", () => {
  for (const source of ["facebook", "Instagram", "META", "fb", "ig"]) {
    assert.equal(isMetaTouch({ at: "", utmSource: source }), true, `${source} should be Meta`);
  }
});
check("non-Meta sources are not attributed to Meta", () => {
  for (const source of ["google", "tiktok", "newsletter", ""]) {
    assert.equal(isMetaTouch({ at: "", utmSource: source }), false, `${source} must not be Meta`);
  }
  assert.equal(isMetaTouch(undefined), false);
});

// --- store-attributed totals, against the real KPI engine ---------------------------------
let nextId = 1;
function order(overrides = {}) {
  const id = overrides.id ?? nextId++;
  return {
    id, orderNumber: `LS-${id}`, customerId: null, firstName: "A", lastName: "B", customerName: "A B",
    phone: "+213550000001", city: "Alger", wilayaCode: "16", wilayaName: "Alger", commune: "Alger Centre",
    address: "", deliveryType: "home", deliveryExternalId: null, deliverySyncStatus: "not_configured", deliverySyncError: null,
    notes: "", status: "delivered",
    items: [{ productId: 1, slug: "p", name: "P", image: "", size: "80", quantity: 2, unitPriceCents: 250000, unitCostCents: 100000 }],
    subtotalCents: 500000, shippingCents: 60000, totalCents: 560000,
    statusHistory: [], refunds: [], deliveryCost: { orderId: id, carrierCostCents: 45000, returnCostCents: 0, source: "manual", updatedAt: "" },
    attribution: null,
    createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}
const attribution = (over = {}) => ({ orderId: 0, isMetaLastTouch: false, isMetaFirstTouch: false, utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, firstUtmCampaign: null, landingPage: null, referrer: null, firstTouchAt: "", lastTouchAt: "", ...over });

check("only Meta-attributed orders count toward attributed revenue", () => {
  const orders = [
    order({ attribution: attribution({ isMetaLastTouch: true }) }),
    order({ attribution: attribution({ isMetaLastTouch: false, utmSource: "google" }) }),
    order({ attribution: null }),
  ];
  const totals = attributedTotals(orders, "last");
  assert.equal(totals.attributedOrders, 1);
  assert.equal(totals.attributedNetRevenueMinor, 560000);
  assert.equal(totals.ordersWithoutAttribution, 1);
});

check("attributed contribution uses the same cost logic as overall profit", () => {
  const totals = attributedTotals([order({ attribution: attribution({ isMetaLastTouch: true }) })], "last");
  // 560000 net - 200000 COGS - 45000 delivery
  assert.equal(totals.attributedContributionMinor, 315000);
});

check("attributed contribution is null when an attributed order lacks cost data", () => {
  const noCost = order({ attribution: attribution({ isMetaLastTouch: true }), deliveryCost: null });
  const totals = attributedTotals([noCost], "last");
  assert.equal(totals.attributedContributionMinor, null, "an incomplete margin must not be published");
  assert.equal(totals.attributedNetRevenueMinor, 560000, "revenue is still known");
});

check("the first-touch model selects different orders than last-touch", () => {
  const orders = [
    order({ attribution: attribution({ isMetaFirstTouch: true, isMetaLastTouch: false }) }),
    order({ attribution: attribution({ isMetaFirstTouch: false, isMetaLastTouch: true }) }),
  ];
  assert.equal(attributedTotals(orders, "first").attributedOrders, 1);
  assert.equal(attributedTotals(orders, "last").attributedOrders, 1);
  const both = order({ attribution: attribution({ isMetaFirstTouch: true, isMetaLastTouch: true }) });
  assert.equal(attributedTotals([...orders, both], "first").attributedOrders, 2);
});

check("non-delivered orders are excluded from attributed revenue", () => {
  const orders = [
    order({ status: "shipped", attribution: attribution({ isMetaLastTouch: true }) }),
    order({ status: "cancelled", attribution: attribution({ isMetaLastTouch: true }) }),
  ];
  const totals = attributedTotals(orders, "last");
  assert.equal(totals.attributedOrders, 0);
  assert.equal(totals.attributedNetRevenueMinor, 0);
});

check("refunds reduce attributed revenue", () => {
  const refunded = order({
    attribution: attribution({ isMetaLastTouch: true }),
    refunds: [{ id: 1, orderId: 1, amountCents: 60000, reason: "", createdByAdminId: 1, createdAt: "" }],
  });
  assert.equal(attributedTotals([refunded], "last").attributedNetRevenueMinor, 500000);
});

check("coverage is null rather than 0% when there are no recognised orders", () => {
  const totals = attributedTotals([], "last");
  assert.equal(totals.coveragePercent, null);
  assert.equal(totals.attributedOrders, 0);
});

check("coverage reports the share of orders carrying any attribution", () => {
  const orders = [
    order({ attribution: attribution({ isMetaLastTouch: true }) }),
    order({ attribution: attribution({ utmSource: "google" }) }),
    order({ attribution: null }),
    order({ attribution: null }),
  ];
  assert.equal(attributedTotals(orders, "last").coveragePercent, 50);
});

console.log(JSON.stringify({ ok: true, checks: checks.length, labels: checks.map((c) => c.label) }, null, 2));
