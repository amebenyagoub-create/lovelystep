import type { CampaignAiExplanation, CampaignDecision, CampaignKpis, CampaignTrend } from "./types";

export function deterministicExplanation(decision: CampaignDecision, kpis: CampaignKpis, trend: CampaignTrend, generatedAt = new Date().toISOString()): CampaignAiExplanation {
  const diagnostics = [
    kpis.advertising.ctrPercent === null ? "CTR is unavailable." : `CTR is ${kpis.advertising.ctrPercent}%.`,
    kpis.economics.selectedCpaMinor === null ? "Delivered CPA is unavailable." : `Delivered CPA is ${Math.round(kpis.economics.selectedCpaMinor / 100).toLocaleString("en-US")} DZD.`,
    trend.summary,
  ];
  if (!kpis.completeness.complete) diagnostics.push(...kpis.completeness.notes.slice(0, 2));
  return {
    source: "deterministic_fallback",
    model: null,
    headline: `${decision.status}: ${decision.reasonCode.replaceAll("_", " ").toLowerCase()}`,
    explanation: decision.evidence.slice(0, 3).join(" "),
    diagnostics: diagnostics.slice(0, 5),
    nextAction: decision.recommendation,
    generatedAt,
    cached: false,
  };
}
