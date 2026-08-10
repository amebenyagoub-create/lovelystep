// Phase 5 verification: every financial formula, division-by-zero safety, missing-cost
// handling and expense proration.
//
// These tests import the REAL modules (lib/finance/*.ts) rather than re-implementing the
// formulas, so a change in the engine that breaks a rule fails here instead of passing a
// copy of itself. Run via: npm run test:kpis
import assert from "node:assert/strict";
import { median, percent, perUnitMinor, ratio } from "../lib/finance/money.ts";
import { adKpis, codKpis, customerKpis, operatingExpensesMinor, revenueKpis } from "../lib/finance/kpis.ts";

const checks = [];
const check = (label, fn) => { fn(); checks.push({ label, ok: true }); };

// --- fixtures -------------------------------------------------------------------
let nextId = 1;
function order(overrides = {}) {
  const id = overrides.id ?? nextId++;
  return {
    id, orderNumber: `LS-${id}`, customerId: null, firstName: "A", lastName: "B", customerName: "A B",
    phone: overrides.phone ?? "+213550000001", city: "Alger", wilayaCode: "16", wilayaName: "Alger", commune: "Alger Centre",
    address: "", deliveryType: "home", deliveryExternalId: null, deliverySyncStatus: "not_configured", deliverySyncError: null,
    notes: "", status: "delivered",
    items: [{ productId: 1, slug: "p", name: "P", image: "", size: "80", quantity: 2, unitPriceCents: 250000, unitCostCents: 100000 }],
    subtotalCents: 500000, shippingCents: 60000, totalCents: 560000,
    statusHistory: [], refunds: [], deliveryCost: null,
    createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}
const history = (status, at, adminId = 1) => ({ id: nextId++, orderId: 0, status, changedByAdminId: adminId, reasonCode: null, note: null, createdAt: at });
const period = { since: "2026-08-01", until: "2026-08-31" };

// --- division by zero ------------------------------------------------------------
check("division by zero returns null, never Infinity or NaN", () => {
  assert.equal(ratio(100, 0), null);
  assert.equal(percent(100, 0), null);
  assert.equal(perUnitMinor(100, 0), null);
  assert.equal(ratio(0, 0), null);
});
check("zero numerator over positive denominator is a real zero, not null", () => {
  assert.equal(percent(0, 10), 0);
});
check("median handles even, odd and empty sets", () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
});

// --- revenue chain, against the real engine ---------------------------------------
const baseOrder = order({ deliveryCost: { orderId: 1, carrierCostCents: 45000, returnCostCents: 0, source: "manual", updatedAt: "" } });

check("net revenue = gross sales + shipping - refunds", () => {
  const { kpis } = revenueKpis({ orders: [baseOrder], expenses: [], adSpendMinor: 0, ...period });
  assert.equal(kpis.grossSalesMinor, 500000);
  assert.equal(kpis.shippingRevenueMinor, 60000);
  assert.equal(kpis.netRevenueMinor, 560000);
});

check("gross profit = net revenue - COGS", () => {
  const { kpis } = revenueKpis({ orders: [baseOrder], expenses: [], adSpendMinor: 0, ...period });
  assert.equal(kpis.cogsMinor, 200000);
  assert.equal(kpis.grossProfitMinor, 360000);
});

check("contribution before ads subtracts the real delivery cost", () => {
  const { kpis } = revenueKpis({ orders: [baseOrder], expenses: [], adSpendMinor: 0, ...period });
  assert.equal(kpis.contributionBeforeAdsMinor, 315000);
});

check("contribution after ads and net profit chain correctly", () => {
  const expenses = [{ id: 1, category: "Loyer", amountCents: 3000000, currency: "DZD", recurrence: "one_time", costType: "fixed", effectiveFrom: "2026-08-05", effectiveTo: null, allocationMethod: "revenue_weighted", notes: "", source: "manual", createdAt: "", updatedAt: "" }];
  const { kpis } = revenueKpis({ orders: [baseOrder], expenses, adSpendMinor: 100000, ...period });
  assert.equal(kpis.contributionAfterAdsMinor, 215000);
  assert.equal(kpis.operatingExpensesMinor, 3000000);
  assert.equal(kpis.netProfitMinor, 215000 - 3000000);
});

