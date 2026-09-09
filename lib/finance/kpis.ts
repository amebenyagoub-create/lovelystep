// Deliberately NOT "server-only": this module is pure computation over data passed in by the
// caller. It reads no database, no environment and no secrets, so it stays directly testable.
import type { Expense, Order, OrderStatus } from "../types";
import { median, percent, perUnitMinor, ratio, sum } from "./money";

/**
 * KPI engine.
 *
 * Rules that apply throughout:
 * - Recognised revenue follows the approved COD rule: only DELIVERED orders count.
 *   Meta's Purchase conversion (fired at order placement) is deliberately a different number.
 * - Every division goes through ratio()/percent()/perUnitMinor(), which return null rather
 *   than Infinity, NaN or a misleading zero.
 * - Missing cost data is never silently treated as zero. It is counted and surfaced through
 *   the completeness report so a profit figure is never quietly wrong.
 * - Money is integer minor units (DZD centimes) end to end.
 */

export const REPORTING_TIMEZONE = "Africa/Algiers";
export const REPORTING_CURRENCY = "DZD";

/** Statuses whose revenue is financially recognised. */
const RECOGNISED: OrderStatus[] = ["delivered"];
/** Statuses that mean the order was cancelled before or during fulfilment. */
const CANCELLED: OrderStatus[] = ["cancelled", "refused"];

export type PeriodInput = {
  orders: Order[];
  expenses: Expense[];
  /** Ad spend already converted to DZD minor units, or null when a rate was missing. */
  adSpendMinor: number | null;
  /** Dates the period covers, used for expense proration. */
  since: string;
  until: string;
};

export type CompletenessReport = {
  ordersMissingCogs: number;
  /**
   * Commandes revenues sans frais de retour enregistres.
   *
   * Ce reproche portait avant sur les commandes LIVREES sans cout de livraison. Il n'a plus
   * de sens : une livraison reussie ne coute rien a la boutique, c'est le client qui l'a
   * payee au livreur. Le seul cout de transport qui manque vraiment est celui d'un retour.
   */
  failedDeliveriesMissingReturnCost: number;
  adSpendConverted: boolean;
  /** True only when every input needed for net profit was present. */
  complete: boolean;
  notes: string[];
};

const isRecognised = (order: Order) => RECOGNISED.includes(order.status);

/** COGS from the per-order snapshot. Returns null when any line lacks a cost. */
function orderCogsMinor(order: Order): number | null {
  let total = 0;
  for (const item of order.items) {
    if (item.unitCostCents == null) return null;
    total += item.unitCostCents * item.quantity;
  }
  return total;
}

const orderRefundsMinor = (order: Order) => sum(order.refunds.map((refund) => refund.amountCents));

/**
 * Ce qu'une commande rapporte REELLEMENT a la boutique.
 *
 * Le livreur encaisse le total chez le client, garde les frais de livraison pour ZR et ne
 * credite le compte de la boutique que du prix des articles. Les frais de livraison ne sont
 * donc ni un revenu ni un cout : ils ne passent jamais par la boutique.
 *
 * Toute formule de revenu ou de marge doit partir d'ici. Additionner la livraison puis la
 * re-soustraire plus loin donne le meme resultat final, mais fausse tout ratio dont elle
 * devient le denominateur -- panier moyen, marge, ROAS de rentabilite.
 */
export const orderStoreRevenueMinor = (order: Order) => order.subtotalCents - orderRefundsMinor(order);
/**
 * Ce qu'une commande coute reellement en transport a la boutique : ses frais de RETOUR.
 *
 * L'aller n'y figure pas. Le client l'a paye au livreur, qui le remet a ZR : la boutique n'est
 * jamais debitee. Additionner l'aller ici, alors que le revenu ne le contient plus, le
 * facturerait une seconde fois.
 */
const orderReturnFeeMinor = (order: Order) => order.deliveryCost?.returnCostCents ?? 0;

