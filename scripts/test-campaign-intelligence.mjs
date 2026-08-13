import assert from "node:assert/strict";
import { validateCampaignNarrative } from "../lib/campaign-intelligence/ai-schema.ts";
import { decideCampaign } from "../lib/campaign-intelligence/decision.ts";
import { deterministicExplanation } from "../lib/campaign-intelligence/fallback.ts";
import { computeCampaignKpis } from "../lib/campaign-intelligence/kpis.ts";
import { DEFAULT_CAMPAIGN_THRESHOLDS as thresholds } from "../lib/campaign-intelligence/thresholds.ts";
import { emptyCampaignTrend } from "../lib/campaign-intelligence/trends.ts";

const checks = [];
const check = (label, fn) => { fn(); checks.push(label); };
let nextId = 1;

function history(status, orderId) {
  return { id: nextId++, orderId, status, changedByAdminId: 1, reasonCode: null, note: null, createdAt: "2026-08-02T10:00:00.000Z" };
}

function order(overrides = {}) {
  const id = nextId++;
  const status = overrides.status ?? "delivered";
  const defaultHistory = [history("confirmed", id), history("shipped", id), ...(status === "delivered" ? [history("delivered", id)] : [])];
  return {
    id, orderNumber: `LS-${id}`, customerId: null, firstName: "A", lastName: "B", customerName: "A B", phone: `055000${id}`,
    city: "Alger", wilayaCode: "16", wilayaName: "Alger", commune: "Alger", address: "", deliveryType: "home",
    deliveryExternalId: null, deliverySyncStatus: "sent", deliverySyncError: null, notes: "", status,
    items: [{ productId: 1, slug: "p", name: "P", image: "", size: "1", quantity: 1, unitPriceCents: 460_000, unitCostCents: 200_000 }],
    subtotalCents: 460_000, shippingCents: 40_000, totalCents: 500_000,
    statusHistory: defaultHistory, refunds: [], deliveryCost: { orderId: id, carrierCostCents: 50_000, returnCostCents: 0, source: "test", updatedAt: "" }, attribution: null,
    createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-03T10:00:00.000Z", ...overrides,
  };
}

function daily(overrides = {}) {
  return { date: "2026-08-01", spendMinor: 100_000, purchaseValueMinor: 500_000, impressions: 10_000, reach: 5_000, clicks: 400, linkClicks: 300, landingPageViews: 250, addsToCart: 30, checkouts: 15, purchases: 10, ...overrides };
}

function evaluate({ orders = [], dailyRows = [daily()], trend = emptyCampaignTrend(), baseline = true } = {}) {
  const kpis = computeCampaignKpis({
    daily: dailyRows,
    orders,
    allocatedVariableCostsMinor: 0,
    historicalConfirmationRatePercent: 70,
    historicalDeliveryRatePercent: 70,
    baselineContributionPerDeliveredOrderMinor: baseline ? 250_000 : null,
    baselineAverageOrderRevenueMinor: baseline ? 500_000 : null,
    thresholds,
  });
  return { kpis, trend, decision: decideCampaign(kpis, trend, thresholds) };
}

check("A: strong profitable campaign scales", () => {
  const result = evaluate({ orders: Array.from({ length: 10 }, () => order()), dailyRows: [daily({ spendMinor: 300_000, purchases: 10 })] });
  assert.equal(result.decision.status, "SCALE");
  assert.equal(result.decision.reasonCode, "PROFITABLE_BELOW_TARGET_CPA");
});

check("B: profitable performance near target is kept", () => {
  const result = evaluate({ orders: Array.from({ length: 6 }, () => order()), dailyRows: [daily({ spendMinor: 600_000, purchases: 6 })] });
  assert.equal(result.decision.status, "KEEP");
  assert.equal(result.decision.reasonCode, "PROFITABLE_WITHIN_GUARDRAILS");
});

check("D: enough data with materially high CPA and negative profit is killed", () => {
  const result = evaluate({ orders: Array.from({ length: 6 }, () => order()), dailyRows: [daily({ spendMinor: 2_000_000, purchases: 6 })] });
  assert.equal(result.decision.status, "KILL");
  assert.equal(result.decision.reasonCode, "UNPROFITABLE_ABOVE_CPA_LIMIT");
});

