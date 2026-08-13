import type { CampaignKpis, CampaignThresholds, CampaignTrend, TrendDirection } from "./types";

function changePercent(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || !Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1_000) / 10;
}

export function emptyCampaignTrend(): CampaignTrend {
  return {
    direction: "insufficient_data",
    summary: "Not enough comparable history for a reliable trend.",
    previousWindow: null,
    currentWindow: null,
    changesPercent: { ctr: null, cpc: null, cpa: null, frequency: null, confirmationRate: null, deliveryRate: null, profit: null },
    creativeFatigue: { detected: false, confidence: "low", signals: [] },
  };
}

export function analyzeCampaignTrend(input: {
  previous: CampaignKpis | null;
  current: CampaignKpis | null;
  previousWindow: CampaignTrend["previousWindow"];
  currentWindow: CampaignTrend["currentWindow"];
  thresholds: CampaignThresholds;
}): CampaignTrend {
  const { previous, current, thresholds } = input;
  if (!previous || !current || previous.advertising.impressions === 0 || current.advertising.impressions === 0) return emptyCampaignTrend();

  const changes = {
    ctr: changePercent(current.advertising.ctrPercent, previous.advertising.ctrPercent),
    cpc: changePercent(current.advertising.cpcMinor, previous.advertising.cpcMinor),
    cpa: changePercent(current.economics.selectedCpaMinor, previous.economics.selectedCpaMinor),
    frequency: changePercent(current.advertising.frequency, previous.advertising.frequency),
    confirmationRate: changePercent(current.cod.confirmationRatePercent, previous.cod.confirmationRatePercent),
    deliveryRate: changePercent(current.cod.deliveryRatePercent, previous.cod.deliveryRatePercent),
    profit: changePercent(current.economics.selectedNetProfitMinor, previous.economics.selectedNetProfitMinor),
  };

  const fatigueSignals: string[] = [];
  if ((current.advertising.frequency ?? 0) >= thresholds.maxHealthyFrequency) fatigueSignals.push(`Frequency reached ${current.advertising.frequency?.toFixed(2)}.`);
  if ((changes.frequency ?? 0) >= thresholds.fatigueFrequencyIncreasePercent) fatigueSignals.push(`Frequency increased ${changes.frequency}%.`);
  if ((changes.ctr ?? 0) <= -thresholds.fatigueCtrDeclinePercent) fatigueSignals.push(`CTR declined ${Math.abs(changes.ctr ?? 0)}%.`);
  if ((changes.cpa ?? 0) >= thresholds.fatigueCpaIncreasePercent) fatigueSignals.push(`Delivered CPA increased ${changes.cpa}%.`);
  const fatigueDetected = fatigueSignals.length >= 3
    || (fatigueSignals.length >= 2 && (current.advertising.frequency ?? 0) >= thresholds.maxHealthyFrequency);

  let improving = 0;
  let declining = 0;
  const materiality = thresholds.trendMaterialityPercent;
  if ((changes.ctr ?? 0) >= materiality) improving += 1;
  if ((changes.ctr ?? 0) <= -materiality) declining += 1;
  if ((changes.cpc ?? 0) <= -materiality) improving += 1;
  if ((changes.cpc ?? 0) >= materiality) declining += 1;
  if ((changes.cpa ?? 0) <= -materiality) improving += 2;
  if ((changes.cpa ?? 0) >= materiality) declining += 2;
  if ((changes.profit ?? 0) >= materiality) improving += 2;
  if ((changes.profit ?? 0) <= -materiality) declining += 2;
  if ((changes.deliveryRate ?? 0) >= materiality) improving += 1;
  if ((changes.deliveryRate ?? 0) <= -materiality) declining += 1;

  let direction: TrendDirection = "stable";
  if (declining >= improving + 2) direction = "declining";
  if (improving >= declining + 2) direction = "improving";
  const comparableSignals = Object.values(changes).filter((value) => value !== null).length;
  if (comparableSignals < 2) direction = "insufficient_data";

  return {
    direction,
    summary: direction === "improving" ? "Efficiency is improving versus the preceding window."
      : direction === "declining" ? "Efficiency is deteriorating versus the preceding window."
        : direction === "stable" ? "Performance is broadly stable versus the preceding window."
          : "Not enough comparable history for a reliable trend.",
    previousWindow: input.previousWindow,
    currentWindow: input.currentWindow,
    changesPercent: changes,
    creativeFatigue: {
      detected: fatigueDetected,
      confidence: fatigueDetected && fatigueSignals.length >= 3 ? "high" : fatigueSignals.length >= 2 ? "medium" : "low",
      signals: fatigueSignals,
    },
  };
}