/**
 * Operating expenses attributable to the period.
 * A recurring expense is prorated across the days it overlaps the period; a one-time expense
 * counts in full when its effective date falls inside the period.
 */
export function operatingExpensesMinor(expenses: Expense[], since: string, until: string): number {
  const start = Date.parse(`${since}T00:00:00Z`);
  const end = Date.parse(`${until}T00:00:00Z`);
  let total = 0;
  for (const expense of expenses) {
    const from = Date.parse(expense.effectiveFrom);
    const to = expense.effectiveTo ? Date.parse(expense.effectiveTo) : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(from)) continue;
    if (expense.recurrence === "one_time") {
      if (from >= start && from <= end) total += expense.amountCents;
      continue;
    }
    // Recurring: the stored amount is a monthly figure, prorated by overlapping days.
    const overlapStart = Math.max(from, start);
    const overlapEnd = Math.min(to, end);
    if (overlapEnd < overlapStart) continue;
    const overlapDays = Math.floor((overlapEnd - overlapStart) / 86_400_000) + 1;
    total += Math.round((expense.amountCents / 30) * overlapDays);
  }
  return total;
}

export type RevenueKpis = {
  orderCount: number;
  validOrders: number;
  grossSalesMinor: number;
  /**
   * Frais de livraison encaisses par le livreur POUR ZR. Ce n'est pas un revenu de la
   * boutique : cet argent ne transite jamais par elle. Affiche pour information seulement.
   */
  shippingCollectedForCarrierMinor: number;
  refundsMinor: number;
  netRevenueMinor: number;
  cogsMinor: number;
  grossProfitMinor: number;
  grossMarginPercent: number | null;
  variableCostsMinor: number;
  /** Frais de retour des commandes non livrees : la seule livraison payee par la boutique. */
  failedDeliveryCostMinor: number;
  contributionBeforeAdsMinor: number;
  contributionAfterAdsMinor: number | null;
  operatingExpensesMinor: number;
  netProfitMinor: number | null;
  netMarginPercent: number | null;
  capitalInvestedMinor: number | null;
  roi: number | null;
  aovMinor: number | null;
  profitPerOrderMinor: number | null;
  upsellOrders: number;
  upsellRatePercent: number | null;
  upsellRevenueMinor: number;
  breakEvenRoas: number | null;
};