check("ROI = net profit / capital invested (COGS + ad spend)", () => {
  const { kpis } = revenueKpis({ orders: [baseOrder], expenses: [], adSpendMinor: 100000, ...period });
  assert.equal(kpis.capitalInvestedMinor, 300000);
  assert.equal(kpis.roi, kpis.netProfitMinor / 300000);
});

check("break-even ROAS = 1 / contribution margin ratio", () => {
  const { kpis } = revenueKpis({ orders: [baseOrder], expenses: [], adSpendMinor: 0, ...period });
  assert.equal(kpis.breakEvenRoas, 1.78);
});

check("a loss-making period yields no break-even ROAS instead of a negative one", () => {
  const costly = order({ items: [{ productId: 1, slug: "p", name: "P", image: "", size: "80", quantity: 1, unitPriceCents: 100000, unitCostCents: 900000 }], subtotalCents: 100000, shippingCents: 0, totalCents: 100000 });
  const { kpis } = revenueKpis({ orders: [costly], expenses: [], adSpendMinor: 0, ...period });
  assert.ok(kpis.contributionBeforeAdsMinor < 0);
  assert.equal(kpis.breakEvenRoas, null);
});

check("AOV and profit per order use recognised orders only", () => {
  const pending = order({ status: "to_confirm" });
  const { kpis } = revenueKpis({ orders: [baseOrder, pending], expenses: [], adSpendMinor: 0, ...period });
  assert.equal(kpis.orderCount, 2);
  assert.equal(kpis.validOrders, 1, "only delivered orders are recognised");
  assert.equal(kpis.aovMinor, 560000);
});

check("non-delivered orders contribute no revenue", () => {
  const { kpis } = revenueKpis({ orders: [order({ status: "cancelled" }), order({ status: "returned" }), order({ status: "shipped" })], expenses: [], adSpendMinor: 0, ...period });
  assert.equal(kpis.netRevenueMinor, 0);
  assert.equal(kpis.validOrders, 0);
  assert.equal(kpis.aovMinor, null, "no valid orders must not yield a fake AOV");
});

check("partial refunds reduce net revenue exactly once", () => {
  const refunded = order({ refunds: [{ id: 1, orderId: 1, amountCents: 100000, reason: "", createdByAdminId: 1, createdAt: "" }, { id: 2, orderId: 1, amountCents: 60000, reason: "", createdByAdminId: 1, createdAt: "" }] });
  const { kpis } = revenueKpis({ orders: [refunded], expenses: [], adSpendMinor: 0, ...period });
  assert.equal(kpis.refundsMinor, 160000);
  assert.equal(kpis.netRevenueMinor, 400000);
});

check("upsell counts revenue from lines beyond the first item", () => {
  const multi = order({ items: [
    { productId: 1, slug: "a", name: "A", image: "", size: "80", quantity: 1, unitPriceCents: 250000, unitCostCents: 100000 },
    { productId: 2, slug: "b", name: "B", image: "", size: "80", quantity: 2, unitPriceCents: 180000, unitCostCents: 80000 },
  ] });
  const { kpis } = revenueKpis({ orders: [multi], expenses: [], adSpendMinor: 0, ...period });
  assert.equal(kpis.upsellOrders, 1);
  assert.equal(kpis.upsellRevenueMinor, 360000);
  const single = revenueKpis({ orders: [baseOrder], expenses: [], adSpendMinor: 0, ...period });
  assert.equal(single.kpis.upsellRevenueMinor, 0);
});

