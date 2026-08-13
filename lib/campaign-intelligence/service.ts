import "server-only";

import crypto from "node:crypto";
import { getCampaignAiCache, getCampaignThresholdOverrides, listCampaignInsightRows, listExpenses, listFxRates, listOrdersForPeriod, listSyncState, saveCampaignAiCache, type CampaignInsightDailyRecord } from "../db-postgres";
import { operatingExpensesMinor, reportingDay } from "../finance/kpis";
import type { Order } from "../types";
import { validateCampaignNarrative } from "./ai-schema";
import { decideCampaign } from "./decision";
import { deterministicExplanation } from "./fallback";
import { campaignAiModel, generateGroqCampaignNarrative } from "./groq";
import { computeCampaignKpis } from "./kpis";
import { campaignThresholds } from "./thresholds";
import { analyzeCampaignTrend, emptyCampaignTrend } from "./trends";
import type { CampaignAiExplanation, CampaignAnalysis, CampaignDailyMetric, CampaignDecision, CampaignIntelligenceResponse, CampaignKpis, CampaignTrend } from "./types";

const REPORTING_TIMEZONE = "Africa/Algiers" as const;
const REPORTING_CURRENCY = "DZD" as const;

function normalizeCampaignName(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function ratePercent(numerator: number, denominator: number, fallback: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 1_000) / 10 : fallback;
}

function historicalRates(orders: Order[]): { confirmation: number; delivery: number } {
  const confirmationOutcomes = orders.filter((order) => order.statusHistory.some((entry) => entry.status === "confirmed") || ["refused", "cancelled"].includes(order.status));
  const confirmed = confirmationOutcomes.filter((order) => order.statusHistory.some((entry) => entry.status === "confirmed") || ["confirmed", "preparing", "shipped", "delivered", "returned"].includes(order.status)).length;
  const deliveryOutcomes = orders.filter((order) => ["delivered", "returned"].includes(order.status) || (order.status === "refused" && order.statusHistory.some((entry) => entry.status === "shipped")));
  const delivered = deliveryOutcomes.filter((order) => order.status === "delivered").length;
  return {
    confirmation: ratePercent(confirmed, confirmationOutcomes.length, 70),
    delivery: ratePercent(delivered, deliveryOutcomes.length, 70),
  };
}

function convertMinor(row: CampaignInsightDailyRecord, amount: number, rates: Map<string, number>): number | null {
  if (!row.currency || row.currency === "DZD") return amount;
  const rate = rates.get(`${row.date}|${row.currency.toUpperCase()}`);
  return rate == null ? null : Math.round(amount * rate);
}

function orderCampaign(order: Order): string {
  const attribution = order.attribution;
  if (!attribution) return "";
  return normalizeCampaignName(attribution.utmCampaign);
}

function toDaily(row: CampaignInsightDailyRecord, rates: Map<string, number>): CampaignDailyMetric {
  return {
    date: row.date,
    spendMinor: convertMinor(row, row.spendMinor, rates),
    purchaseValueMinor: convertMinor(row, row.purchaseValueMinor, rates),
    impressions: row.impressions,
    reach: row.reach,
    clicks: row.clicks,
    linkClicks: row.linkClicks,
    landingPageViews: row.landingPageViews,
    addsToCart: row.addsToCart,
    checkouts: row.checkouts,
    purchases: row.purchases,
  };
}

function splitWindow(daily: CampaignDailyMetric[], orders: Order[], allocatedVariableCostsMinor: number, rates: { confirmation: number; delivery: number }, baseline: { contribution: number | null; revenue: number | null }, thresholds: ReturnType<typeof campaignThresholds>): { previous: CampaignKpis; current: CampaignKpis; previousWindow: CampaignTrend["previousWindow"]; currentWindow: CampaignTrend["currentWindow"] } | null {
  const days = [...new Set(daily.map((row) => row.date))].sort();
  if (days.length < 4) return null;
  const middle = Math.floor(days.length / 2);
  const previousDays = new Set(days.slice(0, middle));
  const currentDays = new Set(days.slice(middle));
  const periodShare = (selected: Set<string>) => selected.size / days.length;
  const build = (selected: Set<string>) => computeCampaignKpis({
    daily: daily.filter((row) => selected.has(row.date)),
    orders: orders.filter((order) => selected.has(reportingDay(order.createdAt))),
    allocatedVariableCostsMinor: Math.round(allocatedVariableCostsMinor * periodShare(selected)),
    historicalConfirmationRatePercent: rates.confirmation,
    historicalDeliveryRatePercent: rates.delivery,
    baselineContributionPerDeliveredOrderMinor: baseline.contribution,
    baselineAverageOrderRevenueMinor: baseline.revenue,
    thresholds,
  });
  return {
    previous: build(previousDays),
    current: build(currentDays),
    previousWindow: { since: days[0], until: days[middle - 1] },
    currentWindow: { since: days[middle], until: days[days.length - 1] },
  };
}

