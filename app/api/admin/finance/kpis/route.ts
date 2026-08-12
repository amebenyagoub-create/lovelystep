import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { listDailySpend, listExpenses, listOrdersForPeriod, metaAttributedTotals } from "@/lib/db-postgres";
import { convertSpendToDzd } from "@/lib/finance/fx";
import { adKpis, attributedTotals, codKpis, customerKpis, dailySeries, REPORTING_CURRENCY, REPORTING_TIMEZONE, revenueKpis } from "@/lib/finance/kpis";

export const dynamic = "force-dynamic";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });

  const url = new URL(request.url);
  const since = url.searchParams.get("since") ?? "";
  const until = url.searchParams.get("until") ?? "";
  if (!isoDate.test(since) || !isoDate.test(until) || since > until) {
    return NextResponse.json({ error: "Période invalide (AAAA-MM-JJ)." }, { status: 400 });
  }

  const [{ period, prior }, expenses, spendRows, metaTotals] = await Promise.all([
    listOrdersForPeriod(since, until),
    listExpenses(),
    listDailySpend(since, until),
    metaAttributedTotals(since, until),
  ]);

  // Ad spend must be converted before it can touch any profit figure.
  const conversion = await convertSpendToDzd(spendRows);
  const adSpendMinor = conversion.totalDzdMinor;

  const { kpis: revenue, completeness } = revenueKpis({ orders: period, expenses, adSpendMinor, since, until });
  const cod = codKpis(period);
  const customers = customerKpis(period, prior, revenue.netProfitMinor, adSpendMinor);

  // Meta's attributed value needs the same conversion before being compared to spend.
  const metaValue = metaTotals
    ? (await convertSpendToDzd([{ date: until, currency: metaTotals.currency, spendMinor: metaTotals.purchaseValueMinor }])).totalDzdMinor
    : null;

  // Store-side attribution. Default model is last touch; ?model=first switches it.
  const model = url.searchParams.get("model") === "first" ? "first" : "last";
  const attributed = attributedTotals(period, model);

  const ads = adKpis({
    adSpendMinor,
    metaPurchaseValueMinor: metaValue,
    storeNetRevenueMinor: revenue.netRevenueMinor,
    attributedNetRevenueMinor: attributed.attributedNetRevenueMinor,
    attributedContributionMinor: attributed.attributedContributionMinor,
    // CPA uses store-attributed purchases so it stays consistent with store-attributed ROAS.
    attributedPurchases: attributed.attributedOrders,
  });

  // Per-day spend in DZD, so a chart can show the evolution. A day whose rate is missing
  // carries null rather than a zero that would read as "no spend".
  const missingDays = new Set(conversion.missingRates.map((rate) => rate.date));
  const spendByDay = new Map<string, number | null>();
  for (const row of spendRows) {
    if (missingDays.has(row.date)) { spendByDay.set(row.date, null); continue; }
    const converted = (await convertSpendToDzd([row])).totalDzdMinor;
    spendByDay.set(row.date, converted === null ? null : (spendByDay.get(row.date) ?? 0) + converted);
  }
  const series = dailySeries(period, spendByDay, since, until);

  if (conversion.missingRates.length) {
    completeness.notes.push(`Taux de change manquant pour ${conversion.missingRates.length} jour(s) : ${conversion.missingRates.slice(0, 5).map((rate) => `${rate.date} ${rate.currency}`).join(", ")}.`);
  }

  return NextResponse.json({
    period: { since, until, timezone: REPORTING_TIMEZONE, currency: REPORTING_CURRENCY },
    revenue,
    cod,
    customers,
    ads,
    attribution: attributed,
    series,
    completeness,
    fx: { missingRates: conversion.missingRates, convertedRows: conversion.convertedRows },
  });
}