export function revenueKpis(input: PeriodInput): { kpis: RevenueKpis; completeness: CompletenessReport } {
  const { orders, expenses, adSpendMinor, since, until } = input;
  const recognised = orders.filter(isRecognised);

  const grossSalesMinor = sum(recognised.map((order) => order.subtotalCents));

  /**
   * Les frais de livraison ne sont PAS un revenu de la boutique.
   *
   * Le livreur encaisse le total chez le client (7 500 DA), garde les frais pour ZR (700 DA)
   * et ne credite le compte de la boutique que du prix des articles (6 800 DA). Cet argent ne
   * transite jamais par la boutique : ce n'est ni une recette, ni une depense.
   *
   * Il etait auparavant compte comme du chiffre d'affaires, puis re-soustrait comme un cout de
   * transport. Le resultat final tombait juste -- 700 dedans, 700 dehors -- mais tous les
   * ratios batis dessus etaient faux, parce que leur denominateur contenait l'argent de ZR :
   * chiffre d'affaires et panier moyen gonfles, marge brute gonflee, et surtout ROAS de
   * rentabilite SUREVALUE. Ce dernier est celui qui coute : il fixe la barre de rentabilite
   * trop haut, et fait couper des campagnes qui gagnaient de l'argent.
   */
  const shippingCollectedForCarrierMinor = sum(recognised.map((order) => order.shippingCents));
  const refundsMinor = sum(recognised.map(orderRefundsMinor));
  // The store has no discount mechanism, so gross sales already exclude discounts.
  const netRevenueMinor = grossSalesMinor - refundsMinor;

  const cogsValues = recognised.map(orderCogsMinor);
  const ordersMissingCogs = cogsValues.filter((value) => value === null).length;
  const cogsMinor = sum(cogsValues.map((value) => value ?? 0));


  /**
   * Frais de retour : la SEULE livraison que la boutique paie reellement.
   *
   * Sur une commande livree, le client paie le transport et le livreur le remet a ZR : rien
   * ne sort de la boutique. Un colis qui revient est l'exception -- le client n'a rien paye,
   * et ZR facture quand meme le retour, preleve sur le compte.
   *
   * C'etait aussi le seul cout de livraison qui n'etait compte nulle part, parce que les couts
   * n'etaient additionnes que sur les commandes LIVREES. Une commande retournee n'en etait pas
   * une : son cout disparaissait purement et simplement.
   */
  const returnFeesMinor = sum(orders.map((order) => order.deliveryCost?.returnCostCents ?? 0));
  const cameBackOrders = orders.filter((order) => order.status === "returned" || CANCELLED.includes(order.status));
  const failedDeliveriesMissingCost = cameBackOrders.filter((order) => order.deliveryCost === null).length;

  const grossProfitMinor = netRevenueMinor - cogsMinor;
  // No payment-processing fees exist: the store is cash on delivery only.
  const variableCostsMinor = returnFeesMinor;
  const contributionBeforeAdsMinor = netRevenueMinor - cogsMinor - variableCostsMinor;
  const contributionAfterAdsMinor = adSpendMinor === null ? null : contributionBeforeAdsMinor - adSpendMinor;
  const opexMinor = operatingExpensesMinor(expenses, since, until);
  const netProfitMinor = contributionAfterAdsMinor === null ? null : contributionAfterAdsMinor - opexMinor;

  // Approved definitions: capital = COGS + ad spend; ROI = net profit / capital.
  const capitalInvestedMinor = adSpendMinor === null ? null : cogsMinor + adSpendMinor;
  const roi = netProfitMinor === null || capitalInvestedMinor === null ? null : ratio(netProfitMinor, capitalInvestedMinor);

  // Approved definition: upsell = revenue from order lines beyond the first item.
  const upsellOrders = recognised.filter((order) => order.items.length > 1).length;
  const upsellRevenueMinor = sum(recognised.map((order) =>
    sum(order.items.slice(1).map((item) => item.unitPriceCents * item.quantity))));

  const contributionMarginRatio = ratio(contributionBeforeAdsMinor, netRevenueMinor);

  const notes: string[] = [];
  if (ordersMissingCogs > 0) notes.push(`${ordersMissingCogs} commande(s) livrée(s) sans coût produit : le profit brut est surestimé.`);
  if (failedDeliveriesMissingCost > 0) notes.push(`${failedDeliveriesMissingCost} commande(s) retournée(s) ou refusée(s) sans frais de retour enregistrés : la marge de contribution est surestimée.`);
  if (adSpendMinor === null) notes.push("Dépense publicitaire non convertie en DZD : profit après publicité, ROI et capital indisponibles.");

  return {
    kpis: {
      orderCount: orders.length,
      validOrders: recognised.length,
      grossSalesMinor,
      shippingCollectedForCarrierMinor,
      refundsMinor,
      netRevenueMinor,
      cogsMinor,
      grossProfitMinor,
      grossMarginPercent: percent(grossProfitMinor, netRevenueMinor),
      variableCostsMinor,
      failedDeliveryCostMinor: returnFeesMinor,
      contributionBeforeAdsMinor,
      contributionAfterAdsMinor,
      operatingExpensesMinor: opexMinor,
      netProfitMinor,
      netMarginPercent: netProfitMinor === null ? null : percent(netProfitMinor, netRevenueMinor),
      capitalInvestedMinor,
      roi,
      aovMinor: perUnitMinor(netRevenueMinor, recognised.length),
      profitPerOrderMinor: netProfitMinor === null ? null : perUnitMinor(netProfitMinor, recognised.length),
      upsellOrders,
      upsellRatePercent: percent(upsellOrders, recognised.length),
      upsellRevenueMinor,
      // Break-even ROAS = 1 / contribution-margin-before-ads ratio.
      breakEvenRoas: contributionMarginRatio === null || contributionMarginRatio <= 0 ? null : Math.round((1 / contributionMarginRatio) * 100) / 100,
    },
    completeness: {
      ordersMissingCogs,
      failedDeliveriesMissingReturnCost: failedDeliveriesMissingCost,
      adSpendConverted: adSpendMinor !== null,
      complete: ordersMissingCogs === 0 && failedDeliveriesMissingCost === 0 && adSpendMinor !== null,
      notes,
    },
  };
}