function historicalEconomics(orders: Order[]): { contribution: number | null; revenue: number | null } {
  const values = orders.flatMap((order) => {
    if (order.status !== "delivered" || !order.deliveryCost || order.items.some((item) => item.unitCostCents == null)) return [];
    const refunds = order.refunds.reduce((total, refund) => total + refund.amountCents, 0);
    const revenue = order.subtotalCents + order.shippingCents - refunds;
    const costs = order.items.reduce((total, item) => total + (item.unitCostCents ?? 0) * item.quantity, 0)
      + order.deliveryCost.carrierCostCents + order.deliveryCost.returnCostCents;
    return [{ revenue, contribution: revenue - costs }];
  });
  if (!values.length) return { contribution: null, revenue: null };
  return {
    contribution: Math.round(values.reduce((total, value) => total + value.contribution, 0) / values.length),
    revenue: Math.round(values.reduce((total, value) => total + value.revenue, 0) / values.length),
  };
}

function fingerprint(input: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

async function explain(input: {
  entityId: string;
  campaignName: string;
  since: string;
  until: string;
  kpis: CampaignKpis;
  trend: CampaignTrend;
  decision: CampaignDecision;
  allowNetwork: boolean;
}): Promise<CampaignAiExplanation> {
  const generatedAt = new Date().toISOString();
  const key = fingerprint({ entityId: input.entityId, since: input.since, until: input.until, kpis: input.kpis, trend: input.trend, decision: input.decision });
  try {
    const cached = await getCampaignAiCache(key);
    if (cached) {
      const narrative = validateCampaignNarrative(cached.analysis);
      return { source: "groq", model: cached.model, ...narrative, generatedAt: cached.createdAt, cached: true };
    }
  } catch {
    // A stale/corrupt narrative is discarded; deterministic reporting continues below.
  }
  if (!input.allowNetwork || !process.env.GROQ_API_KEY) return deterministicExplanation(input.decision, input.kpis, input.trend, generatedAt);
  try {
    const narrative = await generateGroqCampaignNarrative(input);
    const cacheHours = Math.min(168, Math.max(1, Number(process.env.CAMPAIGN_AI_CACHE_HOURS ?? 12)));
    await saveCampaignAiCache({
      fingerprint: key,
      entityId: input.entityId,
      since: input.since,
      until: input.until,
      deterministicStatus: input.decision.status,
      model: campaignAiModel(),
      analysis: narrative,
      expiresAt: new Date(Date.now() + cacheHours * 3_600_000),
    });
    return { source: "groq", model: campaignAiModel(), ...narrative, generatedAt, cached: false };
  } catch {
    return deterministicExplanation(input.decision, input.kpis, input.trend, generatedAt);
  }
}

export async function getCampaignIntelligence(since: string, until: string): Promise<CampaignIntelligenceResponse> {
  const [{ period: periodOrders, prior: allPriorOrders }, insightRows, expenses, syncState, thresholdOverrides] = await Promise.all([
    listOrdersForPeriod(since, until),
    listCampaignInsightRows(since, until),
    listExpenses(),
    listSyncState(),
    getCampaignThresholdOverrides(),
  ]);
  const thresholds = campaignThresholds(thresholdOverrides);
  const oldestHistoryDate = new Date(Date.parse(`${since}T00:00:00Z`) - 90 * 86_400_000).toISOString().slice(0, 10);
  const priorOrders = allPriorOrders.filter((order) => reportingDay(order.createdAt) >= oldestHistoryDate);
  const globalRates = historicalRates(priorOrders);
  const globalEconomics = historicalEconomics(priorOrders);
  const currencies = [...new Set(insightRows.map((row) => row.currency.toUpperCase()).filter((currency) => currency && currency !== "DZD"))];
  const fxRates = await listFxRates(currencies);
  const rates = new Map(fxRates.map((rate) => [`${rate.rateDate}|${rate.currency.toUpperCase()}`, rate.dzdPerUnit]));

  const groups = new Map<string, CampaignInsightDailyRecord[]>();
  for (const row of insightRows) groups.set(row.entityId, [...(groups.get(row.entityId) ?? []), row]);
  const normalizedEntities = new Map<string, string[]>();
  for (const [entityId, rows] of groups) {
    const normalized = normalizeCampaignName(rows[0]?.entityName);
    if (normalized) normalizedEntities.set(normalized, [...(normalizedEntities.get(normalized) ?? []), entityId]);
  }
  const ordersByEntity = new Map<string, Order[]>();
  let unattributedOrders = 0;
  for (const order of periodOrders) {
    const candidates = normalizedEntities.get(orderCampaign(order)) ?? [];
    if (candidates.length !== 1) { unattributedOrders += 1; continue; }
    ordersByEntity.set(candidates[0], [...(ordersByEntity.get(candidates[0]) ?? []), order]);
  }

  const variableExpensesMinor = operatingExpensesMinor(expenses.filter((expense) => expense.costType === "variable" && expense.currency === "DZD"), since, until);
  const attributedOrderValue = [...ordersByEntity.values()].flat().reduce((total, order) => total + order.totalCents, 0);
  const ranked = [...groups.entries()].sort((a, b) => b[1].reduce((sum, row) => sum + row.spendMinor, 0) - a[1].reduce((sum, row) => sum + row.spendMinor, 0));
  const drafts: Array<Omit<CampaignAnalysis, "explanation">> = [];

  for (let index = 0; index < ranked.length; index += 1) {
    const [entityId, rows] = ranked[index];
    const entityOrders = ordersByEntity.get(entityId) ?? [];
    const entityValue = entityOrders.reduce((total, order) => total + order.totalCents, 0);
    const allocatedVariableCostsMinor = attributedOrderValue > 0 ? Math.round(variableExpensesMinor * entityValue / attributedOrderValue) : 0;
    const campaignKey = normalizeCampaignName(rows[0]?.entityName);
    const entityHistory = priorOrders.filter((order) => orderCampaign(order) === campaignKey);
    const history = entityHistory.length >= thresholds.minimumResolvedOrdersForDecision ? historicalRates(entityHistory) : globalRates;
    const daily = rows.map((row) => toDaily(row, rates));
    const kpis = computeCampaignKpis({
      daily,
      orders: entityOrders,
      allocatedVariableCostsMinor,
      historicalConfirmationRatePercent: history.confirmation,
      historicalDeliveryRatePercent: history.delivery,
      baselineContributionPerDeliveredOrderMinor: globalEconomics.contribution,
      baselineAverageOrderRevenueMinor: globalEconomics.revenue,
      thresholds,
    });
    const split = splitWindow(daily, entityOrders, allocatedVariableCostsMinor, history, globalEconomics, thresholds);
    const trend = split ? analyzeCampaignTrend({ previous: split.previous, current: split.current, previousWindow: split.previousWindow, currentWindow: split.currentWindow, thresholds }) : emptyCampaignTrend();
    const decision = decideCampaign(kpis, trend, thresholds);
    drafts.push({
      entity: { level: "campaign", id: entityId, name: rows[0]?.entityName || entityId, status: rows.at(-1)?.status ?? null, objective: rows.at(-1)?.objective ?? null, currency: rows[0]?.currency ?? "" },
      period: { since, until, timezone: REPORTING_TIMEZONE, currency: REPORTING_CURRENCY },
      kpis,
      trend,
      decision,
    });
  }

  // Cached lookups and at most five Groq calls run concurrently, so a cold dashboard is
  // bounded by one provider timeout rather than five sequential timeouts.
  const analyses: CampaignAnalysis[] = await Promise.all(drafts.map(async (draft, index) => ({
    ...draft,
    explanation: await explain({
      entityId: draft.entity.id,
      campaignName: draft.entity.name,
      since,
      until,
      kpis: draft.kpis,
      trend: draft.trend,
      decision: draft.decision,
      allowNetwork: index < 5,
    }),
  })));

  const latestInsightDate = insightRows.reduce<string | null>((latest, row) => latest === null || row.date > latest ? row.date : latest, null);
  const insightSync = syncState.find((state) => state.syncKey === "insights");
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const stale = latestInsightDate === null || latestInsightDate < yesterday || Boolean(insightSync?.lastError);
  const notes = [
    "Meta purchases and Meta ROAS are advertising-platform attribution; delivered revenue and net profit come from store COD outcomes.",
    "Campaign-to-order attribution currently uses normalized utm_campaign name matching; ambiguous names remain unattributed.",
  ];
  if (variableExpensesMinor > 0 && attributedOrderValue === 0) notes.push("Variable expenses could not be allocated because no store order matched a campaign.");

  return {
    period: { since, until, timezone: REPORTING_TIMEZONE, currency: REPORTING_CURRENCY },
    generatedAt: new Date().toISOString(),
    dataFreshness: {
      latestInsightDate,
      latestSuccessfulSyncAt: insightSync?.lastSuccessAt ?? null,
      stale,
      note: latestInsightDate === null ? "No campaign insights have been synced for this period." : stale ? "Meta insights may be stale or the last sync failed." : "Meta campaign insights are current.",
    },
    thresholds,
    analyses,
    unattributedOrders,
    notes,
  };
}
