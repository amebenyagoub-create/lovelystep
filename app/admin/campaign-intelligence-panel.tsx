"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CampaignAnalysis, CampaignDecisionStatus, CampaignIntelligenceResponse } from "@/lib/campaign-intelligence/types";

const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000 + 3_600_000).toISOString().slice(0, 10);
const money = (minor: number | null) => minor === null || !Number.isFinite(minor) ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "DZD", maximumFractionDigits: 0 }).format(minor / 100);
const number = (value: number | null, suffix = "", digits = 1) => value === null || !Number.isFinite(value) ? "—" : `${value.toFixed(digits)}${suffix}`;
const statusOrder: CampaignDecisionStatus[] = ["KILL", "WATCH", "SCALE", "KEEP"];
const ranges: Array<[string, number]> = [["7 days", 6], ["30 days", 29], ["90 days", 89]];

function Metric({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return <div><dt>{label}</dt><dd>{value}{note && <small>{note}</small>}</dd></div>;
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
        <strong className="campaign-next-action">Next action: {explanation.nextAction}</strong>
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

    <details className="campaign-details">
      <summary>Details and diagnostic evidence</summary>
      <div className="campaign-detail-grid">
        <section><h3>Advertising</h3><dl className="metric-list">
          <Metric label="Impressions" value={kpis.advertising.impressions.toLocaleString("en-US")} />
          <Metric label="Daily reach sum" value={kpis.advertising.reach.toLocaleString("en-US")} />
          <Metric label="Frequency" value={number(kpis.advertising.frequency, "", 2)} />
          <Metric label="Link clicks" value={kpis.advertising.linkClicks.toLocaleString("en-US")} />
          <Metric label="CTR" value={number(kpis.advertising.ctrPercent, "%")} />
          <Metric label="CPC" value={money(kpis.advertising.cpcMinor)} />
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

export default function CampaignIntelligencePanel() {
  const [since, setSince] = useState(isoDay(-29));
  const [until, setUntil] = useState(isoDay(0));
  const [data, setData] = useState<CampaignIntelligenceResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
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
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const counts = useMemo(() => Object.fromEntries(statusOrder.map((status) => [status, data?.analyses.filter((analysis) => analysis.decision.status === status).length ?? 0])) as Record<CampaignDecisionStatus, number>, [data]);
  const sorted = useMemo(() => [...(data?.analyses ?? [])].sort((a, b) => statusOrder.indexOf(a.decision.status) - statusOrder.indexOf(b.decision.status) || (b.kpis.advertising.spendMinor ?? 0) - (a.kpis.advertising.spendMinor ?? 0)), [data]);

  return <div className="campaign-intelligence-panel">
    <section className="admin-card campaign-manager-hero"><div><span className="admin-kicker">Deterministic campaign manager</span><h2>Decisions first. Evidence on demand.</h2><p>Meta performance, store attribution, COD delivery outcomes, and real margin are evaluated together. AI explains the rule-based result but cannot change it.</p></div><div className="campaign-freshness"><span className={data?.dataFreshness.stale ? "stale" : "fresh"}>{data?.dataFreshness.stale ? "Data needs attention" : "Data current"}</span><small>{data?.dataFreshness.note || "Checking Meta freshness…"}</small><button type="button" onClick={() => void load()} disabled={loading}>{loading ? "Analyzing…" : "Refresh analysis"}</button></div></section>

    <section className="admin-card filter-bar"><div className="filter-row"><div className="range-presets">{ranges.map(([label, days]) => <button key={label} type="button" className={Date.parse(until) - Date.parse(since) === days * 86_400_000 ? "active" : ""} onClick={() => { setSince(isoDay(-days)); setUntil(isoDay(0)); }}>{label}</button>)}</div><label>From<input type="date" value={since} max={until} onChange={(event) => setSince(event.target.value)} /></label><label>To<input type="date" value={until} min={since} onChange={(event) => setUntil(event.target.value)} /></label></div><p className="filter-note">Africa/Algiers · DZD · Store attribution uses last-touch utm_campaign name matching</p></section>

    {error && <div className="admin-alert error">{error}</div>}
    {loading && !data && <p className="chart-empty">Calculating deterministic campaign decisions…</p>}

    {data && <>
      <section className="campaign-decision-summary">{statusOrder.map((status) => <article className={`campaign-summary-${status.toLowerCase()}`} key={status}><span>{status}</span><strong>{counts[status]}</strong><small>campaign{counts[status] === 1 ? "" : "s"}</small></article>)}</section>
      {data.dataFreshness.stale && <div className="admin-alert warning"><strong>Meta data freshness warning.</strong> {data.dataFreshness.note}</div>}
      {data.unattributedOrders > 0 && <div className="admin-alert warning"><strong>{data.unattributedOrders} order(s) are not uniquely matched to a Meta campaign.</strong> Add a unique utm_campaign matching the Meta campaign name.</div>}
      {sorted.length === 0 ? <section className="admin-card campaign-empty"><h2>No campaign data for this period</h2><p>Run a Meta Insights sync, then return here. The manager never invents campaigns or spend.</p></section> : <div className="campaign-card-list">{sorted.map((analysis) => <CampaignCard key={analysis.entity.id} analysis={analysis} />)}</div>}
      <section className="admin-card campaign-method-note"><strong>Interpretation guardrails</strong><ul>{data.notes.map((note) => <li key={note}>{note}</li>)}</ul></section>
    </>}
  </div>;
}