// --- COD funnel and delivery performance ----------------------------------------

const wasEverShipped = (order: Order) => order.statusHistory.some((entry) => entry.status === "shipped");

export type CodKpis = {
  placed: number;
  confirmed: number;
  shipped: number;
  delivered: number;
  returned: number;
  cancelled: number;
  confirmationRatePercent: number | null;
  deliveryRatePercent: number | null;
  returnRatePercent: number | null;
  failedDeliveryRatePercent: number | null;
  /** Approved: delivered / (delivered + returned + failed), shipped orders only. */
  deliveryPerformancePercent: number | null;
  /** Approved: confirmation rate per agent. */
  confirmationPerformance: Array<{ adminId: number | null; handled: number; confirmed: number; ratePercent: number | null }>;
  medianHoursToConfirm: number | null;
  medianDaysToDeliver: number | null;
  /** Frais de livraison encaisses par les livreurs pour le compte de ZR. Pas un revenu. */
  shippingCollectedForCarrierMinor: number;
  outboundDeliveryCostMinor: number;
  returnDeliveryCostMinor: number;
  /**
   * Resultat net du transport pour la boutique, sur la periode.
   *
   * Normalement negatif ou nul : la boutique facture au client exactement ce que ZR prend, donc
   * l'aller se neutralise et il ne reste que les retours, qui sont a sa charge. Un resultat
   * positif signifie que le tarif affiche au client depasse celui de ZR.
   */
  netDeliveryResultMinor: number;
  netDeliveryResultPerDeliveredMinor: number | null;
};

function hoursBetween(from: string, to: string): number | null {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return (end - start) / 3_600_000;
}

function firstAt(order: Order, status: OrderStatus): string | null {
  return order.statusHistory.find((entry) => entry.status === status)?.createdAt ?? null;
}

