"use client";

import { useId, useState } from "react";

/**
 * Charts are hand-rolled inline SVG: no charting dependency for three chart types.
 *
 * Palette validated with the dataviz validator against the #ffffff card surface
 * (categorical slots blue/orange/aqua, all-pairs: CVD ΔE 9.2, normal-vision ΔE 24.0).
 * Aqua sits below 3:1 contrast, so the relief rule applies — every series carries a
 * direct label AND a table view is always available.
 */

export const SERIES = { revenue: "#2a78d6", spend: "#eb6834", profit: "#1baf7a" } as const;
export const DIVERGING = { positive: "#2a78d6", negative: "#e34948", neutral: "#8a8f98" } as const;

const money = (minor: number) => new Intl.NumberFormat("fr-DZ", { style: "currency", currency: "DZD", maximumFractionDigits: 0 }).format(minor / 100);
const compact = (minor: number) => new Intl.NumberFormat("fr-DZ", { notation: "compact", maximumFractionDigits: 1 }).format(minor / 100);
const dayLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", timeZone: "UTC" });

export type SeriesPoint = { date: string; values: Record<string, number | null> };

/**
 * Multi-series line chart with a crosshair tooltip.
 * Single y-axis by construction: every series here is DZD, so no dual axis is possible.
 */
export function LineChart({ points, series, title, emptyLabel }: {
  points: SeriesPoint[];
  series: Array<{ key: string; label: string; color: string }>;
  title: string;
  emptyLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useId();
  if (!points.length) return <p className="chart-empty">{emptyLabel}</p>;

  const width = 760;
  const height = 260;
  const pad = { top: 16, right: 16, bottom: 28, left: 56 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;

  const all = points.flatMap((point) => series.map((entry) => point.values[entry.key]).filter((value): value is number => value != null));
  const rawMax = all.length ? Math.max(...all, 0) : 0;
  const rawMin = all.length ? Math.min(...all, 0) : 0;
  // A flat all-zero series must not divide by zero.
  const max = rawMax === rawMin ? rawMax + 1 : rawMax;
  const min = rawMax === rawMin ? rawMin - 1 : rawMin;
  const x = (index: number) => pad.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const y = (value: number) => pad.top + plotHeight - ((value - min) / (max - min)) * plotHeight;

  const ticks = [min, min + (max - min) / 2, max];
  const active = hover != null ? points[hover] : null;

  return (
    <figure className="chart-figure">
      <figcaption className="chart-caption">
        <span>{title}</span>
        <span className="chart-legend">
          {series.map((entry) => <span key={entry.key}><i style={{ background: entry.color }} aria-hidden="true" />{entry.label}</span>)}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} className="chart-svg"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - box.left) / box.width;
          const index = Math.round(((ratio * width) - pad.left) / plotWidth * (points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, index)));
        }}>
        <defs><clipPath id={clipId}><rect x={pad.left} y={pad.top} width={plotWidth} height={plotHeight} /></clipPath></defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke="#e4e8ed" strokeWidth="1" />
            <text x={pad.left - 8} y={y(tick) + 4} textAnchor="end" className="chart-axis-text">{compact(tick)}</text>
          </g>
        ))}
        {min < 0 && <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} stroke="#b9c0c9" strokeWidth="1" />}
        <g clipPath={`url(#${clipId})`}>
          {series.map((entry) => {
            // Gaps: a null (unconvertible spend) breaks the line instead of dropping to zero.
            const segments: string[] = [];
            let current = "";
            points.forEach((point, index) => {
              const value = point.values[entry.key];
              if (value == null) { if (current) segments.push(current); current = ""; return; }
              current += `${current ? "L" : "M"}${x(index)},${y(value)}`;
            });
            if (current) segments.push(current);
            return segments.map((path, index) => <path key={`${entry.key}-${index}`} d={path} fill="none" stroke={entry.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />);
          })}
        </g>
        {active && (
          <g>
            <line x1={x(hover!)} x2={x(hover!)} y1={pad.top} y2={pad.top + plotHeight} stroke="#98a1ad" strokeWidth="1" strokeDasharray="3 3" />
            {series.map((entry) => {
              const value = active.values[entry.key];
              return value == null ? null : <circle key={entry.key} cx={x(hover!)} cy={y(value)} r="4.5" fill={entry.color} stroke="#fff" strokeWidth="2" />;
            })}
          </g>
        )}
        {points.length > 1 && [0, points.length - 1].map((index) => (
          <text key={index} x={x(index)} y={height - 8} textAnchor={index === 0 ? "start" : "end"} className="chart-axis-text">{dayLabel(points[index].date)}</text>
        ))}
      </svg>
      {active && (
        <div className="chart-tooltip" role="status">
          <strong>{dayLabel(active.date)}</strong>
          {series.map((entry) => (
            <span key={entry.key}><i style={{ background: entry.color }} aria-hidden="true" />{entry.label} : <b>{active.values[entry.key] == null ? "indisponible" : money(active.values[entry.key]!)}</b></span>
          ))}
        </div>
      )}
    </figure>
  );
}