// --- missing data must never read as zero -------------------------------------------
check("a missing unit cost is reported, not silently treated as free", () => {
  const noCost = order({ items: [{ productId: 1, slug: "p", name: "P", image: "", size: "80", quantity: 2, unitPriceCents: 250000 }] });
  const { kpis, completeness } = revenueKpis({ orders: [noCost], expenses: [], adSpendMinor: 0, ...period });
  assert.equal(completeness.ordersMissingCogs, 1);
  assert.equal(completeness.complete, false);
  assert.ok(completeness.notes.some((note) => note.includes("coût produit")));
  assert.equal(kpis.cogsMinor, 0, "the total excludes it, and completeness says so");
});

check("a missing delivery cost is reported", () => {
  const { completeness } = revenueKpis({ orders: [order()], expenses: [], adSpendMinor: 0, ...period });
  assert.equal(completeness.deliveredOrdersMissingDeliveryCost, 1);
  assert.equal(completeness.complete, false);
});

check("unconverted ad spend disables profit-after-ads, ROI and capital", () => {
  const { kpis, completeness } = revenueKpis({ orders: [baseOrder], expenses: [], adSpendMinor: null, ...period });
  assert.equal(kpis.contributionAfterAdsMinor, null);
  assert.equal(kpis.netProfitMinor, null);
  assert.equal(kpis.roi, null);
  assert.equal(kpis.capitalInvestedMinor, null);
  assert.equal(completeness.adSpendConverted, false);
  // Figures that do not depend on ad spend stay available.
  assert.equal(kpis.grossProfitMinor, 360000);
});

check("a fully-costed period reports as complete", () => {
  const { completeness } = revenueKpis({ orders: [baseOrder], expenses: [], adSpendMinor: 100000, ...period });
  assert.equal(completeness.complete, true);
  assert.deepEqual(completeness.notes, []);
});

// --- expense proration -----------------------------------------------------------------
check("recurring expenses prorate by overlapping days", () => {
  const monthly = [{ id: 1, category: "Loyer", amountCents: 3000000, currency: "DZD", recurrence: "recurring", costType: "fixed", effectiveFrom: "2026-08-01", effectiveTo: null, allocationMethod: "revenue_weighted", notes: "", source: "manual", createdAt: "", updatedAt: "" }];
  assert.equal(operatingExpensesMinor(monthly, "2026-08-01", "2026-08-10"), 1000000);
});
check("one-time expenses count in full inside the period and not outside it", () => {
  const once = (from) => [{ id: 1, category: "X", amountCents: 500000, currency: "DZD", recurrence: "one_time", costType: "fixed", effectiveFrom: from, effectiveTo: null, allocationMethod: "even_split", notes: "", source: "manual", createdAt: "", updatedAt: "" }];
  assert.equal(operatingExpensesMinor(once("2026-08-15"), "2026-08-01", "2026-08-31"), 500000);
  assert.equal(operatingExpensesMinor(once("2026-07-15"), "2026-08-01", "2026-08-31"), 0);
});
check("an ended recurring expense stops contributing", () => {
  const ended = [{ id: 1, category: "X", amountCents: 3000000, currency: "DZD", recurrence: "recurring", costType: "fixed", effectiveFrom: "2026-06-01", effectiveTo: "2026-07-01", allocationMethod: "even_split", notes: "", source: "manual", createdAt: "", updatedAt: "" }];
  assert.equal(operatingExpensesMinor(ended, "2026-08-01", "2026-08-31"), 0);
});

// --- COD funnel --------------------------------------------------------------------------
check("confirmation rate excludes orders still awaiting a decision", () => {
  const orders = [
    order({ status: "delivered", statusHistory: [history("confirmed", "2026-08-01T12:00:00.000Z")] }),
    order({ status: "refused", statusHistory: [history("refused", "2026-08-01T12:00:00.000Z")] }),
    order({ status: "to_confirm", statusHistory: [] }),
  ];
  const kpis = codKpis(orders);
  // 1 confirmed out of 2 that reached a decision; the awaiting order is excluded.
  assert.equal(kpis.confirmationRatePercent, 50);
});

