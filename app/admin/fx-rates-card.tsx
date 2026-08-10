"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Manual entry of the DZD value of one unit of the ad account's currency.
 *
 * Conversion is per spend day, so a single rate covers a single day. Entering one rate at a
 * time would be unusable over a month of spend, hence the date range: it writes the same rate
 * to every day it covers. The rate is never guessed and never carried forward — a day with no
 * rate leaves that day's profit unavailable rather than showing an invented number.
 */

type Rate = { rateDate: string; currency: string; dzdPerUnit: number; source: string };

const REPORTING_TIMEZONE = "Africa/Algiers";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: REPORTING_TIMEZONE }).format(new Date());

/** Inclusive list of ISO days between two dates. Built in UTC so no DST shift can drop a day. */
function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let cursor = Date.parse(`${from}T00:00:00Z`); cursor <= end; cursor += 86_400_000) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return days;
}

const KNOWN_CURRENCIES = ["USD", "EUR", "GBP", "SAR", "AED"];

export default function FxRatesCard({ csrfToken, spendCurrency, onNotice, onError }: {
  csrfToken: string;
  /**
   * Currency of the last synced spend. "" means no spend is recorded yet, so the currency is
   * unknown and the admin selects it; it is never assumed.
   */
  spendCurrency: string;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const detected = spendCurrency.trim().toUpperCase();
  const [currency, setCurrency] = useState(detected || "USD");
  const [rates, setRates] = useState<Rate[] | null>(null);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/finance/fx-rates?currency=${encodeURIComponent(currency)}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (response.ok) setRates(body.rates as Rate[]); else onError(body.error || "Taux indisponibles.");
    } catch { onError("Connexion au serveur impossible."); }
  }, [currency, onError]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  // Nothing to convert when Meta already bills in the reporting currency.
  if (detected === "DZD") return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    onError(""); onNotice("");

    const rate = Number(value.replace(",", "."));
    if (!Number.isFinite(rate) || rate <= 0) { onError("Le taux doit être un nombre supérieur à zéro."); return; }
    if (rate > 100_000) { onError("Taux invalide : au-delà de 100 000 DZD pour une unité."); return; }
    if (from > to) { onError("La date de début est postérieure à la date de fin."); return; }

    const days = daysBetween(from, to);
    if (days.length > 400) { onError(`Période trop longue : ${days.length} jours, maximum 400.`); return; }

    setBusy(true);
    try {
      const response = await fetch("/api/admin/finance/fx-rates", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ rates: days.map((rateDate) => ({ rateDate, currency, dzdPerUnit: rate })) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { onError(body.error || "Enregistrement impossible."); return; }
      onNotice(days.length === 1 ? `Taux enregistré pour le ${days[0]}.` : `Taux appliqué à ${days.length} jours.`);
      setValue("");
      await load();
    } catch { onError("Connexion au serveur impossible."); }
    finally { setBusy(false); }
  }

  const latest = rates?.[0];

  return <section className="admin-card">
    <div className="card-title">
      <div>
        <h2>Taux de change {currency} → DZD</h2>
        <p>{detected
          ? `Votre compte publicitaire est facturé en ${detected}. Sans taux pour un jour donné, le profit de ce jour reste indisponible.`
          : "Aucune dépense synchronisée pour l’instant, donc la devise de facturation n’est pas encore connue : choisissez-la."}</p>
      </div>
      <span className={`status ${latest ? "published" : "draft"}`}>{latest ? `Dernier : ${latest.dzdPerUnit} DZD` : "Aucun taux"}</span>
    </div>

    <form onSubmit={submit}>
      {!detected && <div className="form-row">
        <label>Devise du compte publicitaire
          <select value={currency} onChange={(event) => { setCurrency(event.target.value); setRates(null); }}>
            {KNOWN_CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        </label>
      </div>}
      <div className="form-row three">
        <label>Taux — 1 {currency} vaut, en DZD
          <input inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} placeholder="262.50" required />
        </label>
        <label>Du
          <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} required />
        </label>
        <label>Au
          <input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} required />
        </label>
      </div>
      <p className="metric-note">
        Saisissez le taux auquel vous changez réellement votre argent, pas le cours officiel : c&rsquo;est celui-là qui
        détermine ce que votre publicité vous coûte. Une même valeur peut couvrir plusieurs jours d&rsquo;un coup.
      </p>
      <div className="meta-actions">
        <button type="submit" className="admin-primary" disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer le taux"}</button>
      </div>
    </form>

    <h3 className="subhead">Taux enregistrés</h3>
    {rates === null
      ? <p className="chart-empty">Chargement…</p>
      : rates.length === 0
        ? <p className="metric-note">Aucun taux enregistré. Tant qu&rsquo;il n&rsquo;y en a pas, profit après publicité, ROI et capital restent vides.</p>
        : <table className="chart-table">
          <thead><tr><th scope="col">Date</th><th scope="col">1 {currency} en DZD</th><th scope="col">Source</th></tr></thead>
          <tbody>{rates.slice(0, 15).map((rate) => <tr key={`${rate.rateDate}-${rate.currency}`}>
            <th scope="row">{rate.rateDate}</th>
            <td>{rate.dzdPerUnit}</td>
            <td>{rate.source === "manual" ? "Saisie manuelle" : rate.source}</td>
          </tr>)}</tbody>
        </table>}
    {rates && rates.length > 15 && <p className="metric-note">{rates.length} taux enregistrés, les 15 plus récents sont affichés.</p>}
  </section>;
}
