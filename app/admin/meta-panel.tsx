"use client";

import { useCallback, useEffect, useState } from "react";
import FxRatesCard from "./fx-rates-card";

type Status = {
  config: { trackingEnabled: boolean; adminDisabled: boolean; pixelConfigured: boolean; capiConfigured: boolean; graphApiVersion: string; testEventCodeActive: boolean; adAccountConfigured: boolean; catalogConfigured: boolean; businessConfigured: boolean };
  syncState: Array<{ syncKey: string; lastRunAt: string | null; lastSuccessAt: string | null; lastError: string | null }>;
  coverage: { total: number; pixelOnly: number; capiOnly: number; deduplicated: number; failed: number };
  catalog: { published?: number; synced?: number; failed?: number; neverSynced?: number; failures?: Array<{ retailerId: string; error: string }>; error?: string };
  recentErrors: Array<{ eventName: string; status: number | null; error: string | null; at: string }>;
  /** Currency of the last synced spend; "" while nothing has been synced. */
  spendCurrency: string;
};
type Check = { name: string; ok: boolean; detail: string };

const when = (value: string | null) => {
  if (!value) return "jamais";
  const hours = (Date.now() - Date.parse(value)) / 3_600_000;
  const stamp = new Date(value).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  if (hours < 1) return `${stamp} (il y a moins d’une heure)`;
  return `${stamp} (il y a ${Math.round(hours)} h)`;
};
const freshness = (value: string | null) => {
  if (!value) return "failed";
  const hours = (Date.now() - Date.parse(value)) / 3_600_000;
  return hours > 48 ? "failed" : hours > 26 ? "draft" : "published";
};