check("delivery performance counts refused only when already shipped", () => {
  const orders = [
    order({ status: "delivered", statusHistory: [history("shipped", "2026-08-02T10:00:00.000Z"), history("delivered", "2026-08-04T10:00:00.000Z")] }),
    order({ status: "returned", statusHistory: [history("shipped", "2026-08-02T10:00:00.000Z"), history("returned", "2026-08-06T10:00:00.000Z")] }),
    // Refused AFTER shipping: a genuine delivery failure.
    order({ status: "refused", statusHistory: [history("shipped", "2026-08-02T10:00:00.000Z"), history("refused", "2026-08-05T10:00:00.000Z")] }),
    // Refused BEFORE shipping: a confirmation failure, must not penalise the carrier.
    order({ status: "refused", statusHistory: [history("refused", "2026-08-02T10:00:00.000Z")] }),
  ];
  const kpis = codKpis(orders);
  assert.equal(kpis.shipped, 3);
  assert.equal(kpis.deliveryPerformancePercent, 33.3, "1 delivered of 3 shipped outcomes");
  assert.equal(kpis.failedDeliveryRatePercent, 33.3);
});

check("per-agent confirmation performance divides by what that agent handled", () => {
  const orders = [
    order({ statusHistory: [history("confirmed", "2026-08-01T12:00:00.000Z", 7)] }),
    order({ statusHistory: [history("confirmed", "2026-08-01T13:00:00.000Z", 7)] }),
    order({ statusHistory: [history("refused", "2026-08-01T14:00:00.000Z", 7)] }),
    order({ statusHistory: [history("confirmed", "2026-08-01T15:00:00.000Z", 9)] }),
  ];
  const kpis = codKpis(orders);
  const agent7 = kpis.confirmationPerformance.find((entry) => entry.adminId === 7);
  assert.equal(agent7.handled, 3);
  assert.equal(agent7.confirmed, 2);
  assert.equal(agent7.ratePercent, 66.7);
  const agent9 = kpis.confirmationPerformance.find((entry) => entry.adminId === 9);
  assert.equal(agent9.ratePercent, 100);
});

check("shipping fee difference = shipping revenue - outbound - return costs", () => {
  const shipped = order({ status: "delivered", deliveryCost: { orderId: 1, carrierCostCents: 45000, returnCostCents: 25000, source: "manual", updatedAt: "" } });
  const kpis = codKpis([shipped]);
  assert.equal(kpis.shippingRevenueMinor, 60000);
  assert.equal(kpis.shippingFeeDifferenceMinor, -10000);
  assert.equal(kpis.shippingFeeDifferencePerDeliveredMinor, -10000);
});

check("an empty funnel yields nulls, not zeros or Infinity", () => {
  const kpis = codKpis([]);
  assert.equal(kpis.confirmationRatePercent, null);
  assert.equal(kpis.deliveryRatePercent, null);
  assert.equal(kpis.deliveryPerformancePercent, null);
  assert.equal(kpis.medianDaysToDeliver, null);
});

check("median time to confirm and to deliver are computed from history", () => {
  const orders = [order({
    createdAt: "2026-08-01T00:00:00.000Z",
    statusHistory: [history("confirmed", "2026-08-01T12:00:00.000Z"), history("shipped", "2026-08-02T00:00:00.000Z"), history("delivered", "2026-08-04T00:00:00.000Z")],
  })];
  const kpis = codKpis(orders);
  assert.equal(kpis.medianHoursToConfirm, 12);
  assert.equal(kpis.medianDaysToDeliver, 2);
});

// --- customers ------------------------------------------------------------------------------
check("new versus returning buyers use history from before the period", () => {
  const prior = [order({ phone: "+213550000001", status: "delivered" })];
  const current = [order({ phone: "+213550000001" }), order({ phone: "+213550000002" })];
  const kpis = customerKpis(current, prior, 100000, 40000);
  assert.equal(kpis.uniqueBuyers, 2);
  assert.equal(kpis.newBuyers, 1, "the returning phone must not count as new");
  assert.equal(kpis.returningBuyers, 1);
  assert.equal(kpis.acquisitionRatePercent, 50);
});

