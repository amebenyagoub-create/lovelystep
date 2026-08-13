import type { CampaignThresholds } from "./types";

/**
 * One source of truth for every business rule used by the decision engine.
 * Stored overrides are merged and validated server-side before they reach the pure engine.
 */
export const DEFAULT_CAMPAIGN_THRESHOLDS: CampaignThresholds = {
  targetNetProfitPerDeliveredOrderMinor: 150_000,
  minimumConfirmationRatePercent: 65,
  minimumDeliveryRatePercent: 70,
  maximumRefusalRatePercent: 25,
  minimumOrdersForDecision: 3,
  minimumResolvedOrdersForDecision: 5,
  minimumDeliveredOrdersForHighConfidence: 10,
  minimumSpendToTargetCpaRatio: 0.75,
  maxSpendWithoutPurchaseMultiplier: 1.25,
  scaleCpaRatio: 0.8,
  killCpaRatio: 1.3,
  maxHealthyFrequency: 3.5,
  fatigueFrequencyIncreasePercent: 15,
  fatigueCtrDeclinePercent: 20,
  fatigueCpaIncreasePercent: 20,
  trendMaterialityPercent: 10,
};

const ranges: Record<keyof CampaignThresholds, [number, number]> = {
  targetNetProfitPerDeliveredOrderMinor: [0, 100_000_000],
  minimumConfirmationRatePercent: [0, 100],
  minimumDeliveryRatePercent: [0, 100],
  maximumRefusalRatePercent: [0, 100],
  minimumOrdersForDecision: [1, 10_000],
  minimumResolvedOrdersForDecision: [1, 10_000],
  minimumDeliveredOrdersForHighConfidence: [1, 10_000],
  minimumSpendToTargetCpaRatio: [0.05, 10],
  maxSpendWithoutPurchaseMultiplier: [0.1, 20],
  scaleCpaRatio: [0.05, 2],
  killCpaRatio: [0.1, 10],
  maxHealthyFrequency: [0.1, 100],
  fatigueFrequencyIncreasePercent: [0, 1_000],
  fatigueCtrDeclinePercent: [0, 100],
  fatigueCpaIncreasePercent: [0, 1_000],
  trendMaterialityPercent: [0, 1_000],
};

export function campaignThresholds(value: unknown): CampaignThresholds {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_CAMPAIGN_THRESHOLDS };
  const raw = value as Record<string, unknown>;
  const merged = { ...DEFAULT_CAMPAIGN_THRESHOLDS };
  for (const key of Object.keys(merged) as Array<keyof CampaignThresholds>) {
    const candidate = Number(raw[key]);
    const [minimum, maximum] = ranges[key];
    if (Number.isFinite(candidate) && candidate >= minimum && candidate <= maximum) merged[key] = candidate;
  }
  return merged;
}