export default function MetaPanel({ csrfToken, onNotice, onError }: { csrfToken: string; onNotice: (message: string) => void; onError: (message: string) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/meta/status", { cache: "no-store" });
      const value = await response.json().catch(() => ({}));
      if (response.ok) setStatus(value as Status); else onError(value.error || "Statut Meta indisponible.");
    } catch { onError("Connexion au serveur impossible."); }
  }, [onError]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function post(url: string, body: unknown, label: string) {
    setBusy(label); onError(""); onNotice("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify(body) });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) { onError(value.error || "Action impossible."); return null; }
      await load();
      return value;
    } catch { onError("Connexion au serveur impossible."); return null; }
    finally { setBusy(""); }
  }

  if (!status) return <p className="chart-empty">Chargement de l’état Meta…</p>;
  const { config, coverage, catalog } = status;

  return <div className="meta-panel">
    <section className="admin-card">
      <div className="card-title">
        <div><h2>Connexion Meta</h2><p>Les identifiants restent côté serveur, dans les variables d’environnement.</p></div>
        <span className={`status ${config.trackingEnabled ? "published" : "draft"}`}>{config.trackingEnabled ? "Suivi actif" : config.adminDisabled ? "Désactivé par l’administrateur" : "Suivi inactif"}</span>
      </div>
      <div className="asset-grid">
        {[
          ["Pixel / Dataset", config.pixelConfigured],
          ["Conversions API", config.capiConfigured],
          ["Compte publicitaire", config.adAccountConfigured],
          ["Catalogue produit", config.catalogConfigured],
          ["Business Portfolio", config.businessConfigured],
        ].map(([label, ok]) => (
          <div key={String(label)} className="asset-item">
            <span className={`dot ${ok ? "ok" : "off"}`} aria-hidden="true" />
            <div><strong>{String(label)}</strong><small>{ok ? "Configuré" : "Non configuré"}</small></div>
          </div>
        ))}
        <div className="asset-item"><span className="dot ok" aria-hidden="true" /><div><strong>Graph API</strong><small>{config.graphApiVersion}</small></div></div>
      </div>
      {config.testEventCodeActive && <p className="metric-note warning-note">Un code Test Events est actif : les événements ne comptent pas comme conversions réelles.</p>}
      <div className="meta-actions">
        <button type="button" disabled={busy !== ""} onClick={async () => { const value = await post("/api/admin/meta/test-connection", {}, "test"); if (value) { setChecks(value.checks as Check[]); onNotice(value.ok ? "Connexion Meta vérifiée." : "Des vérifications ont échoué."); } }}>{busy === "test" ? "Test…" : "Tester la connexion"}</button>
        <button type="button" disabled={busy !== ""} onClick={async () => { const value = await post("/api/admin/meta/sync", { target: "insights" }, "insights"); if (value) onNotice("Synchronisation des insights terminée."); }}>{busy === "insights" ? "Synchro…" : "Synchroniser les insights"}</button>
        <button type="button" disabled={busy !== ""} onClick={async () => { const value = await post("/api/admin/meta/sync", { target: "catalog" }, "catalog"); if (value) onNotice(`Catalogue : ${value.result.created} créé(s), ${value.result.updated} mis à jour, ${value.result.failed} refusé(s).`); }}>{busy === "catalog" ? "Synchro…" : "Synchroniser le catalogue"}</button>
        <button type="button" className={config.adminDisabled ? "admin-primary" : "danger-button"} disabled={busy !== ""}
          onClick={async () => {
            if (!config.adminDisabled && !window.confirm("Désactiver le suivi ? Le Pixel ne sera plus chargé et aucun événement ne sera envoyé.")) return;
            const value = await post("/api/admin/meta/tracking", { disabled: !config.adminDisabled }, "toggle");
            if (value) onNotice(value.note as string);
          }}>{config.adminDisabled ? "Réactiver le suivi" : "Désactiver le suivi"}</button>
      </div>
      {checks && <ul className="check-list">{checks.map((check) => <li key={check.name} className={check.ok ? "ok" : "failed"}><b>{check.name}</b><span>{check.detail}</span></li>)}</ul>}
    </section>

    <FxRatesCard csrfToken={csrfToken} spendCurrency={status.spendCurrency ?? ""} onNotice={onNotice} onError={onError} />

    <div className="analytics-columns">
      <section className="admin-card">
        <div className="card-title"><div><h2>Fraîcheur des données</h2><p>Dernière synchronisation réussie par tâche.</p></div></div>
        {status.syncState.length === 0 ? <p className="chart-empty">Aucune synchronisation enregistrée.</p> : <table className="chart-table">
          <thead><tr><th scope="col">Tâche</th><th scope="col">Dernier succès</th><th scope="col">État</th></tr></thead>
          <tbody>{status.syncState.map((state) => <tr key={state.syncKey}>
            <th scope="row">{state.syncKey}</th>
            <td>{when(state.lastSuccessAt)}</td>
            <td><span className={`status ${freshness(state.lastSuccessAt)}`}>{state.lastError ? "En erreur" : state.lastSuccessAt ? "À jour" : "Jamais"}</span>{state.lastError && <small className="cell-note">{state.lastError}</small>}</td>
          </tr>)}</tbody>
        </table>}

        <h3 className="subhead">Catalogue</h3>
        {catalog.error ? <p className="metric-note">{catalog.error}</p> : <dl className="metric-list">
          <div><dt>Produits publiés</dt><dd>{catalog.published ?? 0}</dd></div>
          <div><dt>Synchronisés</dt><dd>{catalog.synced ?? 0}</dd></div>
          <div><dt>Jamais synchronisés</dt><dd>{catalog.neverSynced ?? 0}</dd></div>
          <div><dt>Refusés par Meta</dt><dd>{catalog.failed ?? 0}</dd></div>
        </dl>}
        {catalog.failures && catalog.failures.length > 0 && <ul className="failure-list">{catalog.failures.slice(0, 8).map((failure) => <li key={failure.retailerId}><b>{failure.retailerId}</b><span>{failure.error}</span></li>)}</ul>}
      </section>

      <section className="admin-card">
        <div className="card-title"><div><h2>Diagnostic du suivi</h2><p>Couverture Pixel / CAPI sur les 50 derniers événements d’achat.</p></div></div>
        <dl className="metric-list">
          <div><dt>Achats suivis</dt><dd>{coverage.total}</dd></div>
          <div><dt>Dédupliqués (Pixel + CAPI)</dt><dd>{coverage.deduplicated}</dd></div>
          <div><dt>Pixel seul</dt><dd>{coverage.pixelOnly}</dd></div>
          <div><dt>CAPI seule</dt><dd>{coverage.capiOnly}</dd></div>
          <div><dt>Envois en échec</dt><dd>{coverage.failed}</dd></div>
        </dl>
        <p className="metric-note">Un achat vu par les deux canaux avec le même event_id ne compte qu’une fois côté Meta.</p>

        <h3 className="subhead">Erreurs récentes</h3>
        {status.recentErrors.length === 0
          ? <p className="metric-note">Aucune erreur enregistrée.</p>
          : <ul className="failure-list">{status.recentErrors.map((entry, index) => <li key={`${entry.at}-${index}`}><b>{entry.eventName} · {entry.status ?? "—"}</b><span>{entry.error}</span></li>)}</ul>}
        <p className="metric-note">Les messages sont expurgés : aucune donnée personnelle n’y figure.</p>
      </section>
    </div>
  </div>;
}
