"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BreakdownMetrics, CampaignAnalysis, CampaignBreakdownNode, CampaignDecisionStatus, CampaignIntelligenceResponse } from "@/lib/campaign-intelligence/types";

const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000 + 3_600_000).toISOString().slice(0, 10);
const money = (minor: number | null) => minor === null || !Number.isFinite(minor) ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "DZD", maximumFractionDigits: 0 }).format(minor / 100);
const number = (value: number | null, suffix = "", digits = 1) => value === null || !Number.isFinite(value) ? "—" : `${value.toFixed(digits)}${suffix}`;
const count = (value: number) => value.toLocaleString("en-US");
const statusOrder: CampaignDecisionStatus[] = ["KILL", "WATCH", "SCALE", "KEEP"];
const ranges: Array<[string, number]> = [["7 days", 6], ["30 days", 29], ["90 days", 89]];

function Metric({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return <div><dt>{label}</dt><dd>{value}{note && <small>{note}</small>}</dd></div>;
}

/** The delivery columns, in the order Meta's own reporting lists them. */
const DELIVERY_COLUMNS: Array<[string, (metrics: BreakdownMetrics) => string]> = [
  ["Spend", (m) => m.spendConverted ? money(m.spendMinor) : "FX missing"],
  ["Reach (daily sum)", (m) => count(m.reachDailySum)],
  ["Impressions", (m) => count(m.impressions)],
  ["CPM", (m) => money(m.cpmMinor)],
  ["Clicks (all)", (m) => count(m.clicks)],
  ["CTR (all)", (m) => number(m.ctrPercent, "%", 2)],
  ["Link clicks", (m) => count(m.linkClicks)],
  ["CTR (link)", (m) => number(m.linkCtrPercent, "%", 2)],
  ["Landing views", (m) => count(m.landingPageViews)],
  ["Adds to cart", (m) => count(m.addsToCart)],
  ["Checkouts", (m) => count(m.checkouts)],
  ["Purchases", (m) => count(m.purchases)],
];

/** Campaign totals reshaped into the same field set the breakdown rows use. */
function campaignMetrics(analysis: CampaignAnalysis): BreakdownMetrics {
  const advertising = analysis.kpis.advertising;
  return {
    spendMinor: advertising.spendMinor,
    spendConverted: analysis.kpis.completeness.spendConverted,
    impressions: advertising.impressions,
    reachDailySum: advertising.reach,
    frequency: advertising.frequency,
    clicks: advertising.clicks,
    linkClicks: advertising.linkClicks,
    ctrPercent: advertising.impressions > 0 ? (advertising.clicks / advertising.impressions) * 100 : null,
    linkCtrPercent: advertising.impressions > 0 ? (advertising.linkClicks / advertising.impressions) * 100 : null,
    cpmMinor: advertising.cpmMinor,
    cpcMinor: advertising.cpcMinor,
    landingPageViews: advertising.landingPageViews,
    addsToCart: advertising.addsToCart,
    checkouts: advertising.checkouts,
    purchases: advertising.purchases,
  };
}

function BreakdownRow({ node, depth }: { node: CampaignBreakdownNode; depth: number }) {
  const [open, setOpen] = useState(false);
  const expandable = node.children.length > 0;
  return <>
    <tr className={`breakdown-row breakdown-${node.level}`}>
      <th scope="row" style={{ paddingInlineStart: `${12 + depth * 18}px` }}>
        {expandable
          ? <button type="button" className="breakdown-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
              <span aria-hidden="true">{open ? "\u25be" : "\u25b8"}</span>{node.name}
            </button>
          : <span className="breakdown-leaf">{node.name}</span>}
        <small>{node.level === "adset" ? `Ad set\u00a0\u00b7 ${node.children.length} ad${node.children.length === 1 ? "" : "s"}` : "Ad"}{node.status ? ` \u00b7 ${node.status.toLowerCase()}` : ""}</small>
      </th>
      {DELIVERY_COLUMNS.map(([label, render]) => <td key={label}>{render(node.metrics)}</td>)}
    </tr>
    {open && node.children.map((child) => <BreakdownRow key={child.id} node={child} depth={depth + 1} />)}
  </>;
}

/**
 * Campaign totals with its ad sets and ads underneath.
 *
 * Delivery metrics only: orders are matched to campaigns by utm_campaign, so no row below the
 * campaign has COD outcomes, profit or a verdict to show. Add utm_content to the ad URLs to
 * make per-ad attribution possible later.
 */
function BreakdownTable({ analysis }: { analysis: CampaignAnalysis }) {
  return <div className="breakdown-scroll">
    <table className="breakdown-table">
      <thead><tr><th scope="col">Level</th>{DELIVERY_COLUMNS.map(([label]) => <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>
        <tr className="breakdown-row breakdown-campaign">
          <th scope="row"><span className="breakdown-leaf">{analysis.entity.name}</span><small>Campaign total</small></th>
          {DELIVERY_COLUMNS.map(([label, render]) => <td key={label}>{render(campaignMetrics(analysis))}</td>)}
        </tr>
        {analysis.breakdown.map((node) => <BreakdownRow key={node.id} node={node} depth={1} />)}
      </tbody>
    </table>
    {analysis.breakdown.length === 0 && <p className="chart-empty">No ad set or ad rows for this period yet. They arrive with the next insights sync.</p>}
  </div>;
}

function Funnel({ analysis }: { analysis: CampaignAnalysis }) {
  const steps = [
    [analysis.kpis.funnel.visitorsSource === "landing_page_views" ? "Landing views" : "Link clicks", analysis.kpis.funnel.visitors],
    ["Add to cart", analysis.kpis.funnel.addsToCart],
    ["Checkout", analysis.kpis.funnel.checkouts],
    ["Meta purchase", analysis.kpis.funnel.metaPurchases],
    ["Store order", analysis.kpis.funnel.storeOrders],
    ["Confirmed", analysis.kpis.funnel.confirmedOrders],
    ["Delivered", analysis.kpis.funnel.deliveredOrders],
  ] as const;
  const maximum = Math.max(1, ...steps.map(([, value]) => value));
  return <div className="campaign-funnel">{steps.map(([label, value]) => <div key={label}><span>{label}</span><i><b style={{ width: `${Math.max(value > 0 ? 4 : 0, value / maximum * 100)}%` }} /></i><strong>{value}</strong></div>)}</div>;
}

function CampaignCard({ analysis }: { analysis: CampaignAnalysis }) {
  const { decision, kpis, trend, explanation } = analysis;
  return <article className={`admin-card campaign-decision-card campaign-${decision.status.toLowerCase()}`}>
    <div className="campaign-conclusion">
      <div className="campaign-status-column">
        <span className={`campaign-status ${decision.status.toLowerCase()}`}>{decision.status}</span>
        <small>{decision.confidence} confidence</small>
      </div>
      <div className="campaign-conclusion-copy">
        <div className="campaign-title-row"><div><span className="admin-kicker">{analysis.entity.status || "Campaign"} · {analysis.entity.objective || "objective unavailable"}</span><h2>{analysis.entity.name}</h2></div><span className={`campaign-mode ${kpis.mode}`}>{kpis.mode === "estimated" ? "Estimated outcome" : "Actual outcome"}</span></div>
        <h3>{explanation.headline}</h3>
        <p>{explanation.explanation}</p>
        <div className="campaign-next-action"><b>Prochaine action</b>{explanation.nextAction}</div>
        <div className="campaign-evidence">{decision.evidence.slice(0, 4).map((item) => <span key={item}>{item}</span>)}</div>
      </div>
    </div>

    <div className="campaign-key-metrics">
      <Metric label="Spend" value={money(kpis.advertising.spendMinor)} />
      <Metric label="Selected delivered CPA" value={money(kpis.economics.selectedCpaMinor)} note={kpis.mode} />
      <Metric label="Target delivered CPA" value={money(kpis.economics.targetDeliveredCpaMinor)} />
      <Metric label="Net profit" value={money(kpis.economics.selectedNetProfitMinor)} note={kpis.mode} />
      <Metric label="Delivery rate" value={number(kpis.cod.deliveryRatePercent, "%")} />
      <Metric label="Trend" value={trend.direction.replaceAll("_", " ")} note={trend.creativeFatigue.detected ? "creative fatigue detected" : undefined} />
    </div>

    <section className="campaign-breakdown">
      <div className="campaign-breakdown-head">
        <h3>Delivery by level</h3>
        <small>Meta-reported delivery. Expand an ad set to see its ads.</small>
      </div>
      <BreakdownTable analysis={analysis} />
    </section>

    <details className="campaign-details">
      <summary>Details and diagnostic evidence</summary>
      <div className="campaign-detail-grid">
        <section><h3>Advertising</h3><dl className="metric-list">
          <Metric label="Impressions" value={kpis.advertising.impressions.toLocaleString("en-US")} />
          <Metric label="Daily reach sum" value={kpis.advertising.reach.toLocaleString("en-US")} />
          <Metric label="Frequency" value={number(kpis.advertising.frequency, "", 2)} />
          <Metric label="Link clicks" value={kpis.advertising.linkClicks.toLocaleString("en-US")} />
          <Metric label="CTR (link)" value={number(kpis.advertising.impressions > 0 ? (kpis.advertising.linkClicks / kpis.advertising.impressions) * 100 : null, "%", 2)} note="link clicks / impressions" />
          <Metric label="CPC (link)" value={money(kpis.advertising.cpcMinor)} note="cost per link click" />
          <Metric label="CPM" value={money(kpis.advertising.cpmMinor)} />
          <Metric label="Meta CPA" value={money(kpis.advertising.metaCpaMinor)} />
          <Metric label="Meta ROAS" value={number(kpis.advertising.metaRoas, "x", 2)} />
          <Metric label="Delivered store ROAS" value={number(kpis.advertising.storeAttributedRoas, "x", 2)} />
        </dl></section>
        <section><h3>COD and economics</h3><dl className="metric-list">
          <Metric label="Confirmation rate" value={number(kpis.cod.confirmationRatePercent, "%")} />
          <Metric label="Refusal rate" value={number(kpis.cod.refusalRatePercent, "%")} />
          <Metric label="Delivery rate" value={number(kpis.cod.deliveryRatePercent, "%")} />
          <Metric label="Expected deliveries" value={number(kpis.cod.expectedDeliveredOrders, "", 2)} />
          <Metric label="Confirmed CPA" value={money(kpis.economics.confirmedCpaMinor)} />
          <Metric label="Actual delivered CPA" value={money(kpis.economics.deliveredCpaMinor)} />
          <Metric label="Expected delivered CPA" value={money(kpis.economics.expectedDeliveredCpaMinor)} />
          <Metric label="Break-even CPA" value={money(kpis.economics.breakEvenDeliveredCpaMinor)} />
          <Metric label="Target ROAS" value={number(kpis.economics.targetRoas, "x", 2)} />
        </dl></section>
        <section><h3>Full funnel</h3><Funnel analysis={analysis} /></section>
        <section><h3>Analyst diagnostics</h3><ul className="campaign-diagnostics">{explanation.diagnostics.map((item) => <li key={item}>{item}</li>)}</ul><p className="campaign-ai-source">{explanation.source === "groq" ? `Groq · ${explanation.model}${explanation.cached ? " · cached" : ""}` : "Deterministic fallback · Groq was unavailable or not configured"}</p></section>
      </div>
      {!kpis.completeness.complete && <div className="campaign-data-warning"><strong>Data quality limits</strong><ul>{kpis.completeness.notes.map((note) => <li key={note}>{note}</li>)}</ul></div>}
    </details>
  </article>;
}

export default function CampaignIntelligencePanel({ csrfToken }: { csrfToken: string }) {
  const [since, setSince] = useState(isoDay(-29));
  const [until, setUntil] = useState(isoDay(0));
  const [data, setData] = useState<CampaignIntelligenceResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async (keepError = false) => {
    setLoading(true); if (!keepError) setError("");
    try {
      const response = await fetch(`/api/admin/campaign-intelligence?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`, { cache: "no-store" });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) { setError(value.error || "Campaign analysis could not be loaded."); setData(null); return; }
      setData(value as CampaignIntelligenceResponse);
    } catch {
      setError("The server connection was interrupted.");
    } finally {
      setLoading(false);
    }
  }, [since, until]);

  /**
   * Pull fresh insights from Meta, then recompute. The analysis reads meta_ads_insights_daily,
   * so recomputing alone can only ever restate the last sync — which made a button labelled
   * "Refresh" look broken whenever Meta had moved on.
   */
  const syncThenLoad = useCallback(async () => {
    setSyncing(true); setError("");
    let failure = "";
    try {
      const response = await fetch("/api/admin/meta/sync", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ target: "insights" }),
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) failure = value.error || "Meta sync failed. The figures below are the last stored data.";
    } catch {
      failure = "Meta sync could not be reached. The figures below are the last stored data.";
    } finally {
      setSyncing(false);
    }
    // Recompute either way: a failed sync should still show what is stored, with the reason.
    await load(Boolean(failure));
    if (failure) setError(`${failure} Open the Meta tab to see the sync error in full.`);
  }, [csrfToken, load]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const counts = useMemo(() => Object.fromEntries(statusOrder.map((status) => [status, data?.analyses.filter((analysis) => analysis.decision.status === status).length ?? 0])) as Record<CampaignDecisionStatus, number>, [data]);
  const sorted = useMemo(() => [...(data?.analyses ?? [])].sort((a, b) => statusOrder.indexOf(a.decision.status) - statusOrder.indexOf(b.decision.status) || (b.kpis.advertising.spendMinor ?? 0) - (a.kpis.advertising.spendMinor ?? 0)), [data]);

  return <div className="campaign-intelligence-panel">
    <section className="admin-card campaign-manager-hero"><div><span className="admin-kicker">Deterministic campaign manager</span><h2>Decisions first. Evidence on demand.</h2><p>Meta performance, store attribution, COD delivery outcomes, and real margin are evaluated together. AI explains the rule-based result but cannot change it.</p></div><div className="campaign-freshness"><span className={data?.dataFreshness.stale ? "stale" : "fresh"}>{data?.dataFreshness.stale ? "Data needs attention" : "Data current"}</span><small>{data?.dataFreshness.note || "Checking Meta freshness…"}</small><button type="button" onClick={() => void syncThenLoad()} disabled={loading || syncing}>{syncing ? "Syncing Meta…" : loading ? "Analyzing…" : "Sync and refresh"}</button></div></section>

    <section className="admin-card filter-bar"><div className="filter-row"><div className="range-presets">{ranges.map(([label, days]) => <button key={label} type="button" className={Date.parse(until) - Date.parse(since) === days * 86_400_000 ? "active" : ""} onClick={() => { setSince(isoDay(-days)); setUntil(isoDay(0)); }}>{label}</button>)}</div><label>From<input type="date" value={since} max={until} onChange={(event) => setSince(event.target.value)} /></label><label>To<input type="date" value={until} min={since} onChange={(event) => setUntil(event.target.value)} /></label></div><p className="filter-note">Africa/Algiers · DZD · Store attribution uses last-touch utm_campaign name matching</p></section>

    {error && <div className="admin-alert error">{error}</div>}
    {loading && !data && <p className="chart-empty">Calculating deterministic campaign decisions…</p>}

    {data && <>
      <section className="campaign-decision-summary">{statusOrder.map((status) => <article className={`campaign-summary-${status.toLowerCase()}`} key={status}><span>{status}</span><strong>{counts[status]}</strong><small>campaign{counts[status] === 1 ? "" : "s"}</small></article>)}</section>
      {data.dataFreshness.stale && <div className="admin-alert warning"><strong>Meta data freshness warning.</strong> {data.dataFreshness.note}</div>}
      {data.unattributedOrders > 0 && (() => {
        const breakdown = data.unattributedBreakdown;
        // Une vente manuelle ou organique DOIT rester hors campagne : la compter gonflerait le
        // ROAS d'une vente que la publicite n'a pas amenee. Seules les deux autres causes sont
        // des pertes de mesure, et ce sont les seules a signaler comme telles.
        const lost = breakdown.unknownCampaign + breakdown.ambiguousCampaign;
        return <div className={`admin-alert ${lost > 0 ? "warning" : ""}`.trim()}>
          <strong>{data.unattributedOrders} commande(s) hors campagne.</strong>
          {breakdown.noCampaign > 0 && <> {breakdown.noCampaign} sans attribution (vente manuelle, trafic direct) — exclusion normale, ne rien faire.</>}
          {breakdown.unknownCampaign > 0 && <> {breakdown.unknownCampaign} avec un nom de campagne inconnu de Meta — mesure perdue, le CPA de la campagne est surestime.</>}
          {breakdown.ambiguousCampaign > 0 && <> {breakdown.ambiguousCampaign} avec un nom porte par plusieurs campagnes Meta — renommez-les pour les distinguer.</>}
          {breakdown.unmatchedNames.length > 0 && <><br /><small>Noms concernes : {breakdown.unmatchedNames.join(", ")}</small></>}
        </div>;
      })()}
      {sorted.length === 0 ? <section className="admin-card campaign-empty"><h2>No campaign data for this period</h2><p>Run a Meta Insights sync, then return here. The manager never invents campaigns or spend.</p></section> : <div className="campaign-card-list">{sorted.map((analysis) => <CampaignCard key={analysis.entity.id} analysis={analysis} />)}</div>}
      <section className="admin-card campaign-method-note"><strong>Interpretation guardrails</strong><ul>{data.notes.map((note) => <li key={note}>{note}</li>)}</ul></section>
    </>}
  </div>;
}