export function codKpis(orders: Order[]): CodKpis {
  const placed = orders.length;
  const confirmed = orders.filter((order) => order.statusHistory.some((entry) => entry.status === "confirmed")).length;
  const shipped = orders.filter(wasEverShipped).length;
  const delivered = orders.filter((order) => order.status === "delivered").length;
  const returned = orders.filter((order) => order.status === "returned").length;
  const cancelled = orders.filter((order) => CANCELLED.includes(order.status)).length;

  // Eligible for confirmation = every order that reached a decision, i.e. not still awaiting one.
  const awaiting = orders.filter((order) => order.status === "new" || order.status === "to_confirm").length;
  const eligibleForConfirmation = placed - awaiting;

  // A "refused" order only counts as a delivery failure if it was already shipped;
  // refused at phone-confirmation time is a confirmation failure, not a carrier failure.
  const failedAfterShipping = orders.filter((order) => order.status === "refused" && wasEverShipped(order)).length;
  const deliveryOutcomes = delivered + returned + failedAfterShipping;

  // Per-agent confirmation performance, keyed on who made the status change.
  const agentStats = new Map<number | null, { handled: number; confirmed: number }>();
  for (const order of orders) {
    for (const entry of order.statusHistory) {
      if (entry.status !== "confirmed" && entry.status !== "refused") continue;
      const current = agentStats.get(entry.changedByAdminId) ?? { handled: 0, confirmed: 0 };
      current.handled += 1;
      if (entry.status === "confirmed") current.confirmed += 1;
      agentStats.set(entry.changedByAdminId, current);
    }
  }

  const confirmDurations = orders.flatMap((order) => {
    const at = firstAt(order, "confirmed");
    const hours = at ? hoursBetween(order.createdAt, at) : null;
    return hours === null ? [] : [hours];
  });
  const deliverDurations = orders.flatMap((order) => {
    const from = firstAt(order, "shipped");
    const to = firstAt(order, "delivered");
    const hours = from && to ? hoursBetween(from, to) : null;
    return hours === null ? [] : [hours / 24];
  });

  const deliveredOrders = orders.filter((order) => order.status === "delivered");
  const shippingCollectedForCarrierMinor = sum(deliveredOrders.map((order) => order.shippingCents));
  const outboundDeliveryCostMinor = sum(orders.map((order) => order.deliveryCost?.carrierCostCents ?? 0));
  const returnDeliveryCostMinor = sum(orders.map((order) => order.deliveryCost?.returnCostCents ?? 0));
  const netDeliveryResultMinor = shippingCollectedForCarrierMinor - outboundDeliveryCostMinor - returnDeliveryCostMinor;

  return {
    placed,
    confirmed,
    shipped,
    delivered,
    returned,
    cancelled,
    confirmationRatePercent: percent(confirmed, eligibleForConfirmation),
    deliveryRatePercent: percent(delivered, shipped),
    returnRatePercent: percent(returned, shipped),
    failedDeliveryRatePercent: percent(failedAfterShipping, shipped),
    deliveryPerformancePercent: percent(delivered, deliveryOutcomes),
    confirmationPerformance: [...agentStats.entries()].map(([adminId, stats]) => ({
      adminId,
      handled: stats.handled,
      confirmed: stats.confirmed,
      ratePercent: percent(stats.confirmed, stats.handled),
    })).sort((a, b) => b.handled - a.handled),
    medianHoursToConfirm: median(confirmDurations),
    medianDaysToDeliver: median(deliverDurations),
    shippingCollectedForCarrierMinor,
    outboundDeliveryCostMinor,
    returnDeliveryCostMinor,
    netDeliveryResultMinor,
    netDeliveryResultPerDeliveredMinor: perUnitMinor(netDeliveryResultMinor, delivered),
  };
}

// --- Customer metrics -------------------------------------------------------------

/** Customers are identified by normalised phone: the store allows guest checkout. */
const customerKey = (order: Order) => order.phone.replace(/\D/g, "");

export type CustomerKpis = {
  uniqueBuyers: number;
  newBuyers: number;
  returningBuyers: number;
  acquisitionRatePercent: number | null;
  repeatPurchaseRatePercent: number | null;
  purchaseFrequency: number | null;
  medianDaysToSecondPurchase: number | null;
  averageCustomerValueMinor: number | null;
  profitPerCustomerMinor: number | null;
  cacMinor: number | null;
  ltvToCac: number | null;
};

/**
 * `priorOrders` are recognised orders from BEFORE the period, used to tell a genuinely new
 * buyer from one who simply had not ordered inside the window.
 */
