import type { Order } from "../types";
import { percent, perUnitMinor, ratio, sum } from "../finance/money";
import type { CampaignDailyMetric, CampaignKpis, CampaignThresholds } from "./types";

export type CampaignKpiInput = {
  daily: CampaignDailyMetric[];
  orders: Order[];
  allocatedVariableCostsMinor: number;
  historicalConfirmationRatePercent: number;
  historicalDeliveryRatePercent: number;
  /** Vrai quand les deux taux ci-dessus sont la valeur de repli et non une mesure. */
  ratesAreAssumed?: boolean;
  /** Global delivered-order economics used only when this campaign has no resolved deliveries yet. */
  baselineContributionPerDeliveredOrderMinor?: number | null;
  baselineAverageOrderRevenueMinor?: number | null;
  thresholds: CampaignThresholds;
};

const safeRate = (value: number, fallback: number) => Number.isFinite(value) && value >= 0 && value <= 100 ? value : fallback;

/**
 * Commandes arretees qui ne se resoudront pas toutes seules.
 *
 * Le statut a neuf valeurs les deguise en pipeline vivant : l'agent ecrit ZR_ERROR quand la
 * creation du colis a echoue, NO_REPLY quand les relances sont epuisees, STALLED quand ZR n'a
 * plus rien dit depuis 72 h, HUMAN quand la conversation attend un humain. La table de
 * correspondance les range respectivement en « confirmee », « a confirmer » et « expediee »,
 * si bien que le moteur leur accordait la probabilite de livraison d'une commande saine.
 *
 * Consequence mesuree : du chiffre d'affaires prevu qui n'arrivera jamais, un CPA cible trop
 * genereux, et un mode qui reste « estime » indefiniment puisque ces lignes ne se resolvent
 * jamais. Elles sortent donc des previsions ET des denominateurs de taux — elles ne sont ni
 * un succes ni un echec de livraison, elles attendent une intervention.
 */
const BLOCKED_SHEET_STATES = new Set(["ZR_ERROR", "NO_REPLY", "STALLED", "HUMAN", "NEEDS_REVIEW"]);
const isBlocked = (order: Order) => BLOCKED_SHEET_STATES.has(String(order.sheetState ?? "").trim().toUpperCase());
const was = (order: Order, status: Order["status"]) => order.status === status || order.statusHistory.some((entry) => entry.status === status);
const resolvedConfirmation = (order: Order) => was(order, "confirmed") || order.status === "refused" || order.status === "cancelled";
const wasShipped = (order: Order) => was(order, "shipped");
const deliveryOutcome = (order: Order) => order.status === "delivered" || order.status === "returned" || (order.status === "refused" && wasShipped(order));
const pendingOrder = (order: Order) => !["delivered", "returned", "refused", "cancelled"].includes(order.status) && !isBlocked(order);

function orderCogs(order: Order): number | null {
  let value = 0;
  for (const item of order.items) {
    if (item.unitCostCents == null) return null;
    value += item.unitCostCents * item.quantity;
  }
  return value;
}

