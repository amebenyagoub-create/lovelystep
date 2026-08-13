import type { CampaignDecision, CampaignKpis, CampaignThresholds, CampaignTrend, DecisionConfidence } from "./types";

const money = (minor: number | null) => minor === null ? "unavailable" : `${Math.round(minor / 100).toLocaleString("en-US")} DZD`;
const atLeast = (value: number | null, threshold: number) => value !== null && value >= threshold;
const below = (value: number | null, threshold: number) => value !== null && value < threshold;

function confidence(kpis: CampaignKpis, thresholds: CampaignThresholds): DecisionConfidence {
  if (!kpis.completeness.complete) return "low";
  if (kpis.cod.delivered >= thresholds.minimumDeliveredOrdersForHighConfidence && kpis.cod.deliveryOutcomes >= thresholds.minimumResolvedOrdersForDecision) return "high";
  if (kpis.funnel.storeOrders >= thresholds.minimumOrdersForDecision || kpis.advertising.purchases >= thresholds.minimumOrdersForDecision) return "medium";
  return "low";
}

/**
 * Deterministic decision authority. AI output is deliberately absent from this signature,
 * making it impossible for the explanation layer to override the business result.
 */
export function decideCampaign(kpis: CampaignKpis, trend: CampaignTrend, thresholds: CampaignThresholds): CampaignDecision {
  const resultConfidence = confidence(kpis, thresholds);
  const targetOrderCpa = kpis.economics.targetOrderCpaMinor;
  const targetDeliveredCpa = kpis.economics.targetDeliveredCpaMinor;
  const selectedCpa = kpis.economics.selectedCpaMinor;
  const spend = kpis.advertising.spendMinor;
  const resolved = kpis.cod.confirmationOutcomes + kpis.cod.deliveryOutcomes;
  const enoughOrders = Math.max(kpis.funnel.storeOrders, kpis.advertising.purchases) >= thresholds.minimumOrdersForDecision;
  const enoughOutcomes = resolved >= thresholds.minimumResolvedOrdersForDecision;
  const enoughSpend = spend !== null && targetOrderCpa !== null && spend >= targetOrderCpa * thresholds.minimumSpendToTargetCpaRatio;
  const evidence = [
    `Spend: ${money(spend)}.`,
    `Selected delivered CPA: ${money(selectedCpa)}; target: ${money(targetDeliveredCpa)}.`,
    `Net profit (${kpis.mode}): ${money(kpis.economics.selectedNetProfitMinor)}.`,
    `Confirmation ${kpis.cod.confirmationRatePercent ?? "—"}% · delivery ${kpis.cod.deliveryRatePercent ?? "—"}%.`,
  ];

  if (!kpis.completeness.spendConverted) {
    return { status: "WATCH", confidence: "low", reasonCode: "MISSING_SPEND_FX", evidence, recommendation: "Add the missing dated FX rate before changing campaign budget." };
  }
  if (targetOrderCpa === null || targetDeliveredCpa === null) {
    return { status: "WATCH", confidence: "low", reasonCode: "MISSING_UNIT_ECONOMICS", evidence, recommendation: "Complete product and delivery costs so the engine can calculate a safe target CPA." };
  }

  const maxSpendWithoutPurchase = targetOrderCpa * thresholds.maxSpendWithoutPurchaseMultiplier;
  if (kpis.advertising.purchases === 0 && kpis.funnel.storeOrders === 0 && spend !== null && spend >= maxSpendWithoutPurchase) {
    return {
      status: "KILL", confidence: resultConfidence === "low" ? "medium" : resultConfidence, reasonCode: "SPEND_WITHOUT_PURCHASE",
      evidence: [...evidence, `No purchase after the ${money(Math.round(maxSpendWithoutPurchase))} maximum-spend limit.`],
      recommendation: "Pause the campaign and inspect the offer, landing page, tracking, and creative before relaunching.",
    };
  }

  if (enoughSpend && enoughOrders && selectedCpa !== null && selectedCpa >= targetDeliveredCpa * thresholds.killCpaRatio
    && kpis.economics.selectedNetProfitMinor !== null && kpis.economics.selectedNetProfitMinor < 0) {
    return {
      status: "KILL", confidence: resultConfidence, reasonCode: "UNPROFITABLE_ABOVE_CPA_LIMIT", evidence,
      recommendation: "Pause the campaign; its delivered CPA is materially above target and the campaign is losing money.",
    };
  }

  if (enoughOutcomes && below(kpis.cod.deliveryRatePercent, thresholds.minimumDeliveryRatePercent)
    && atLeast(kpis.cod.refusalRatePercent, thresholds.maximumRefusalRatePercent)) {
    return {
      status: kpis.economics.selectedNetProfitMinor !== null && kpis.economics.selectedNetProfitMinor < 0 ? "KILL" : "WATCH",
      confidence: resultConfidence, reasonCode: "COD_QUALITY_FAILURE", evidence,
      recommendation: "Fix lead quality and order confirmation before increasing acquisition spend.",
    };
  }

  if (trend.creativeFatigue.detected) {
    return {
      status: "WATCH", confidence: trend.creativeFatigue.confidence, reasonCode: "CREATIVE_FATIGUE", evidence: [...evidence, ...trend.creativeFatigue.signals],
      recommendation: "Refresh the creative and monitor CTR, frequency, and delivered CPA before scaling.",
    };
  }

  const healthyCod = (kpis.cod.confirmationRatePercent === null || kpis.cod.confirmationRatePercent >= thresholds.minimumConfirmationRatePercent)
    && (kpis.cod.deliveryRatePercent === null || kpis.cod.deliveryRatePercent >= thresholds.minimumDeliveryRatePercent)
    && (kpis.cod.refusalRatePercent === null || kpis.cod.refusalRatePercent <= thresholds.maximumRefusalRatePercent);
  const targetProfitReached = kpis.economics.profitPerDeliveredOrderMinor !== null
    && kpis.economics.profitPerDeliveredOrderMinor >= thresholds.targetNetProfitPerDeliveredOrderMinor;
  const scaleEfficient = selectedCpa !== null && selectedCpa <= targetDeliveredCpa * thresholds.scaleCpaRatio;

  if (resultConfidence !== "low" && enoughOrders && healthyCod && targetProfitReached && scaleEfficient && trend.direction !== "declining") {
    return {
      status: "SCALE", confidence: resultConfidence, reasonCode: "PROFITABLE_BELOW_TARGET_CPA", evidence,
      recommendation: "Increase budget gradually, then re-evaluate after the next meaningful delivery cohort.",
    };
  }

  const profitable = kpis.economics.selectedNetProfitMinor !== null && kpis.economics.selectedNetProfitMinor >= 0;
  const acceptableCpa = selectedCpa !== null && selectedCpa <= targetDeliveredCpa * thresholds.killCpaRatio;
  if (enoughOrders && profitable && acceptableCpa && healthyCod && trend.direction !== "declining") {
    return {
      status: "KEEP", confidence: resultConfidence, reasonCode: "PROFITABLE_WITHIN_GUARDRAILS", evidence,
      recommendation: "Keep the current budget and continue collecting delivery outcomes.",
    };
  }

  return {
    status: "WATCH", confidence: resultConfidence, reasonCode: !enoughOrders || !enoughSpend ? "INSUFFICIENT_DATA" : trend.direction === "declining" ? "DECLINING_PERFORMANCE" : "OUTSIDE_GUARDRAILS",
    evidence,
    recommendation: !enoughOrders || !enoughSpend ? "Keep the budget controlled until there is enough spend and outcome data for a reliable decision." : "Investigate the weakest funnel or COD signal before changing budget.",
  };
}