export function customerKpis(orders: Order[], priorOrders: Order[], netProfitMinor: number | null, adSpendMinor: number | null): CustomerKpis {
  const recognised = orders.filter(isRecognised);
  const byCustomer = new Map<string, Order[]>();
  for (const order of recognised) {
    const key = customerKey(order);
    if (!key) continue;
    byCustomer.set(key, [...(byCustomer.get(key) ?? []), order]);
  }
  const priorKeys = new Set(priorOrders.filter(isRecognised).map(customerKey).filter(Boolean));

  const uniqueBuyers = byCustomer.size;
  const newBuyers = [...byCustomer.keys()].filter((key) => !priorKeys.has(key)).length;
  const returningBuyers = uniqueBuyers - newBuyers;

  // Repeat purchase considers the full history, not just this period.
  const lifetimeCounts = new Map<string, number>();
  for (const order of [...priorOrders, ...recognised].filter(isRecognised)) {
    const key = customerKey(order);
    if (key) lifetimeCounts.set(key, (lifetimeCounts.get(key) ?? 0) + 1);
  }
  const withAtLeastOne = lifetimeCounts.size;
  const withAtLeastTwo = [...lifetimeCounts.values()].filter((count) => count >= 2).length;

  const secondPurchaseGaps: number[] = [];
  const allByCustomer = new Map<string, Order[]>();
  for (const order of [...priorOrders, ...recognised].filter(isRecognised)) {
    const key = customerKey(order);
    if (key) allByCustomer.set(key, [...(allByCustomer.get(key) ?? []), order]);
  }
  for (const customerOrders of allByCustomer.values()) {
    if (customerOrders.length < 2) continue;
    const sorted = [...customerOrders].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const gap = hoursBetween(sorted[0].createdAt, sorted[1].createdAt);
    if (gap !== null) secondPurchaseGaps.push(gap / 24);
  }

  const netRevenueMinor = sum(recognised.map(orderStoreRevenueMinor));

  return {
    uniqueBuyers,
    newBuyers,
    returningBuyers,
    acquisitionRatePercent: percent(newBuyers, uniqueBuyers),
    repeatPurchaseRatePercent: percent(withAtLeastTwo, withAtLeastOne),
    purchaseFrequency: ratio(recognised.length, uniqueBuyers),
    medianDaysToSecondPurchase: median(secondPurchaseGaps),
    averageCustomerValueMinor: perUnitMinor(netRevenueMinor, uniqueBuyers),
    profitPerCustomerMinor: netProfitMinor === null ? null : perUnitMinor(netProfitMinor, uniqueBuyers),
    // CAC uses NEW buyers: dividing by all buyers would understate acquisition cost.
    cacMinor: adSpendMinor === null ? null : perUnitMinor(adSpendMinor, newBuyers),
    ltvToCac: (() => {
      if (adSpendMinor === null || newBuyers === 0) return null;
      const cac = adSpendMinor / newBuyers;
      const value = perUnitMinor(netRevenueMinor, uniqueBuyers);
      return value === null || cac <= 0 ? null : Math.round((value / cac) * 100) / 100;
    })(),
  };
}

// --- Daily series -------------------------------------------------------------------

/**
 * Bucket a timestamp into a reporting day.
 * Algeria is a fixed UTC+1 with no daylight saving, so a constant shift is exact here.
 * Any timezone with DST would need Intl instead.
 */
export function reportingDay(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed + 3_600_000).toISOString().slice(0, 10);
}

export type DailyPoint = {
  date: string;
  orders: number;
  deliveredOrders: number;
  netRevenueMinor: number;
  cogsMinor: number;
  contributionMinor: number;
  spendMinor: number | null;
  capitalMinor: number | null;
};