check("F: excessive spend without a purchase is killed", () => {
  const result = evaluate({ orders: [], dailyRows: [daily({ spendMinor: 130_000, purchases: 0, purchaseValueMinor: 0 })] });
  assert.equal(result.decision.status, "KILL");
  assert.equal(result.decision.reasonCode, "SPEND_WITHOUT_PURCHASE");
});

check("G: poor delivery and high refusals override attractive Meta acquisition", () => {
  const delivered = [order(), order()];
  const returned = [order({ status: "returned", deliveryCost: { orderId: 90, carrierCostCents: 50_000, returnCostCents: 50_000, source: "test", updatedAt: "" } }), order({ status: "returned", deliveryCost: { orderId: 91, carrierCostCents: 50_000, returnCostCents: 50_000, source: "test", updatedAt: "" } })];
  const refused = [order({ status: "refused", statusHistory: [], deliveryCost: null }), order({ status: "refused", statusHistory: [], deliveryCost: null })];
  const result = evaluate({ orders: [...delivered, ...returned, ...refused], dailyRows: [daily({ spendMinor: 100_000, purchases: 6 })] });
  assert.ok(["WATCH", "KILL"].includes(result.decision.status));
  assert.equal(result.decision.reasonCode, "COD_QUALITY_FAILURE");
});

check("E: insufficient data stays on watch", () => {
  const pending = order({ status: "new", statusHistory: [], deliveryCost: null });
  const result = evaluate({ orders: [pending], dailyRows: [daily({ spendMinor: 10_000, purchases: 1 })] });
  assert.equal(result.decision.status, "WATCH");
  assert.equal(result.decision.reasonCode, "INSUFFICIENT_DATA");
});

check("C: a declining trend blocks scaling", () => {
  const trend = { ...emptyCampaignTrend(), direction: "declining", summary: "Efficiency is deteriorating." };
  const result = evaluate({ orders: Array.from({ length: 6 }, () => order()), dailyRows: [daily({ spendMinor: 180_000, purchases: 6 })], trend });
  assert.equal(result.decision.status, "WATCH");
  assert.equal(result.decision.reasonCode, "DECLINING_PERFORMANCE");
});

check("C additional: deterministic creative fatigue triggers watch", () => {
  const trend = { ...emptyCampaignTrend(), direction: "declining", creativeFatigue: { detected: true, confidence: "high", signals: ["Frequency high.", "CTR falling.", "CPA rising."] } };
  const result = evaluate({ orders: Array.from({ length: 6 }, () => order()), dailyRows: [daily({ spendMinor: 180_000, purchases: 6 })], trend });
  assert.equal(result.decision.status, "WATCH");
  assert.equal(result.decision.reasonCode, "CREATIVE_FATIGUE");
});

check("G: missing costs reduce confidence and prevent a scale decision", () => {
  const incomplete = order({ items: [{ productId: 1, slug: "p", name: "P", image: "", size: "1", quantity: 1, unitPriceCents: 460_000 }] });
  const result = evaluate({ orders: [incomplete], dailyRows: [daily({ spendMinor: 20_000, purchases: 1 })] });
  assert.equal(result.decision.status, "WATCH");
  assert.equal(result.decision.confidence, "low");
  assert.equal(result.kpis.completeness.complete, false);
});

check("H: Groq failure path has a usable deterministic fallback", () => {
  const result = evaluate({ orders: [order()], dailyRows: [daily({ spendMinor: 20_000, purchases: 1 })] });
  const fallback = deterministicExplanation(result.decision, result.kpis, result.trend, "2026-08-13T00:00:00.000Z");
  assert.equal(fallback.source, "deterministic_fallback");
  assert.ok(fallback.headline.includes(result.decision.status));
  assert.ok(fallback.nextAction.length > 0);
});

check("untrusted AI JSON is runtime validated", () => {
  assert.throws(() => validateCampaignNarrative({ headline: "x", explanation: "y", diagnostics: [], nextAction: "z" }));
  assert.deepEqual(validateCampaignNarrative({ headline: "H", explanation: "E", diagnostics: ["D"], nextAction: "N", status: "SCALE" }), { headline: "H", explanation: "E", diagnostics: ["D"], nextAction: "N" });
});

console.log(`Campaign intelligence: ${checks.length} checks passed.`);
for (const label of checks) console.log(`  ✓ ${label}`);
