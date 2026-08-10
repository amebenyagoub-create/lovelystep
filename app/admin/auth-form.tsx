"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function AdminAuthForm({ mode }: { mode: "setup" | "login" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    if (mode === "setup" && password !== form.get("confirm")) { setError("Les mots de passe ne correspondent pas."); setBusy(false); return; }
    try {
      const response = await fetch(`/api/admin/${mode === "setup" ? "setup" : "login"}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.error || "Connexion impossible."); return; }
      router.replace("/admin");
    } catch {
      setError("Connexion au serveur impossible. Réessayez dans quelques instants.");
    } finally {
      setBusy(false);
    }
  }
  return <main className="admin-auth"><section><Link href="/"><Image src="/brand/lovelystep-logo.png" alt="Lovely Step" width={150} height={150} priority /></Link><span className="admin-kicker">Administration sécurisée</span><h1>{mode === "setup" ? "Créer le premier compte" : "Bienvenue"}</h1><p>{mode === "setup" ? "Aucun mot de passe par défaut : choisissez maintenant les accès du propriétaire." : "Connectez-vous pour gérer les produits, commandes et imports."}</p><form onSubmit={submit}><label>E-mail administrateur<input name="email" type="email" autoComplete="username" required /></label><label>Mot de passe<input name="password" type="password" autoComplete={mode === "setup" ? "new-password" : "current-password"} minLength={mode === "setup" ? 12 : undefined} required /></label>{mode === "setup" && <label>Confirmer le mot de passe<input name="confirm" type="password" autoComplete="new-password" minLength={12} required /></label>}{error && <p className="form-error">{error}</p>}<button className="primary-button full" disabled={busy}>{busy ? "Patientez…" : mode === "setup" ? "Créer et sécuriser le dashboard" : "Se connecter"}</button></form><small>{mode === "setup" ? "Utilisez au moins 12 caractères. Le mot de passe est chiffré avant stockage." : "Après 5 échecs, les tentatives sont bloquées 15 minutes."}</small><Link className="back-store" href="/">← Retour à la boutique</Link></section></main>;
}