/** One point per calendar day in the range, including days with no activity. */
export function dailySeries(orders: Order[], spendByDay: Map<string, number | null>, since: string, until: string): DailyPoint[] {
  const points: DailyPoint[] = [];
  const start = Date.parse(`${since}T00:00:00Z`);
  const end = Date.parse(`${until}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return points;

  const byDay = new Map<string, Order[]>();
  for (const order of orders) {
    const day = reportingDay(order.createdAt);
    if (day) byDay.set(day, [...(byDay.get(day) ?? []), order]);
  }

  for (let cursor = start; cursor <= end; cursor += 86_400_000) {
    const date = new Date(cursor).toISOString().slice(0, 10);
    const dayOrders = byDay.get(date) ?? [];
    const recognised = dayOrders.filter(isRecognised);
    const netRevenueMinor = sum(recognised.map(orderStoreRevenueMinor));
    const cogsMinor = sum(recognised.map((order) => orderCogsMinor(order) ?? 0));
    // Les retours de la journee, y compris ceux des commandes non livrees : eux sont a la charge
    // de la boutique, et ils ne se rattachent a aucun revenu.
    const returnFeesMinor = sum(dayOrders.map(orderReturnFeeMinor));
    const spendMinor = spendByDay.has(date) ? spendByDay.get(date) ?? null : 0;
    points.push({
      date,
      orders: dayOrders.length,
      deliveredOrders: recognised.length,
      netRevenueMinor,
      cogsMinor,
      contributionMinor: netRevenueMinor - cogsMinor - returnFeesMinor,
      spendMinor,
      // Capital deployed that day: goods sold plus advertising.
      capitalMinor: spendMinor === null ? null : cogsMinor + spendMinor,
    });
  }
  return points;
}

// --- Store-side attribution ---------------------------------------------------------

export type AttributionModel = "last" | "first";

export type AttributedTotals = {
  model: AttributionModel;
  attributedOrders: number;
  attributedNetRevenueMinor: number;
  attributedContributionMinor: number | null;
  /** Recognised orders that carry no attribution record at all. */
  ordersWithoutAttribution: number;
  coveragePercent: number | null;
};

const isMetaAttributed = (order: Order, model: AttributionModel) =>
  model === "first" ? order.attribution?.isMetaFirstTouch === true : order.attribution?.isMetaLastTouch === true;

/**
 * Store-side attributed revenue and contribution profit.
 *
 * Uses the SAME cost logic as revenueKpis(), so an attributed margin can never disagree with
 * the overall margin. Contribution is null when any attributed order lacks cost data, rather
 * than quietly reporting an inflated figure.
 */
export function attributedTotals(orders: Order[], model: AttributionModel = "last"): AttributedTotals {
  const recognised = orders.filter(isRecognised);
  const attributed = recognised.filter((order) => isMetaAttributed(order, model));

  const netRevenueMinor = sum(attributed.map(orderStoreRevenueMinor));
  const cogsValues = attributed.map(orderCogsMinor);
  const costsComplete = !cogsValues.includes(null);
  const contributionMinor = costsComplete
    ? netRevenueMinor - sum(cogsValues.map((value) => value ?? 0)) - sum(attributed.map(orderReturnFeeMinor))
    : null;

  return {
    model,
    attributedOrders: attributed.length,
    attributedNetRevenueMinor: netRevenueMinor,
    attributedContributionMinor: contributionMinor,
    ordersWithoutAttribution: recognised.filter((order) => !order.attribution).length,
    coveragePercent: percent(recognised.filter((order) => order.attribution).length, recognised.length),
  };
}

// --- Advertising ratios -------------------------------------------------------------

export type AdKpis = {
  spendMinor: number | null;
  metaReportedRoas: number | null;
  storeAttributedRoas: number | null;
  mer: number | null;
  poas: number | null;
  cpaMinor: number | null;
};

/**
 * `metaPurchaseValueMinor` is Meta's own attributed value, already in DZD.
 * It is kept strictly separate from store-recognised revenue: the two answer different
 * questions and must never be blended into a single "ROAS".
 */
export function adKpis(params: {
  adSpendMinor: number | null;
  metaPurchaseValueMinor: number | null;
  storeNetRevenueMinor: number;
  attributedNetRevenueMinor: number | null;
  attributedContributionMinor: number | null;
  attributedPurchases: number;
}): AdKpis {
  const { adSpendMinor, metaPurchaseValueMinor, storeNetRevenueMinor, attributedNetRevenueMinor, attributedContributionMinor, attributedPurchases } = params;
  return {
    spendMinor: adSpendMinor,
    metaReportedRoas: adSpendMinor === null || metaPurchaseValueMinor === null ? null : ratio(metaPurchaseValueMinor, adSpendMinor),
    storeAttributedRoas: adSpendMinor === null || attributedNetRevenueMinor === null ? null : ratio(attributedNetRevenueMinor, adSpendMinor),
    mer: adSpendMinor === null ? null : ratio(storeNetRevenueMinor, adSpendMinor),
    poas: adSpendMinor === null || attributedContributionMinor === null ? null : ratio(attributedContributionMinor, adSpendMinor),
    cpaMinor: adSpendMinor === null ? null : perUnitMinor(adSpendMinor, attributedPurchases),
  };
}
