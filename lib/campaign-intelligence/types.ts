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
    /** Part des commandes expediees qui ne sont pas arrivees (refus + retour confondus, ZR ne les separe pas). */
    failedDeliveryRatePercent: number | null;
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

/**
 * Delivery metrics for one ad set or ad.
 *
 * Rates are recomputed from the summed totals of the window, never averaged from Meta's daily
 * rate columns: the mean of seven daily CPMs is not the CPM of the week.
 *
 * There is deliberately no COD, economics or decision field here. Orders are matched to
 * campaigns by utm_campaign, so nothing below a campaign has outcomes to report yet, and an
 * invented per-ad profit would be worse than an absent one.
 */
export type BreakdownMetrics = {
  spendMinor: number | null;
  /** false when a day in the window had no FX rate, so the spend total is incomplete. */
  spendConverted: boolean;
  impressions: number;
  /** Sum of daily reach, not deduplicated reach for the window. */
  reachDailySum: number;
  frequency: number | null;
  clicks: number;
  linkClicks: number;
  /** All clicks / impressions — what Meta's app labels simply "CTR". */
  ctrPercent: number | null;
  /** Link clicks / impressions — the stricter figure, always the lower of the two. */
  linkCtrPercent: number | null;
  cpmMinor: number | null;
  cpcMinor: number | null;
  landingPageViews: number;
  addsToCart: number;
  checkouts: number;
  purchases: number;
};

export type CampaignBreakdownNode = {
  level: "adset" | "ad";
  id: string;
  name: string;
  status: string | null;
  metrics: BreakdownMetrics;
  children: CampaignBreakdownNode[];
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
  /** Ad sets, each with its ads. Delivery metrics only — see BreakdownMetrics. */
  breakdown: CampaignBreakdownNode[];
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
  /**
   * Pourquoi ces commandes ne sont rattachees a aucune campagne.
   *
   * Un nombre seul melangeait deux situations opposees : la vente manuelle ou organique,
   * qu’il FAUT exclure sous peine de crediter la publicite d’une vente qu’elle n’a pas
   * amenee, et la commande publicitaire dont le nom de campagne ne retombe pas, qui elle
   * fausse le CPA a la hausse. Les deux demandent des actions opposees.
   */
  unattributedBreakdown: {
    /** Aucune attribution : vente manuelle, trafic direct, ou consentement refuse. Exclusion correcte. */
    noCampaign: number;
    /** utm_campaign present mais aucune campagne Meta de ce nom. Commande publicitaire perdue. */
    unknownCampaign: number;
    /** utm_campaign correspondant a plusieurs campagnes Meta homonymes. Renommez-les. */
    ambiguousCampaign: number;
    /** Noms rencontres sans correspondance, pour pouvoir les corriger dans Ads Manager. */
    unmatchedNames: string[];
  };
  notes: string[];
};