check("CAC divides ad spend by NEW buyers", () => {
  const kpis = customerKpis([order({ phone: "+213550000002" })], [], null, 100000);
  assert.equal(kpis.cacMinor, 100000, "one new buyer");
  const noNew = customerKpis([order({ phone: "+213550000001" })], [order({ phone: "+213550000001" })], null, 100000);
  assert.equal(noNew.cacMinor, null, "zero new buyers must not yield Infinity CAC");
});

check("repeat purchase rate uses lifetime history", () => {
  const prior = [order({ phone: "+213550000001" })];
  const current = [order({ phone: "+213550000001" }), order({ phone: "+213550000003" })];
  const kpis = customerKpis(current, prior, null, null);
  // Two distinct customers overall; one of them has two recognised orders.
  assert.equal(kpis.repeatPurchaseRatePercent, 50);
});

check("customer metrics on an empty period return nulls", () => {
  const kpis = customerKpis([], [], null, null);
  assert.equal(kpis.uniqueBuyers, 0);
  assert.equal(kpis.acquisitionRatePercent, null);
  assert.equal(kpis.averageCustomerValueMinor, null);
  assert.equal(kpis.ltvToCac, null);
});

// --- advertising ratios -------------------------------------------------------------------------
check("Meta-reported and store-attributed ROAS stay separate", () => {
  const kpis = adKpis({ adSpendMinor: 100000, metaPurchaseValueMinor: 400000, storeNetRevenueMinor: 560000, attributedNetRevenueMinor: 250000, attributedContributionMinor: 90000, attributedPurchases: 4 });
  assert.equal(kpis.metaReportedRoas, 4);
  assert.equal(kpis.storeAttributedRoas, 2.5);
  assert.notEqual(kpis.metaReportedRoas, kpis.storeAttributedRoas);
  assert.equal(kpis.mer, 5.6);
  assert.equal(kpis.poas, 0.9);
  assert.equal(kpis.cpaMinor, 25000);
});

check("every ad ratio is null when spend is unconverted", () => {
  const kpis = adKpis({ adSpendMinor: null, metaPurchaseValueMinor: 400000, storeNetRevenueMinor: 560000, attributedNetRevenueMinor: 250000, attributedContributionMinor: 90000, attributedPurchases: 4 });
  for (const [name, value] of Object.entries(kpis)) assert.equal(value, null, `${name} must be null without converted spend`);
});

check("zero spend yields null ratios rather than Infinity", () => {
  const kpis = adKpis({ adSpendMinor: 0, metaPurchaseValueMinor: 400000, storeNetRevenueMinor: 560000, attributedNetRevenueMinor: 250000, attributedContributionMinor: 90000, attributedPurchases: 0 });
  assert.equal(kpis.metaReportedRoas, null);
  assert.equal(kpis.mer, null);
  assert.equal(kpis.cpaMinor, null);
});

// --- money integrity ------------------------------------------------------------------------------
check("no KPI returns non-integer money", () => {
  const { kpis } = revenueKpis({ orders: [baseOrder, order({ subtotalCents: 333333, totalCents: 333333, shippingCents: 0 })], expenses: [], adSpendMinor: 77777, ...period });
  const monetary = ["grossSalesMinor", "netRevenueMinor", "cogsMinor", "grossProfitMinor", "contributionBeforeAdsMinor", "contributionAfterAdsMinor", "netProfitMinor", "aovMinor", "profitPerOrderMinor", "capitalInvestedMinor", "upsellRevenueMinor"];
  for (const key of monetary) {
    const value = kpis[key];
    assert.ok(value === null || Number.isInteger(value), `${key} = ${value} must be an integer minor unit`);
  }
});

console.log(JSON.stringify({ ok: true, checks: checks.length, labels: checks.map((c) => c.label) }, null, 2));