function roundExpected(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Pure campaign KPI engine. It never reads environment, database state or AI output. */
export function computeCampaignKpis(input: CampaignKpiInput): CampaignKpis {
  const { daily, orders, allocatedVariableCostsMinor, thresholds } = input;
  const spendMissing = daily.some((row) => row.spendMinor === null);
  const valueMissing = daily.some((row) => row.purchaseValueMinor === null);
  const spendMinor = spendMissing ? null : sum(daily.map((row) => row.spendMinor ?? 0));
  const purchaseValueMinor = valueMissing ? null : sum(daily.map((row) => row.purchaseValueMinor ?? 0));
  const impressions = sum(daily.map((row) => row.impressions));
  const reach = sum(daily.map((row) => row.reach));
  const clicks = sum(daily.map((row) => row.clicks));
  const linkClicks = sum(daily.map((row) => row.linkClicks));
  const landingPageViews = sum(daily.map((row) => row.landingPageViews));
  const addsToCart = sum(daily.map((row) => row.addsToCart));
  const checkouts = sum(daily.map((row) => row.checkouts));
  const purchases = sum(daily.map((row) => row.purchases));
  const visitors = landingPageViews > 0 ? landingPageViews : linkClicks;

  const confirmedOrders = orders.filter((order) => was(order, "confirmed"));
  const shippedOrders = orders.filter(wasShipped);
  const deliveredOrders = orders.filter((order) => order.status === "delivered");
  const confirmationOutcomes = orders.filter(resolvedConfirmation).length;
  const deliveryOutcomes = orders.filter(deliveryOutcome).length;
  const refused = orders.filter((order) => order.status === "refused").length;
  const returned = orders.filter((order) => order.status === "returned").length;
  const cancelled = orders.filter((order) => order.status === "cancelled").length;
  const pending = orders.filter(pendingOrder).length;

  const historicalConfirmationRatePercent = safeRate(input.historicalConfirmationRatePercent, 70);
  const historicalDeliveryRatePercent = safeRate(input.historicalDeliveryRatePercent, 70);
  const confirmationProbability = historicalConfirmationRatePercent / 100;
  const deliveryProbability = historicalDeliveryRatePercent / 100;

  const blocked = orders.filter(isBlocked).length;
  const expectedDeliveredOrders = roundExpected(sum(orders.map((order) => {
    if (order.status === "delivered") return 1;
    if (["returned", "refused", "cancelled"].includes(order.status)) return 0;
    // Bloquee : rien ne bouge tant qu'un humain n'intervient pas, on ne prevoit pas de livraison.
    if (isBlocked(order)) return 0;
    if (was(order, "confirmed")) return deliveryProbability;
    return confirmationProbability * deliveryProbability;
  })));

  const cogsValues = deliveredOrders.map(orderCogs);
  const ordersMissingCogs = orders.filter((order) => pendingOrder(order) || order.status === "delivered").filter((order) => orderCogs(order) === null).length;
  const ordersMissingDeliveryCost = orders.filter((order) => (order.status === "delivered" || order.status === "returned" || wasShipped(order)) && !order.deliveryCost).length;
  const refundsMinor = sum(deliveredOrders.flatMap((order) => order.refunds.map((refund) => refund.amountCents)));
  const deliveredRevenueMinor = sum(deliveredOrders.map((order) => order.subtotalCents + order.shippingCents)) - refundsMinor;
  const cogsMinor = sum(cogsValues.map((value) => value ?? 0));
  const deliveryCostsMinor = sum(orders.map((order) => order.deliveryCost?.carrierCostCents ?? 0));
  const returnCostsMinor = sum(orders.map((order) => order.deliveryCost?.returnCostCents ?? 0));
  const costDataComplete = ordersMissingCogs === 0 && ordersMissingDeliveryCost === 0;
  const contributionBeforeAdsPartial = deliveredRevenueMinor - cogsMinor - deliveryCostsMinor - returnCostsMinor - allocatedVariableCostsMinor;
  const contributionBeforeAdsMinor = costDataComplete ? contributionBeforeAdsPartial : null;
  const actualNetProfitMinor = contributionBeforeAdsMinor === null || spendMinor === null ? null : contributionBeforeAdsMinor - spendMinor;

  const knownCarrierCosts = orders.flatMap((order) => order.deliveryCost ? [order.deliveryCost.carrierCostCents] : []);
  /**
   * What the carrier costs on an order that has no recorded cost yet.
   *
   * The delivery fee is passed straight to ZR, so an order owes exactly the fee it charged.
   * This previously fell back to the average of known carrier costs — which is 0 before any
   * order ships — and `subtotal + shipping - cogs - 0` turned the pass-through fee into profit.
   * On a 2,750 DZD margin with an ~875 DZD fee that inflated break-even to ~3,625 and handed
   * back a target CPA 70% too generous, which is the direction that loses money quietly.
   *
   * Same rule as syncOrderDeliveryCost in lib/db-postgres.ts: fee in, fee out, margin remains.
   *
   * A recorded 0 is treated as "not billed yet", not "free": syncOrderDeliveryCost legitimately
   * writes 0 for an order that has not shipped, and every use of this value below is a forward
   * projection of what a DELIVERED order will cost. Reading that 0 literally would put the fee
   * back into profit the moment the costs table was populated. A refused or returned parcel is
   * handled separately above, where the send leg genuinely is not charged.
   */
  const carrierCostOf = (order: Order): number => {
    const recorded = order.deliveryCost?.carrierCostCents;
    return recorded != null && recorded > 0 ? recorded : order.shippingCents;
  };
  let expectedContribution = -allocatedVariableCostsMinor;
  for (const order of orders) {
    const cogs = orderCogs(order);
    if (order.status === "delivered") {
      expectedContribution += order.subtotalCents + order.shippingCents - sum(order.refunds.map((refund) => refund.amountCents)) - (cogs ?? 0)
        - carrierCostOf(order) - (order.deliveryCost?.returnCostCents ?? 0);
      continue;
    }
    if (["returned", "refused", "cancelled"].includes(order.status)) {
      expectedContribution -= (order.deliveryCost?.carrierCostCents ?? 0) + (order.deliveryCost?.returnCostCents ?? 0);
      continue;
    }
    // Une commande bloquee n'apporte ni revenu ni cout tant qu'elle n'est pas debloquee.
    if (isBlocked(order)) continue;
    const outcomeProbability = was(order, "confirmed") ? deliveryProbability : confirmationProbability * deliveryProbability;
    expectedContribution += outcomeProbability * (order.subtotalCents + order.shippingCents - (cogs ?? 0) - carrierCostOf(order));
  }
  const expectedNetProfitMinor = costDataComplete && spendMinor !== null ? Math.round(expectedContribution - spendMinor) : null;
  const outcomesIncomplete = pending > 0 || deliveryOutcomes < confirmedOrders.filter((order) => !isBlocked(order)).length;
  const mode: CampaignKpis["mode"] = outcomesIncomplete ? "estimated" : "actual";
  const selectedNetProfitMinor = mode === "estimated" ? expectedNetProfitMinor : actualNetProfitMinor;

  /**
   * Marge d'UNE commande livree — la base du CPA maximal soutenable.
   *
   * Elle valait auparavant contributionBeforeAds / nombre de livraisons. Or ce numerateur
   * melange deux perimetres : le chiffre d'affaires et le cout d'achat ne comptent que les
   * commandes LIVREES, tandis que les frais de transport et de retour sont additionnes sur
   * TOUTES les commandes de la periode. On soustrayait donc les frais de quinze colis d'un
   * chiffre d'affaires de deux, puis on divisait par deux. Le resultat devenait nul ou negatif
   * des la premiere livraison, Math.max(0, ...) le ramenait a zero, et le CPA cible affiche
   * tombait a 0 DZD — un objectif qu'aucune campagne ne peut atteindre.
   *
   * Le double comptage est reel : les echecs sont deja pris en compte une fois, par le taux de
   * livraison qui multiplie ce montant plus bas. Les compter aussi ici les facturait deux fois.
   *
   * On mesure donc ce qu'une livraison reussie rapporte vraiment : son prix, moins son cout
   * d'achat, moins le transport qu'elle a paye. Le P&L reel de la periode, lui, garde bien tous
   * les frais engages — c'est un autre nombre, et il reste juste.
   */
  const deliveredCogsComplete = cogsValues.every((value) => value !== null);
  const contributionPerDelivered = !deliveredOrders.length || !deliveredCogsComplete ? null : Math.round(sum(deliveredOrders.map((order) =>
    order.subtotalCents + order.shippingCents
    - sum(order.refunds.map((refund) => refund.amountCents))
    - (orderCogs(order) ?? 0)
    - carrierCostOf(order))) / deliveredOrders.length);
  const fallbackContributionPerOrder = (() => {
    const completeOrders = orders.filter((order) => orderCogs(order) !== null);
    if (!completeOrders.length) return null;
    return Math.round(sum(completeOrders.map((order) => order.subtotalCents + order.shippingCents - (orderCogs(order) ?? 0) - carrierCostOf(order))) / completeOrders.length);
  })();
  const breakEvenDeliveredCpaMinor = contributionPerDelivered ?? fallbackContributionPerOrder ?? input.baselineContributionPerDeliveredOrderMinor ?? null;
  const targetDeliveredCpaMinor = breakEvenDeliveredCpaMinor === null ? null : Math.max(0, breakEvenDeliveredCpaMinor - thresholds.targetNetProfitPerDeliveredOrderMinor);
  const targetOrderCpaMinor = targetDeliveredCpaMinor === null ? null : Math.round(targetDeliveredCpaMinor * confirmationProbability * deliveryProbability);
  const deliveredCpaMinor = spendMinor === null ? null : perUnitMinor(spendMinor, deliveredOrders.length);
  const expectedDeliveredCpaMinor = spendMinor === null || expectedDeliveredOrders <= 0 ? null : Math.round(spendMinor / expectedDeliveredOrders);
  const selectedCpaMinor = mode === "estimated" ? expectedDeliveredCpaMinor : deliveredCpaMinor;
  const averageDeliveredRevenue = perUnitMinor(deliveredRevenueMinor, deliveredOrders.length)
    ?? (orders.length ? Math.round(sum(orders.map((order) => order.totalCents)) / orders.length) : null)
    ?? input.baselineAverageOrderRevenueMinor ?? null;

  const notes: string[] = [];
  if (spendMissing) notes.push("At least one daily FX rate is missing; spend and profitability are unavailable.");
  if (ordersMissingCogs) notes.push(`${ordersMissingCogs} campaign order(s) are missing product-cost snapshots.`);
  if (ordersMissingDeliveryCost) notes.push(`${ordersMissingDeliveryCost} fulfilled order(s) are missing actual delivery costs.`);
  if (outcomesIncomplete) notes.push("Delivery outcomes are incomplete; expected profit uses historical confirmation and delivery probabilities.");
  if (targetDeliveredCpaMinor === 0 && breakEvenDeliveredCpaMinor !== null) {
    notes.push(`CPA cible a 0 : le profit exige par commande livree (${Math.round(thresholds.targetNetProfitPerDeliveredOrderMinor / 100)} DZD) depasse la marge disponible (${Math.round(breakEvenDeliveredCpaMinor / 100)} DZD). Aucune campagne ne peut atteindre cet objectif — baissez l'exigence de profit ou verifiez les couts produit.`);
  }
  if (input.ratesAreAssumed) notes.push(`Aucune commande resolue : les taux de confirmation (${Math.round(historicalConfirmationRatePercent)}%) et de livraison (${Math.round(historicalDeliveryRatePercent)}%) sont une HYPOTHESE, pas une mesure. Le CPA cible et le verdict en dependent entierement.`);
  if (!knownCarrierCosts.length && pending > 0) notes.push("No campaign carrier-cost history is available for pending-order estimates.");
  if (blocked) notes.push(`${blocked} commande(s) bloquee(s) (ZR_ERROR, NO_REPLY, STALLED, HUMAN) : exclues des previsions, elles attendent une intervention.`);
  if (orders.length) notes.push("Store orders are matched to Meta campaigns by normalized utm_campaign name.");

  return {
    mode,
    advertising: {
      spendMinor,
      impressions,
      reach,
      frequency: ratio(impressions, reach),
      clicks,
      linkClicks,
      cpcMinor: spendMinor === null ? null : perUnitMinor(spendMinor, linkClicks || clicks),
      cpmMinor: spendMinor === null || impressions === 0 ? null : Math.round((spendMinor / impressions) * 1_000),
      ctrPercent: percent(linkClicks || clicks, impressions),
      landingPageViews,
      addsToCart,
      checkouts,
      purchases,
      conversionRatePercent: percent(purchases, visitors),
      metaCpaMinor: spendMinor === null ? null : perUnitMinor(spendMinor, purchases),
      metaRoas: spendMinor === null || purchaseValueMinor === null ? null : ratio(purchaseValueMinor, spendMinor),
      storeAttributedRoas: spendMinor === null ? null : ratio(deliveredRevenueMinor, spendMinor),
    },
    funnel: {
      visitors,
      visitorsSource: landingPageViews > 0 ? "landing_page_views" : "link_clicks",
      addsToCart,
      checkouts,
      metaPurchases: purchases,
      storeOrders: orders.length,
      confirmedOrders: confirmedOrders.length,
      deliveredOrders: deliveredOrders.length,
    },
    cod: {
      placed: orders.length,
      confirmationOutcomes,
      confirmed: confirmedOrders.length,
      shipped: shippedOrders.length,
      deliveryOutcomes,
      delivered: deliveredOrders.length,
      refused,
      returned,
      cancelled,
      pending,
      confirmationRatePercent: percent(confirmedOrders.length, confirmationOutcomes),
      deliveryRatePercent: percent(deliveredOrders.length, deliveryOutcomes),
      refusalRatePercent: percent(refused, confirmationOutcomes),
      // Taux d’echec de livraison reel : ZR ne distingue pas le refus a la porte du retour
      // pour adresse invalide, les deux arrivent en RETURNED. `refusalRatePercent` reste
      // donc a zero et ne peut rien declencher ; celui-ci mesure ce qui est reellement
      // observable, et coute la meme chose : la commande confirmee qui n’a pas ete livree.
      failedDeliveryRatePercent: percent(refused + returned, deliveryOutcomes),
      returnRatePercent: percent(returned, deliveryOutcomes),
      historicalConfirmationRatePercent,
      historicalDeliveryRatePercent,
      expectedDeliveredOrders,
    },
    economics: {
      deliveredRevenueMinor,
      cogsMinor,
      deliveryCostsMinor,
      returnCostsMinor,
      refundsMinor,
      allocatedVariableCostsMinor,
      contributionBeforeAdsMinor,
      actualNetProfitMinor,
      expectedNetProfitMinor,
      selectedNetProfitMinor,
      profitPerDeliveredOrderMinor: selectedNetProfitMinor === null ? null : perUnitMinor(selectedNetProfitMinor, mode === "estimated" ? Math.max(expectedDeliveredOrders, 0) : deliveredOrders.length),
      confirmedCpaMinor: spendMinor === null ? null : perUnitMinor(spendMinor, confirmedOrders.length),
      deliveredCpaMinor,
      expectedDeliveredCpaMinor,
      selectedCpaMinor,
      breakEvenDeliveredCpaMinor,
      targetDeliveredCpaMinor,
      targetOrderCpaMinor,
      breakEvenRoas: averageDeliveredRevenue === null || breakEvenDeliveredCpaMinor === null || breakEvenDeliveredCpaMinor <= 0 ? null : ratio(averageDeliveredRevenue, breakEvenDeliveredCpaMinor),
      targetRoas: averageDeliveredRevenue === null || targetDeliveredCpaMinor === null || targetDeliveredCpaMinor <= 0 ? null : ratio(averageDeliveredRevenue, targetDeliveredCpaMinor),
    },
    completeness: {
      complete: costDataComplete && !spendMissing,
      attributionMethod: "utm_campaign_name",
      ordersMissingCogs,
      ordersMissingDeliveryCost,
      spendConverted: !spendMissing,
      notes,
    },
  };
}
