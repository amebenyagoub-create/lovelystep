import "server-only";

import {
  listCatalogItems, listDailySpend, listExpenses, listOrdersForPeriod, listSyncState,
  metaAttributedTotals, reconciliationEventCounts,
} from "../db-postgres";
import { convertSpendToDzd } from "../finance/fx";
import { attributedTotals, REPORTING_TIMEZONE, revenueKpis } from "../finance/kpis";
import { metaStatus } from "./config";

/**
 * Reconciliation between the two reporting perspectives.
 *
 * Meta-reported and store-attributed numbers are expected to differ. The point is not to make
 * them match, but to make the gap visible and explainable, and to surface data problems
 * (missing events, stale syncs, missing costs, rejected catalog items, expired credentials)
 * instead of letting them quietly distort a dashboard.
 */

export type Flag = {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
};

export type ReconciliationReport = {
  period: { since: string; until: string; timezone: string };
  store: { ordersPlaced: number; confirmed: number; delivered: number; netRevenueMinor: number };
  events: { purchaseEvents: number; pixelOnly: number; capiOnly: number; deduplicated: number; failed: number };
  metaReported: { purchases: number; purchaseValueMinor: number | null; currency: string; spendMinor: number | null };
  storeAttributed: { orders: number; netRevenueMinor: number; contributionMinor: number | null; coveragePercent: number | null };
  flags: Flag[];
};

const HOUR = 3_600_000;

