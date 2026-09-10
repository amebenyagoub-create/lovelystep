"use client";

import { FormEvent, useMemo, useState } from "react";
import type { DeliveryRate, Product } from "@/lib/types";

type TestResult = { reply: string; action: string; model: string };

const ACTION_LABELS: Record<string, string> = {
  confirm_order: "Confirmer la commande",
  cancel_order: "Annuler la commande",
  update_delivery_info: "Modifier les informations de livraison",
  reschedule_order: "Recontacter plus tard",
  answer_question: "Répondre à la question",
  escalate_to_human: "Transférer à un humain",
};

export default function AgentTestPanel({ products, rates, csrfToken, onError }: {
  products: Product[];
  rates: DeliveryRate[];
  csrfToken: string;
  onError: (message: string) => void;
}) {
  const published = useMemo(() => products.filter((product) => product.status === "published"), [products]);
  const activeRates = useMemo(() => rates.filter((rate) => rate.active), [rates]);
  const [productId, setProductId] = useState(String(published[0]?.id || ""));
  const [wilayaCode, setWilayaCode] = useState(activeRates[0]?.wilayaCode || "");
  const [deliveryType, setDeliveryType] = useState<"home" | "office">("home");
  const [model, setModel] = useState("deepseek-v4-flash");
  const [message, setMessage] = useState("ch7al w wach kayna taille 3 ans?");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    onError("");
    try {
      const response = await fetch("/api/admin/agent-test", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ message, productId: Number(productId), wilayaCode, deliveryType, model }),
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) { onError(value.error || "Test impossible."); return; }
      setResult({ reply: String(value.reply || ""), action: String(value.action || ""), model: String(value.model || model) });
    } catch {
      onError("Connexion à l’agent impossible.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="agent-test-panel">
    <section className="admin-card agent-test-intro">
      <div><span className="admin-kicker">Bac à sable privé</span><h2>Tester l’agent avec les vraies données</h2></div>
      <p>L’agent lit le catalogue, les prix, les couleurs, les tailles, le stock et les tarifs de livraison actuels. Ce test n’envoie aucun message WhatsApp et ne modifie aucune commande.</p>
    </section>
    <section className="admin-card agent-test-grid">
      <form className="agent-test-form" onSubmit={submit}>
        <label>Produit
          <select value={productId} onChange={(event) => setProductId(event.target.value)} required>
            {published.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
        </label>
        <label>Wilaya
          <select value={wilayaCode} onChange={(event) => setWilayaCode(event.target.value)} required>
            {activeRates.map((rate) => <option key={rate.wilayaCode} value={rate.wilayaCode}>{rate.wilayaCode} · {rate.wilayaNameFr}</option>)}
          </select>
        </label>
        <label>Livraison
          <select value={deliveryType} onChange={(event) => setDeliveryType(event.target.value as "home" | "office")}>
            <option value="home">À domicile</option>
            <option value="office">Au bureau</option>
          </select>
        </label>
        <label>Modèle
          <select value={model} onChange={(event) => setModel(event.target.value)}>
            <option value="deepseek-v4-flash">DeepSeek V4 Flash</option>
            <option value="gpt-5.6-sol">GPT-5.6 Sol</option>
          </select>
        </label>
        <label className="agent-test-message">Message du client
          <textarea value={message} maxLength={1_000} rows={5} onChange={(event) => setMessage(event.target.value)} placeholder="Ex. ch7al w wach kayna taille 3 ans?" required />
        </label>
        <button className="admin-primary" type="submit" disabled={busy || !published.length || !activeRates.length}>{busy ? "L’agent réfléchit…" : "Tester sans envoyer"}</button>
      </form>
      <div className="agent-test-output" aria-live="polite">
        <span>Réponse simulée</span>
        {result ? <>
          <blockquote>{result.reply || "L’agent a demandé une intervention humaine sans envoyer de réponse."}</blockquote>
          <dl><div><dt>Action choisie</dt><dd>{ACTION_LABELS[result.action] || result.action}</dd></div><div><dt>Modèle</dt><dd>{result.model}</dd></div></dl>
        </> : <p>Choisissez un produit puis écrivez comme un vrai client : français, arabe ou Darija en Arabizi.</p>}
      </div>
    </section>
  </div>;
}
