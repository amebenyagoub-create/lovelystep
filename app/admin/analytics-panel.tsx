"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Funnel, LineChart, SeriesTable, SERIES, Waterfall, type SeriesPoint } from "./charts";

type Nullable = number | null;
type KpiResponse = {
  period: { since: string; until: string; timezone: string; currency: string };
  revenue: Record<string, Nullable | number>;
  cod: Record<string, unknown>;
  customers: Record<string, Nullable>;
  ads: Record<string, Nullable>;
  attribution: { model: string; attributedOrders: number; attributedNetRevenueMinor: number; attributedContributionMinor: Nullable; ordersWithoutAttribution: number; coveragePercent: Nullable };
  series: Array<{ date: string; orders: number; deliveredOrders: number; netRevenueMinor: number; cogsMinor: number; contributionMinor: number; spendMinor: Nullable; capitalMinor: Nullable }>;
  completeness: { complete: boolean; notes: string[]; ordersMissingCogs: number; deliveredOrdersMissingDeliveryCost: number; adSpendConverted: boolean };
  fx: { missingRates: Array<{ date: string; currency: string }> };
};

const money = (minor: Nullable) => minor == null ? "—" : new Intl.NumberFormat("fr-DZ", { style: "currency", currency: "DZD", maximumFractionDigits: 0 }).format(minor / 100);
/** Never render Infinity or NaN: the API already returns null, this is the display guard. */
const num = (value: Nullable, suffix = "", digits = 2) => value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(digits)}${suffix}`;
const pct = (value: Nullable) => value == null || !Number.isFinite(value) ? "—" : `${value}%`;
const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000 + 3_600_000).toISOString().slice(0, 10);

const RANGES: Array<[string, number]> = [["7 jours", 6], ["30 jours", 29], ["90 jours", 89]];

export default function AnalyticsPanel() {
  const [since, setSince] = useState(isoDay(-29));
  const [until, setUntil] = useState(isoDay(0));
  const [model, setModel] = useState<"last" | "first">("last");
  const [chartMode, setChartMode] = useState<"amount" | "capital">("amount");
  const [showTable, setShowTable] = useState(false);
  const [data, setData] = useState<KpiResponse | null>(null);
  const [previous, setPrevious] = useState<KpiResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      // Comparison period: the same number of days immediately before the selected range.
      const days = Math.round((Date.parse(until) - Date.parse(since)) / 86_400_000) + 1;
      const prevUntil = new Date(Date.parse(since) - 86_400_000).toISOString().slice(0, 10);
      const prevSince = new Date(Date.parse(since) - days * 86_400_000).toISOString().slice(0, 10);
      const query = (from: string, to: string) => `/api/admin/finance/kpis?since=${from}&until=${to}&model=${model}`;
      const [current, comparison] = await Promise.all([
        fetch(query(since, until), { cache: "no-store" }),
        fetch(query(prevSince, prevUntil), { cache: "no-store" }),
      ]);
      const value = await current.json().catch(() => ({}));
      if (!current.ok) { setError(value.error || "Chargement impossible."); setData(null); return; }
      setData(value as KpiResponse);
      setPrevious(comparison.ok ? (await comparison.json().catch(() => null)) as KpiResponse : null);
    } catch {
      setError("Connexion au serveur impossible.");
    } finally {
      setLoading(false);
    }
  }, [since, until, model]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const points: SeriesPoint[] = useMemo(() => (data?.series ?? []).map((point) => ({
    date: point.date,
    values: (chartMode === "amount"
      ? { revenue: point.netRevenueMinor, profit: point.contributionMinor, spend: point.spendMinor }
      : { capital: point.capitalMinor, spend: point.spendMinor, cogs: point.cogsMinor }) as Record<string, number | null>,
  })), [data, chartMode]);

  const chartSeries = chartMode === "amount"
    ? [{ key: "revenue", label: "Revenu net", color: SERIES.revenue }, { key: "profit", label: "Contribution", color: SERIES.profit }, { key: "spend", label: "Dépense pub", color: SERIES.spend }]
    : [{ key: "capital", label: "Capital engagé", color: SERIES.revenue }, { key: "cogs", label: "Coût produits", color: SERIES.profit }, { key: "spend", label: "Dépense pub", color: SERIES.spend }];

  const revenue = data?.revenue ?? {};
  const cod = (data?.cod ?? {}) as Record<string, number | null | Array<{ adminId: number | null; handled: number; confirmed: number; ratePercent: number | null }>>;
  const delta = (key: string) => {
    const now = revenue[key];
    const before = previous?.revenue?.[key];
    if (typeof now !== "number" || typeof before !== "number" || before === 0) return null;
    return Math.round(((now - before) / Math.abs(before)) * 1000) / 10;
  };

  const waterfall = data ? [
    { label: "Revenu net", amountMinor: Number(revenue.netRevenueMinor ?? 0), kind: "total" as const },
    { label: "Coût produits", amountMinor: Number(revenue.cogsMinor ?? 0), kind: "subtract" as const },
    { label: "Coûts variables", amountMinor: Number(revenue.variableCostsMinor ?? 0), kind: "subtract" as const },
    ...(revenue.contributionAfterAdsMinor == null ? [] : [{ label: "Dépense pub", amountMinor: Number(revenue.netRevenueMinor ?? 0) - Number(revenue.cogsMinor ?? 0) - Number(revenue.variableCostsMinor ?? 0) - Number(revenue.contributionAfterAdsMinor), kind: "subtract" as const }]),
    { label: "Charges exploitation", amountMinor: Number(revenue.operatingExpensesMinor ?? 0), kind: "subtract" as const },
    ...(revenue.netProfitMinor == null ? [] : [{ label: "Profit net", amountMinor: Number(revenue.netProfitMinor), kind: "total" as const }]),
  ] : [];

  return <div className="analytics-panel">
    <section className="admin-card filter-bar">
      <div className="filter-row">
        <div className="range-presets">{RANGES.map(([label, days]) => (
          <button key={label} type="button" className={Date.parse(until) - Date.parse(since) === days * 86_400_000 ? "active" : ""}
            onClick={() => { setSince(isoDay(-days)); setUntil(isoDay(0)); }}>{label}</button>
        ))}</div>
        <label>Du<input type="date" value={since} max={until} onChange={(event) => setSince(event.target.value)} /></label>
        <label>Au<input type="date" value={until} min={since} onChange={(event) => setUntil(event.target.value)} /></label>
        <label>Attribution<select value={model} onChange={(event) => setModel(event.target.value as "last" | "first")}>
          <option value="last">Dernier contact</option><option value="first">Premier contact</option>
        </select></label>
      </div>
      <p className="filter-note">Fuseau {data?.period.timezone ?? "Africa/Algiers"} · Revenu reconnu à la livraison · Comparaison avec la période précédente de même durée</p>
    </section>

    {error && <div className="admin-alert error">{error}</div>}
    {loading && !data && <p className="chart-empty">Chargement des indicateurs…</p>}

    {data && <>
      {!data.completeness.complete && <div className="admin-alert warning completeness">
        <strong>Données financières incomplètes</strong>
        <ul>{data.completeness.notes.map((note) => <li key={note}>{note}</li>)}</ul>
      </div>}

      <section className="stat-grid kpi-grid">
        <article className="revenue-stat"><span>Revenu net</span><strong>{money(Number(revenue.netRevenueMinor ?? 0))}</strong><small>{delta("netRevenueMinor") == null ? "Commandes livrées" : `${delta("netRevenueMinor")! >= 0 ? "▲" : "▼"} ${Math.abs(delta("netRevenueMinor")!)}% vs période précédente`}</small></article>
        <article className="profit-stat"><span>Profit net</span><strong>{money(revenue.netProfitMinor as Nullable)}</strong><small>{revenue.netProfitMinor == null ? "Dépense publicitaire non convertie" : `Marge ${pct(revenue.netMarginPercent as Nullable)}`}</small></article>
        <article><span>Contribution avant pub</span><strong>{money(Number(revenue.contributionBeforeAdsMinor ?? 0))}</strong><small>ROAS de rentabilité {num(revenue.breakEvenRoas as Nullable)}</small></article>
        <article><span>Capital investi</span><strong>{money(revenue.capitalInvestedMinor as Nullable)}</strong><small>ROI {num(revenue.roi as Nullable)}</small></article>
        <article><span>Commandes livrées</span><strong>{String(revenue.validOrders ?? 0)}</strong><small>sur {String(revenue.orderCount ?? 0)} commandes</small></article>
        <article><span>Panier moyen</span><strong>{money(revenue.aovMinor as Nullable)}</strong><small>Profit/commande {money(revenue.profitPerOrderMinor as Nullable)}</small></article>
      </section>

      <section className="admin-card">
        <div className="card-title">
          <div><h2>Évolution</h2><p>Revenu, contribution et dépense publicitaire par jour.</p></div>
          <div className="chart-controls">
            <div className="segmented">
              <button type="button" className={chartMode === "amount" ? "active" : ""} onClick={() => setChartMode("amount")}>Montants</button>
              <button type="button" className={chartMode === "capital" ? "active" : ""} onClick={() => setChartMode("capital")}>Capital</button>
            </div>
            <button type="button" onClick={() => setShowTable((value) => !value)}>{showTable ? "Voir le graphique" : "Voir le tableau"}</button>
          </div>
        </div>
        {showTable
          ? <SeriesTable points={points} series={chartSeries} />
          : <LineChart points={points} series={chartSeries} title={chartMode === "amount" ? "Revenu, contribution et dépense" : "Capital engagé"} emptyLabel="Aucune donnée sur la période." />}
      </section>

      <section className="admin-card">
        <div className="card-title"><div><h2>Cascade de profit</h2><p>Du revenu net au profit net.</p></div></div>
        <Waterfall steps={waterfall} title="Cascade de profit" />
      </section>

      <div className="analytics-columns">
        <section className="admin-card">
          <div className="card-title"><div><h2>Tunnel paiement à la livraison</h2><p>De la commande à l’encaissement.</p></div></div>
          <Funnel title="Tunnel COD" stages={[
            { label: "Passées", value: Number(cod.placed ?? 0) },
            { label: "Confirmées", value: Number(cod.confirmed ?? 0), note: pct(cod.confirmationRatePercent as Nullable) },
            { label: "Expédiées", value: Number(cod.shipped ?? 0) },
            { label: "Livrées", value: Number(cod.delivered ?? 0), note: pct(cod.deliveryRatePercent as Nullable) },
            { label: "Retournées", value: Number(cod.returned ?? 0), note: pct(cod.returnRatePercent as Nullable) },
          ]} />
          <dl className="metric-list">
            <div><dt>Performance de livraison</dt><dd>{pct(cod.deliveryPerformancePercent as Nullable)}</dd></div>
            <div><dt>Délai médian de confirmation</dt><dd>{num(cod.medianHoursToConfirm as Nullable, " h", 1)}</dd></div>
            <div><dt>Délai médian de livraison</dt><dd>{num(cod.medianDaysToDeliver as Nullable, " j", 1)}</dd></div>
            <div><dt>Écart frais de livraison</dt><dd>{money(cod.shippingFeeDifferenceMinor as Nullable)}</dd></div>
            <div><dt>Écart par commande livrée</dt><dd>{money(cod.shippingFeeDifferencePerDeliveredMinor as Nullable)}</dd></div>
          </dl>
          {Array.isArray(cod.confirmationPerformance) && cod.confirmationPerformance.length > 0 && <>
            <h3 className="subhead">Performance de confirmation par agent</h3>
            <table className="chart-table"><thead><tr><th scope="col">Agent</th><th scope="col">Traitées</th><th scope="col">Confirmées</th><th scope="col">Taux</th></tr></thead>
              <tbody>{cod.confirmationPerformance.map((agent) => <tr key={String(agent.adminId)}><th scope="row">{agent.adminId == null ? "Non attribué" : `Admin #${agent.adminId}`}</th><td>{agent.handled}</td><td>{agent.confirmed}</td><td>{pct(agent.ratePercent)}</td></tr>)}</tbody>
            </table>
          </>}
        </section>

        <section className="admin-card">
          <div className="card-title"><div><h2>Publicité et attribution</h2><p>Les deux perspectives restent séparées.</p></div></div>
          <dl className="metric-list">
            <div><dt>Dépense publicitaire</dt><dd>{money(data.ads.spendMinor)}</dd></div>
            <div><dt>ROAS déclaré par Meta</dt><dd>{num(data.ads.metaReportedRoas)}</dd></div>
            <div><dt>ROAS attribué boutique</dt><dd>{num(data.ads.storeAttributedRoas)}</dd></div>
            <div><dt>MER</dt><dd>{num(data.ads.mer)}</dd></div>
            <div><dt>POAS</dt><dd>{num(data.ads.poas)}</dd></div>
            <div><dt>CPA</dt><dd>{money(data.ads.cpaMinor)}</dd></div>
            <div><dt>Commandes attribuées</dt><dd>{data.attribution.attributedOrders}</dd></div>
            <div><dt>Couverture attribution</dt><dd>{pct(data.attribution.coveragePercent)}</dd></div>
          </dl>
          <p className="metric-note">Meta compte à la commande passée, la boutique au livré : un écart est normal.</p>

          <h3 className="subhead">Clients</h3>
          <dl className="metric-list">
            <div><dt>Acheteurs uniques</dt><dd>{data.customers.uniqueBuyers ?? 0}</dd></div>
            <div><dt>Nouveaux acheteurs</dt><dd>{data.customers.newBuyers ?? 0}</dd></div>
            <div><dt>Taux d’acquisition</dt><dd>{pct(data.customers.acquisitionRatePercent)}</dd></div>
            <div><dt>Taux de réachat</dt><dd>{pct(data.customers.repeatPurchaseRatePercent)}</dd></div>
            <div><dt>CAC</dt><dd>{money(data.customers.cacMinor)}</dd></div>
            <div><dt>Valeur client moyenne</dt><dd>{money(data.customers.averageCustomerValueMinor)}</dd></div>
            <div><dt>LTV:CAC</dt><dd>{num(data.customers.ltvToCac)}</dd></div>
            <div><dt>Délai médian 2ᵉ achat</dt><dd>{num(data.customers.medianDaysToSecondPurchase, " j", 1)}</dd></div>
          </dl>
        </section>
      </div>
    </>}
  </div>;
}