export async function buildReconciliation(since: string, until: string): Promise<ReconciliationReport> {
  const [{ period }, expenses, spendRows, metaTotals, eventCounts, syncState, catalogItems] = await Promise.all([
    listOrdersForPeriod(since, until),
    listExpenses(),
    listDailySpend(since, until),
    metaAttributedTotals(since, until),
    reconciliationEventCounts(since, until),
    listSyncState(),
    listCatalogItems(),
  ]);

  const conversion = await convertSpendToDzd(spendRows);
  const { kpis, completeness } = revenueKpis({ orders: period, expenses, adSpendMinor: conversion.totalDzdMinor, since, until });
  const attributed = attributedTotals(period, "last");

  const metaValue = metaTotals && metaTotals.purchaseValueMinor > 0
    ? (await convertSpendToDzd([{ date: until, currency: metaTotals.currency, spendMinor: metaTotals.purchaseValueMinor }])).totalDzdMinor
    : 0;

  const ordersPlaced = period.length;
  const confirmed = period.filter((order) => order.statusHistory.some((entry) => entry.status === "confirmed")).length;
  const delivered = period.filter((order) => order.status === "delivered").length;

  const flags: Flag[] = [];

  // --- Event coverage ---------------------------------------------------------------
  // Purchase fires at order placement, so one event per placed order is the expectation.
  if (ordersPlaced > 0 && eventCounts.purchaseEvents < ordersPlaced) {
    const missing = ordersPlaced - eventCounts.purchaseEvents;
    flags.push({
      severity: missing > ordersPlaced * 0.1 ? "error" : "warning",
      code: "missing_purchase_events",
      message: `${missing} commande(s) sans événement Purchase enregistré. Cause la plus probable : refus de consentement, ce qui est normal et attendu.`,
    });
  }
  if (eventCounts.purchaseEvents > ordersPlaced) {
    flags.push({ severity: "error", code: "duplicate_purchase_events", message: `${eventCounts.purchaseEvents - ordersPlaced} événement(s) Purchase de plus que de commandes : déduplication à vérifier.` });
  }
  if (eventCounts.capiOnly > 0 && eventCounts.deduplicated === 0 && eventCounts.purchaseEvents > 0) {
    flags.push({ severity: "warning", code: "pixel_never_paired", message: "Aucun achat n'a été vu à la fois par le Pixel et la CAPI : la déduplication n'est peut-être pas effective." });
  }
  if (eventCounts.failed > 0) {
    flags.push({ severity: "warning", code: "capi_failures", message: `${eventCounts.failed} envoi(s) CAPI en échec sur la période.` });
  }

  // --- Attribution coverage ----------------------------------------------------------
  if (attributed.coveragePercent !== null && attributed.coveragePercent < 50 && delivered > 0) {
    flags.push({ severity: "info", code: "low_attribution_coverage", message: `Seules ${attributed.coveragePercent}% des commandes livrées portent une attribution. Les commandes sans consentement n'en ont jamais.` });
  }

  // --- Meta versus store --------------------------------------------------------------
  if (metaTotals && metaTotals.purchases > 0 && attributed.attributedOrders > 0) {
    const gap = Math.abs(metaTotals.purchases - attributed.attributedOrders);
    const relative = gap / Math.max(metaTotals.purchases, attributed.attributedOrders);
    if (relative > 0.3) {
      flags.push({
        severity: "info",
        code: "attribution_gap",
        message: `Meta déclare ${metaTotals.purchases} achat(s), la boutique en attribue ${attributed.attributedOrders}. Un écart est normal : Meta compte à la commande passée et applique ses propres fenêtres d'attribution, la boutique ne compte que le livré.`,
      });
    }
  }

  // --- Data freshness -------------------------------------------------------------------
  for (const state of syncState) {
    if (!state.lastSuccessAt) {
      flags.push({ severity: "error", code: "sync_never_succeeded", message: `La synchronisation « ${state.syncKey} » n'a jamais abouti.` });
      continue;
    }
    const ageHours = (Date.now() - Date.parse(state.lastSuccessAt)) / HOUR;
    if (ageHours > 48) flags.push({ severity: "error", code: "sync_stale", message: `Données « ${state.syncKey} » vieilles de ${Math.round(ageHours)} h.` });
    else if (ageHours > 26) flags.push({ severity: "warning", code: "sync_aging", message: `Données « ${state.syncKey} » vieilles de ${Math.round(ageHours)} h.` });
    if (state.lastError) flags.push({ severity: "warning", code: "sync_error", message: `Dernière erreur « ${state.syncKey} » : ${state.lastError}` });
  }
  if (!spendRows.length) {
    flags.push({ severity: "warning", code: "no_spend_data", message: "Aucune dépense publicitaire importée sur la période." });
  }

  // --- Currency and credentials ------------------------------------------------------------
  if (conversion.missingRates.length) {
    flags.push({
      severity: "error",
      code: "missing_fx_rate",
      message: `Taux de change manquant pour ${conversion.missingRates.length} jour(s). Toutes les métriques dépendant de la dépense sont indisponibles.`,
    });
  }
  const spendCurrencies = [...new Set(spendRows.map((row) => row.currency).filter(Boolean))];
  if (spendCurrencies.length > 1) {
    flags.push({ severity: "warning", code: "mixed_currencies", message: `Plusieurs devises de dépense sur la période : ${spendCurrencies.join(", ")}.` });
  }
  const status = metaStatus();
  if (!status.trackingEnabled) flags.push({ severity: "info", code: "tracking_disabled", message: "META_TRACKING_ENABLED n'est pas activé : aucun événement serveur n'est envoyé." });
  if (status.testEventCodeActive) flags.push({ severity: "warning", code: "test_events_active", message: "Un code Test Events est actif : les événements ne comptent pas comme conversions réelles." });

  // --- Cost completeness and catalog -----------------------------------------------------------
  for (const note of completeness.notes) flags.push({ severity: "warning", code: "incomplete_costs", message: note });
  const failedCatalog = catalogItems.filter((item) => item.lastError);
  if (failedCatalog.length) {
    flags.push({ severity: "warning", code: "catalog_failures", message: `${failedCatalog.length} produit(s) refusé(s) par le catalogue Meta.` });
  }

  return {
    period: { since, until, timezone: REPORTING_TIMEZONE },
    store: { ordersPlaced, confirmed, delivered, netRevenueMinor: kpis.netRevenueMinor },
    events: eventCounts,
    metaReported: {
      purchases: metaTotals?.purchases ?? 0,
      purchaseValueMinor: metaValue,
      currency: metaTotals?.currency ?? "",
      spendMinor: conversion.totalDzdMinor,
    },
    storeAttributed: {
      orders: attributed.attributedOrders,
      netRevenueMinor: attributed.attributedNetRevenueMinor,
      contributionMinor: attributed.attributedContributionMinor,
      coveragePercent: attributed.coveragePercent,
    },
    flags: flags.sort((a, b) => {
      const order = { error: 0, warning: 1, info: 2 };
      return order[a.severity] - order[b.severity];
    }),
  };
}