/** Profit waterfall. Diverging: blue adds, red subtracts, gray for subtotals. */
export function Waterfall({ steps, title }: { steps: Array<{ label: string; amountMinor: number; kind: "add" | "subtract" | "total" }>; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!steps.length) return <p className="chart-empty">Aucune donnée à afficher.</p>;

  const width = 760;
  const height = 280;
  const pad = { top: 18, right: 16, bottom: 58, left: 56 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const barWidth = Math.min(72, (plotWidth / steps.length) - 12);

  // Running total: totals reset the baseline, adds and subtracts stack from it.
  // Built with a plain loop so no accumulator is captured by a render-time callback.
  const bars: Array<(typeof steps)[number] & { from: number; to: number }> = [];
  let running = 0;
  for (const step of steps) {
    if (step.kind === "total") {
      running = step.amountMinor;
      bars.push({ ...step, from: 0, to: step.amountMinor });
      continue;
    }
    const from = running;
    running += step.kind === "add" ? step.amountMinor : -step.amountMinor;
    bars.push({ ...step, from, to: running });
  }

  const values = bars.flatMap((bar) => [bar.from, bar.to, 0]);
  const rawMax = Math.max(...values);
  const rawMin = Math.min(...values);
  const max = rawMax === rawMin ? rawMax + 1 : rawMax;
  const min = rawMax === rawMin ? rawMin - 1 : rawMin;
  const y = (value: number) => pad.top + plotHeight - ((value - min) / (max - min)) * plotHeight;
  const x = (index: number) => pad.left + (index + 0.5) * (plotWidth / steps.length) - barWidth / 2;
  const color = (kind: string) => kind === "total" ? DIVERGING.neutral : kind === "add" ? DIVERGING.positive : DIVERGING.negative;

  return (
    <figure className="chart-figure">
      <figcaption className="chart-caption"><span>{title}</span></figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} className="chart-svg">
        <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} stroke="#b9c0c9" strokeWidth="1" />
        {bars.map((bar, index) => {
          const top = Math.min(y(bar.from), y(bar.to));
          const barHeight = Math.max(2, Math.abs(y(bar.to) - y(bar.from)));
          return (
            <g key={bar.label} onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)}>
              {/* Hit target is the full column, taller than the bar itself. */}
              <rect x={x(index) - 6} y={pad.top} width={barWidth + 12} height={plotHeight} fill="transparent" />
              <rect x={x(index)} y={top} width={barWidth} height={barHeight} rx="4" fill={color(bar.kind)} opacity={hover == null || hover === index ? 1 : 0.55} />
              <text x={x(index) + barWidth / 2} y={top - 6} textAnchor="middle" className="chart-value-text">{compact(bar.kind === "total" ? bar.to : bar.amountMinor)}</text>
              <text x={x(index) + barWidth / 2} y={height - 34} textAnchor="middle" className="chart-axis-text">{bar.label.split(" ")[0]}</text>
              <text x={x(index) + barWidth / 2} y={height - 20} textAnchor="middle" className="chart-axis-text">{bar.label.split(" ").slice(1).join(" ")}</text>
            </g>
          );
        })}
      </svg>
      {hover != null && <div className="chart-tooltip" role="status"><strong>{bars[hover].label}</strong><span>{money(bars[hover].kind === "total" ? bars[hover].to : bars[hover].amountMinor)}</span></div>}
    </figure>
  );
}

/** COD funnel. Sequential single hue: magnitude, more-is-darker. */
export function Funnel({ stages, title }: { stages: Array<{ label: string; value: number; note?: string }>; title: string }) {
  const max = Math.max(...stages.map((stage) => stage.value), 1);
  const ramp = ["#0d366b", "#184f95", "#256abf", "#3987e5", "#6da7ec", "#9ec5f4"];
  return (
    <figure className="chart-figure">
      <figcaption className="chart-caption"><span>{title}</span></figcaption>
      <div className="funnel">
        {stages.map((stage, index) => (
          <div className="funnel-row" key={stage.label}>
            <span className="funnel-label">{stage.label}</span>
            <div className="funnel-track">
              <div className="funnel-bar" style={{ width: `${Math.max(1.5, (stage.value / max) * 100)}%`, background: ramp[Math.min(index, ramp.length - 1)] }} />
            </div>
            <span className="funnel-value">{stage.value}{stage.note && <small>{stage.note}</small>}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

/** Table view. Required relief for the sub-3:1 series colour, and useful on its own. */
export function SeriesTable({ points, series }: { points: SeriesPoint[]; series: Array<{ key: string; label: string }> }) {
  return (
    <div className="chart-table-wrap">
      <table className="chart-table">
        <thead><tr><th scope="col">Jour</th>{series.map((entry) => <th scope="col" key={entry.key}>{entry.label}</th>)}</tr></thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.date}>
              <th scope="row">{dayLabel(point.date)}</th>
              {series.map((entry) => <td key={entry.key}>{point.values[entry.key] == null ? "—" : money(point.values[entry.key]!)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
