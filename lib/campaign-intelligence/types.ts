export type CampaignDecisionStatus = "SCALE" | "KEEP" | "WATCH" | "KILL";
export type DecisionConfidence = "low" | "medium" | "high";
export type TrendDirection = "improving" | "stable" | "declining" | "insufficient_data";

export type CampaignThresholds = {
  targetNetProfitPerDeliveredOrderMinor: number;
  minimumConfirmationRatePercent: number;
  minimumDeliveryRatePercent: number;
  maximumRefusalRatePercent: number;
  minimumOrdersForDecision: number;
  minimumResolvedOrdersForDecision: number;
  minimumDeliveredOrdersForHighConfidence: number;
  minimumSpendToTargetCpaRatio: number;
  maxSpendWithoutPurchaseMultiplier: number;
  scaleCpaRatio: number;
  killCpaRatio: number;
  maxHealthyFrequency: number;
  fatigueFrequencyIncreasePercent: number;
  fatigueCtrDeclinePercent: number;
  fatigueCpaIncreasePercent: number;
  trendMaterialityPercent: number;
};

export type CampaignDailyMetric = {
  date: string;
  spendMinor: number | null;
  purchaseValueMinor: number | null;
  impressions: number;
  reach: number;
  clicks: number;
  linkClicks: number;
  landingPageViews: number;
  addsToCart: number;
  checkouts: number;
  purchases: number;
};

export type CampaignKpis = {
  mode: "actual" | "estimated";
  advertising: {
    spendMinor: number | null;
    impressions: number;
    reach: number;
    frequency: number | null;
    clicks: number;
    linkClicks: number;
    cpcMinor: number | null;
    cpmMinor: number | null;
    ctrPercent: number | null;
    landingPageViews: number;
    addsToCart: number;
    checkouts: number;
    purchases: number;
    conversionRatePercent: number | null;
    metaCpaMinor: number | null;
    metaRoas: number | null;
    storeAttributedRoas: number | null;
  };
  funnel: {
    visitors: number;
    visitorsSource: "landing_page_views" | "link_clicks";
    addsToCart: number;
    checkouts: number;
    metaPurchases: number;
    storeOrders: number;
    confirmedOrders: number;
    deliveredOrders: number;
  };
  cod: {
    placed: number;
    confirmationOutcomes: number;
    confirmed: number;
    shipped: number;
    deliveryOutcomes: number;
    delivered: number;
    refused: number;
    returned: number;
    cancelled: number;
    pending: number;
    confirmationRatePercent: number | null;
    deliveryRatePercent: number | null;
    refusalRatePercent: number | null;
    returnRatePercent: number | null;
    historicalConfirmationRatePercent: number;
    historicalDeliveryRatePercent: number;
    expectedDeliveredOrders: number;
  };
  economics: {
    deliveredRevenueMinor: number;
    cogsMinor: number;
    deliveryCostsMinor: number;
    returnCostsMinor: number;
    refundsMinor: number;
    allocatedVariableCostsMinor: number;
    contributionBeforeAdsMinor: number | null;
    actualNetProfitMinor: number | null;
    expectedNetProfitMinor: number | null;
    selectedNetProfitMinor: number | null;
    profitPerDeliveredOrderMinor: number | null;
    confirmedCpaMinor: number | null;
    deliveredCpaMinor: number | null;
    expectedDeliveredCpaMinor: number | null;
    selectedCpaMinor: number | null;
    breakEvenDeliveredCpaMinor: number | null;
    targetDeliveredCpaMinor: number | null;
    targetOrderCpaMinor: number | null;
    breakEvenRoas: number | null;
    targetRoas: number | null;
  };
  completeness: {
    complete: boolean;
    attributionMethod: "utm_campaign_name";
    ordersMissingCogs: number;
    ordersMissingDeliveryCost: number;
    spendConverted: boolean;
    notes: string[];
  };
};

export type CampaignTrend = {
  direction: TrendDirection;
  summary: string;
  previousWindow: { since: string; until: string } | null;
  currentWindow: { since: string; until: string } | null;
  changesPercent: {
    ctr: number | null;
    cpc: number | null;
    cpa: number | null;
    frequency: number | null;
    confirmationRate: number | null;
    deliveryRate: number | null;
    profit: number | null;
  };
  creativeFatigue: {
    detected: boolean;
    confidence: DecisionConfidence;
    signals: string[];
  };
};

export type CampaignDecision = {
  status: CampaignDecisionStatus;
  confidence: DecisionConfidence;
  reasonCode: string;
  evidence: string[];
  recommendation: string;
};

export type CampaignAiExplanation = {
  source: "groq" | "deterministic_fallback";
  model: string | null;
  headline: string;
  explanation: string;
  diagnostics: string[];
  nextAction: string;
  generatedAt: string;
  cached: boolean;
};

export type CampaignAnalysis = {
  entity: {
    level: "campaign";
    id: string;
    name: string;
    status: string | null;
    objective: string | null;
    currency: string;
  };
  period: { since: string; until: string; timezone: "Africa/Algiers"; currency: "DZD" };
  kpis: CampaignKpis;
  trend: CampaignTrend;
  decision: CampaignDecision;
  explanation: CampaignAiExplanation;
};

export type CampaignIntelligenceResponse = {
  period: { since: string; until: string; timezone: "Africa/Algiers"; currency: "DZD" };
  generatedAt: string;
  dataFreshness: {
    latestInsightDate: string | null;
    latestSuccessfulSyncAt: string | null;
    stale: boolean;
    note: string;
  };
  thresholds: CampaignThresholds;
  analyses: CampaignAnalysis[];
  unattributedOrders: number;
  notes: string[];
};
