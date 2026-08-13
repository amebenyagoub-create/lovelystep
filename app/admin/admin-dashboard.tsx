"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, DragEvent, FormEvent, useCallback, useEffect, useId, useMemo, useState } from "react";
import type { DeliveryRate, ImportJob, LocalizedText, Order, OrderStatus, Product, ProductSize, ProductTestimonial, ProductVariant, StoreSettings } from "@/lib/types";
import { frenchAgeLabel } from "@/lib/product-size";
import AnalyticsPanel from "./analytics-panel";
import CampaignIntelligencePanel from "./campaign-intelligence-panel";
import MetaPanel from "./meta-panel";
import WhatsAppPanel from "./whatsapp-panel";

type AdminData = { admin: { email: string }; csrfToken: string; stats: { products: number; published: number; newOrders: number; orders: number; deliveredRevenueCents: number; grossProfitCents: number; visitors30d: number; repeatBuyerRate: number; inventoryUnits: number }; meta: { pixelConfigured: boolean; insightsConfigured: boolean }; whatsapp: { businessNumberConfigured: boolean; graphApiVersion: string; messagingConfigured: boolean; ready: boolean; webhookConfigured: boolean; webhookUrl: string }; zrExpress: { apiKeyConfigured: boolean; tenantConfigured: boolean; ready: boolean }; products: Product[]; orders: Order[]; imports: ImportJob[]; storeSettings: StoreSettings; deliveryRates: DeliveryRate[] };
type Tab = "overview" | "analytics" | "campaigns" | "meta" | "whatsapp" | "orders" | "products" | "import" | "store" | "delivery";
type Provider = "auto" | "gemini" | "groq";
type AiStatus = Record<"gemini" | "groq", { ok: boolean; model: string; message: string }>;
const money = (cents: number) => new Intl.NumberFormat("fr-DZ", { style: "currency", currency: "DZD", maximumFractionDigits: 0 }).format(cents / 100);
const orderLabels: Record<OrderStatus, string> = { new: "Nouvelle", to_confirm: "À confirmer", confirmed: "Confirmée", preparing: "Préparation", shipped: "Expédiée", delivered: "Livrée", refused: "Refusée", returned: "Retournée", cancelled: "Annulée" };

export default function AdminDashboard() {
  const router = useRouter();
  const [data, setData] = useState<AdminData | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [screenshots, setScreenshots] = useState<File[]>([]);
  const [productImages, setProductImages] = useState<File[]>([]);
  const [manualImages, setManualImages] = useState<File[]>([]);
  const [provider, setProvider] = useState<Provider>("auto");
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [checkingAi, setCheckingAi] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/data", { cache: "no-store" });
      if (response.status === 401) { router.replace("/admin/login"); return; }
      const value = await response.json().catch(() => ({}));
      if (response.ok) setData(value as AdminData); else setError(value.error || "Chargement impossible.");
    } catch {
      setError("Connexion au serveur impossible. Actualisez la page dans quelques instants.");
    }
  }, [router]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function jsonRequest(url: string, options: RequestInit) {
    if (!data) return null;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(url, { ...options, headers: { "content-type": "application/json", "x-csrf-token": data.csrfToken, ...(options.headers || {}) } });
      if (response.status === 401) { router.replace("/admin/login"); return null; }
      const value = await response.json().catch(() => ({}));
      if (!response.ok) { setError(value.error || "Action impossible."); return null; }
      await load(); return value;
    } catch {
      setError("Connexion au serveur impossible. Réessayez dans quelques instants.");
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function logout() { const value = await jsonRequest("/api/admin/logout", { method: "POST" }); if (value) router.replace("/admin/login"); }
  async function updateOrder(id: number, status: OrderStatus) { const value = await jsonRequest("/api/admin/orders", { method: "PATCH", body: JSON.stringify({ id, status }) }); if (value) setNotice("Statut de la commande mis à jour."); }
  async function sendOrderToZr(order: Order) {
    if (!window.confirm(`Envoyer la commande ${order.orderNumber} à ZR Express ?\n\nCette action crée un vrai colis chez le transporteur.`)) return;
    const value = await jsonRequest("/api/admin/orders/zrexpress", { method: "POST", body: JSON.stringify({ id: order.id }) });
    if (value) setNotice(`Commande envoyée à ZR Express. ID colis : ${value.parcelId}`);
  }
  async function generateGuide(id: number) { const value = await jsonRequest(`/api/admin/products/${id}/size-guide`, { method: "POST" }); if (value) setNotice("Le guide des tailles a été généré et ajouté à la page produit."); }

  async function removeProduct(product: Product) {
    if (!window.confirm(`Supprimer définitivement « ${product.name} » ?`)) return;
    const value = await jsonRequest("/api/admin/products", { method: "DELETE", body: JSON.stringify({ id: product.id }) });
    if (value) setNotice("Produit supprimé.");
  }

  async function checkAiConnection() {
    setCheckingAi(true); setError("");
    try {
      const response = await fetch("/api/admin/ai-status", { cache: "no-store" });
      if (response.status === 401) { router.replace("/admin/login"); return; }
      const value = await response.json().catch(() => ({}));
      if (value.providers) setAiStatus(value.providers as AiStatus);
      else setError(value.error || "Test de connexion IA impossible.");
    } catch {
      setError("Le dashboard ne parvient pas à joindre le serveur LovelyStep.");
    } finally {
      setCheckingAi(false);
    }
  }

  async function importFromScreenshots(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || screenshots.length === 0) { setError("Ajoutez au moins une capture d’écran 1688."); return; }
    if (productImages.length + manualImages.length > 12) { setError("Ajoutez au maximum 12 photos produit au total."); return; }
    setBusy(true); setError(""); setNotice("");
    const form = new FormData();
    screenshots.forEach((file) => form.append("screenshots", file));
    productImages.forEach((file) => form.append("productImages", file));
    manualImages.forEach((file) => form.append("manualImages", file));
    form.set("provider", provider);
    try {
      const response = await fetch("/api/admin/ai-import", { method: "POST", headers: { "x-csrf-token": data.csrfToken }, body: form });
      if (response.status === 401) { router.replace("/admin/login"); return; }
      const value = await response.json().catch(() => ({}));
      if (!response.ok) { setError(value.error || "Analyse impossible."); await load(); return; }
      setScreenshots([]); setProductImages([]); setManualImages([]);
      await load();
      const warningCount = Array.isArray(value.warnings) ? value.warnings.length : 0;
      setNotice(`Brouillon créé avec ${value.provider === "gemini" ? "Gemini" : "Groq"}. ${warningCount} point(s) à vérifier.`);
      setEditing(value.product);
    } catch {
      setError("Connexion interrompue pendant l’import. Vérifiez le réseau puis réessayez.");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <main className="admin-loading"><Image src="/brand/lovelystep-logo.png" alt="" width={130} height={130} /><p>Chargement du dashboard…</p>{error && <p className="form-error">{error}</p>}</main>;
  const navigation: [Tab, string, string][] = [["overview", "Vue d’ensemble", "⌂"], ["analytics", "Rentabilité", "◫"], ["campaigns", "Campaign Manager", "◆"], ["meta", "Meta", "◎"], ["whatsapp", "WhatsApp", "◉"], ["orders", "Commandes", "▤"], ["products", "Produits", "◇"], ["import", "Import IA", "↧"], ["store", "Façade boutique", "✦"], ["delivery", "Livraison", "▣"]];
  const tabTitle = tab === "overview" ? "Bonjour 👋" : tab === "analytics" ? "Rentabilité" : tab === "campaigns" ? "Campaign Intelligence" : tab === "meta" ? "Connexion Meta" : tab === "whatsapp" ? "Agent WhatsApp" : tab === "orders" ? "Commandes" : tab === "products" ? "Catalogue produits" : tab === "import" ? "Import produit par IA" : tab === "store" ? "Façade de la boutique" : "Livraison";
  const primaryMobileTabs: Tab[] = ["overview", "orders", "products", "import"];
  const selectTab = (value: Tab) => {
    setTab(value);
    setError("");
    setNotice("");
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return <div className="admin-shell">
    <aside className="admin-sidebar"><Link href="/" className="admin-logo"><Image src="/brand/lovelystep-logo.png" alt="Lovely Step" width={128} height={128} /></Link><nav>{navigation.map(([value, label, icon]) => <button key={value} className={tab === value ? "active" : ""} onClick={() => selectTab(value)}><span>{icon}</span>{label}{value === "orders" && data.stats.newOrders > 0 && <b>{data.stats.newOrders}</b>}</button>)}</nav><div className="sidebar-bottom"><Link href="/" target="_blank">Voir la boutique ↗</Link><button onClick={logout}>Se déconnecter</button><small>{data.admin.email}</small></div></aside>
    <header className="admin-mobile-topbar"><Link href="/" aria-label="Voir la boutique"><Image src="/brand/lovelystep-logo.png" alt="Lovely Step" width={58} height={58} /></Link><div><small>Administration</small><strong>{tabTitle}</strong></div><Link href="/" target="_blank" className="admin-mobile-store-link">Boutique ↗</Link></header>
    <main className="admin-main"><header className="admin-page-header"><div><span className="admin-kicker">Lovely Step · Administration</span><h1>{tabTitle}</h1></div><span className="secure-pill">● Session sécurisée</span></header>{error && <div className="admin-alert error">{error}<button onClick={() => setError("")}>×</button></div>}{notice && <div className="admin-alert success">{notice}<button onClick={() => setNotice("")}>×</button></div>}

      {tab === "overview" && <><section className="stat-grid kpi-grid"><article className="revenue-stat"><span>Solde · CA livré</span><strong>{money(data.stats.deliveredRevenueCents)}</strong><small>Commandes marquées livrées</small></article><article className="profit-stat"><span>Bénéfice brut</span><strong>{money(data.stats.grossProfitCents)}</strong><small>CA livré moins coût des articles</small></article><article><span>Visiteurs · 30 jours</span><strong>{data.stats.visitors30d}</strong><small>Visiteurs uniques de la boutique</small></article><article><span>Acheteurs récurrents</span><strong>{data.stats.repeatBuyerRate}%</strong><small>Clients livrés ayant acheté au moins 2 fois</small></article><article><span>Inventaire</span><strong>{data.stats.inventoryUnits}</strong><small>Pièces disponibles, toutes variantes</small></article><article className="meta-stat"><span>Meta Ads</span><strong>{data.meta.insightsConfigured ? "Accès prêt" : data.meta.pixelConfigured ? "Pixel actif" : "À configurer"}</strong><small>{data.meta.insightsConfigured ? "Identifiants fournis · synchronisation KPI à activer" : data.meta.pixelConfigured ? "Ajoutez le compte Ads et le jeton Insights" : "Ajoutez le Pixel ID dans l’environnement"}</small></article></section><section className="stat-grid"><article><span>Commandes à traiter</span><strong>{data.stats.newOrders}</strong><button onClick={() => setTab("orders")}>Voir les commandes →</button></article><article><span>Commandes totales</span><strong>{data.stats.orders}</strong><small>Paiement à la livraison</small></article><article><span>Produits publiés</span><strong>{data.stats.published}</strong><small>sur {data.stats.products} produits</small></article><article className="coral-stat"><span>Importer un produit</span><strong>IA</strong><button onClick={() => setTab("import")}>Démarrer →</button></article></section><section className="admin-card"><div className="card-title"><div><h2>Commandes récentes</h2><p>Les nouvelles commandes doivent être confirmées par téléphone.</p></div><button onClick={() => setTab("orders")}>Tout afficher</button></div><OrdersTable orders={data.orders.slice(0, 5)} onStatus={updateOrder} onDispatch={sendOrderToZr} zrExpressReady={data.zrExpress.ready} busy={busy} /></section></>}
      {tab === "analytics" && <AnalyticsPanel />}
      {tab === "campaigns" && <CampaignIntelligencePanel />}
      {tab === "meta" && <MetaPanel csrfToken={data.csrfToken} onNotice={setNotice} onError={setError} />}
      {tab === "whatsapp" && <WhatsAppPanel status={data.whatsapp} />}
      {tab === "orders" && <section className="admin-card"><div className="card-title"><div><h2>Toutes les commandes</h2><p>De la confirmation téléphonique jusqu’à la livraison.</p></div><a className="admin-primary" href="/api/admin/orders/export">Exporter Excel</a></div><OrdersTable orders={data.orders} onStatus={updateOrder} onDispatch={sendOrderToZr} zrExpressReady={data.zrExpress.ready} busy={busy} /></section>}
      {tab === "products" && <section className="admin-card"><div className="card-title"><div><h2>Produits</h2><p>Les brouillons ne sont jamais visibles dans la boutique.</p></div><button className="admin-primary" onClick={() => setEditing("new")}>+ Nouveau produit</button></div><div className="admin-product-list">{data.products.map((product) => { const cover = product.images[0] || "/images/soft-days.jpg"; return <article key={product.id}><Image src={cover} alt="" width={74} height={82} unoptimized={cover.startsWith("/api/media/")} /><div><strong>{product.name}</strong><span>{product.category} · {money(product.priceCents)}</span><small>Mis à jour {new Date(product.updatedAt).toLocaleDateString("fr-FR")}</small></div><span className={`status ${product.status}`}>{product.status === "published" ? "Publié" : product.status === "draft" ? "Brouillon" : "Archivé"}</span><div className="row-actions"><button onClick={() => setEditing(product)}>Modifier</button><button className="danger-button" disabled={busy} onClick={() => void removeProduct(product)}>Supprimer</button><button disabled={busy || product.sizes.length === 0 || product.images.length === 0} onClick={() => generateGuide(product.id)}>Générer le visuel tailles</button>{product.status === "published" && <Link href={`/produits/${product.slug}`} target="_blank">Voir ↗</Link>}</div></article>; })}</div></section>}
      {tab === "import" && <section className="import-layout"><article className="admin-card importer ai-importer"><span className="import-icon">AI</span><h2>Créer un brouillon depuis des captures</h2><p>Ajoutez les photos originales du produit et des captures lisibles de la fiche 1688. Gemini analyse en premier ; Groq prend le relais automatiquement en cas d’échec.</p><div className="ai-provider-health"><div><strong>Connexion des services IA</strong><span>Testez la connexion avant un import pour détecter immédiatement un blocage réseau.</span></div><button type="button" onClick={() => void checkAiConnection()} disabled={checkingAi}>{checkingAi ? "Test en cours…" : "Tester la connexion"}</button>{aiStatus && <div className="ai-provider-results">{(["gemini", "groq"] as const).map((name) => <p className={aiStatus[name].ok ? "ready" : "failed"} key={name}><b>{name === "gemini" ? "Gemini" : "Groq"}</b><span>{aiStatus[name].ok ? "Prêt" : aiStatus[name].message}</span></p>)}</div>}</div><form className="ai-import-form" onSubmit={importFromScreenshots}>
        <FileDropzone label="1. Photos à détourer automatiquement" help="Le fond sera supprimé, puis l’overlay Lovely Step sera appliqué automatiquement · JPG, PNG ou WebP" files={productImages} onChange={setProductImages} max={12} />
        <FileDropzone label="Ou : images prêtes à publier, sans détourage" help="L’image et son arrière-plan seront conservés tels quels, sans suppression ni overlay automatique · 12 photos maximum au total" files={manualImages} onChange={setManualImages} max={12} />
        <FileDropzone label="2. Captures de la fiche 1688" help="Titre, prix fournisseur, caractéristiques, tailles et avis · 5 maximum" files={screenshots} onChange={setScreenshots} max={5} />
        <label className="provider-choice">Fournisseur IA<select value={provider} onChange={(event) => setProvider(event.target.value as Provider)}><option value="auto">Automatique — Gemini puis Groq</option><option value="gemini">Gemini uniquement</option><option value="groq">Groq uniquement</option></select></label>
        <button className="admin-primary ai-submit" disabled={busy || screenshots.length === 0}>{busy ? "Analyse et création du brouillon…" : "Analyser et créer le brouillon"}</button>
      </form><div className="import-warning"><strong>Le prix de vente reste vide</strong><p>L’IA conserve le prix fournisseur comme note privée. Vous devez définir le prix Lovely Step, vérifier les tailles et mettre le produit en ligne manuellement.</p></div></article><article className="admin-card"><div className="card-title"><div><h2>Historique</h2><p>Les 50 derniers imports.</p></div></div><div className="import-history">{data.imports.length === 0 ? <p>Aucun import pour le moment.</p> : data.imports.map((job) => <div key={job.id}><span className={`status ${job.status}`}>{job.status.replaceAll("_", " ")}</span>{job.sourceUrl.startsWith("upload://") ? <span>Import par captures</span> : <a href={job.sourceUrl} target="_blank" rel="noreferrer">{job.sourceUrl}</a>}{job.error && <small>{job.error}</small>}</div>)}</div></article></section>}
      {tab === "store" && <StorefrontEditor settings={data.storeSettings} images={[...new Set(data.products.flatMap((product) => product.images))]} csrfToken={data.csrfToken} busy={busy} onError={setError} onSave={async (settings) => { const value = await jsonRequest("/api/admin/store-settings", { method: "POST", body: JSON.stringify(settings) }); if (value) setNotice("Façade de la boutique mise à jour."); }} />}
      {tab === "delivery" && <DeliveryEditor rates={data.deliveryRates} zrExpress={data.zrExpress} busy={busy} onSyncZrExpress={async () => { const value = await jsonRequest("/api/admin/delivery/sync-zrexpress", { method: "POST" }); if (!value) return null; setNotice(`${value.syncedWilayas} wilaya(s) synchronisée(s) depuis ZR Express.`); return value.rates as DeliveryRate[]; }} onSaveRates={async (rates) => { const value = await jsonRequest("/api/admin/delivery", { method: "POST", body: JSON.stringify({ rates }) }); if (value) setNotice("Tarifs de livraison enregistrés."); }} />}
    </main>
    <nav className="admin-mobile-bottom-nav" aria-label="Navigation principale">{navigation.filter(([value]) => primaryMobileTabs.includes(value)).map(([value, label, icon]) => <button key={value} className={tab === value ? "active" : ""} onClick={() => selectTab(value)}><span>{icon}</span><small>{value === "overview" ? "Accueil" : label}</small>{value === "orders" && data.stats.newOrders > 0 && <b>{data.stats.newOrders}</b>}</button>)}<button className={!primaryMobileTabs.includes(tab) ? "active" : ""} onClick={() => setMobileMenuOpen(true)}><span>•••</span><small>Plus</small></button></nav>
    {mobileMenuOpen && <div className="admin-mobile-menu-overlay"><button className="admin-mobile-menu-backdrop" aria-label="Fermer le menu" onClick={() => setMobileMenuOpen(false)} /><section className="admin-mobile-more-menu" role="dialog" aria-modal="true" aria-label="Plus de rubriques"><header><div><span className="admin-kicker">Navigation</span><h2>Plus d’outils</h2></div><button aria-label="Fermer" onClick={() => setMobileMenuOpen(false)}>×</button></header><nav>{navigation.filter(([value]) => !primaryMobileTabs.includes(value)).map(([value, label, icon]) => <button key={value} className={tab === value ? "active" : ""} onClick={() => selectTab(value)}><span>{icon}</span><strong>{label}</strong><i>›</i></button>)}</nav><footer><small>{data.admin.email}</small><button onClick={logout}>Se déconnecter</button></footer></section></div>}
    {editing && <ProductEditor product={editing === "new" ? null : editing} busy={busy} csrfToken={data.csrfToken} onError={setError} onClose={() => setEditing(null)} onSave={async (body) => { const value = await jsonRequest("/api/admin/products", { method: "POST", body: JSON.stringify(body) }); if (value) { setEditing(null); const automation = value.metaAutomation as { catalog?: boolean; pagePost?: boolean } | undefined; setNotice(automation?.pagePost ? "Produit enregistré. Catalogue et publication Facebook programmés." : automation?.catalog ? "Produit enregistré. Synchronisation du catalogue programmée." : "Produit enregistré."); } }} />}
  </div>;
}

const localizedLabels: Array<[keyof Pick<StoreSettings, "announcement" | "heroEyebrow" | "heroTitle" | "heroAccent" | "heroDescription" | "primaryCta" | "storyTitle" | "storyDescription">, string]> = [
  ["announcement", "Bandeau supérieur"], ["heroEyebrow", "Petit titre du hero"], ["heroTitle", "Titre principal"], ["heroAccent", "Partie colorée du titre"],
  ["heroDescription", "Description du hero"], ["primaryCta", "Bouton principal"], ["storyTitle", "Titre de la promesse"], ["storyDescription", "Texte de la promesse"],
];

function StorefrontEditor({ settings, images, csrfToken, busy, onError, onSave }: { settings: StoreSettings; images: string[]; csrfToken: string; busy: boolean; onError: (value: string) => void; onSave: (settings: StoreSettings) => Promise<void> }) {
  const [value, setValue] = useState(settings);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputId = useId();
  function updateText(key: typeof localizedLabels[number][0], locale: keyof LocalizedText, next: string) { setValue((current) => ({ ...current, [key]: { ...current[key], [locale]: next } })); }
  async function uploadHero(file?: File) {
    if (!file) return;
    setUploading(true); onError("");
    try {
      const form = new FormData(); form.set("image", file);
      const response = await fetch("/api/admin/storefront-image", { method: "POST", headers: { "x-csrf-token": csrfToken }, body: form });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { onError(result.error || "Import de l’image impossible."); return; }
      setValue((current) => ({ ...current, heroImage: result.image }));
    } catch {
      onError("Connexion interrompue pendant l’import de l’image.");
    } finally {
      setUploading(false);
    }
  }
  function dropHero(event: DragEvent<HTMLLabelElement>) { event.preventDefault(); setDragging(false); void uploadHero(event.dataTransfer.files[0]); }
  return <form className="admin-card storefront-editor" onSubmit={(event) => { event.preventDefault(); void onSave(value); }}>
    <div className="card-title"><div><h2>Contenu et identité visuelle</h2><p>Les changements s’appliquent à la page d’accueil en français, anglais et arabe.</p></div><button className="admin-primary" disabled={busy || uploading}>Enregistrer la façade</button></div>
    <section className="storefront-config-block"><h3>Image principale</h3>
      <label htmlFor={inputId} className={`hero-upload-zone ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={dropHero}>
        <input id={inputId} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { void uploadHero(event.target.files?.[0]); event.target.value = ""; }} />
        <strong>{uploading ? "Import et optimisation en cours…" : "Importer une image depuis votre ordinateur"}</strong><span>Glissez-déposez ou cliquez · JPG, PNG ou WebP · 15 Mo maximum</span>
      </label>
      <label>Ou choisir une image du catalogue<select value={value.heroImage || ""} onChange={(event) => setValue({ ...value, heroImage: event.target.value || null })}><option value="">Première image du catalogue</option>{images.map((image, index) => <option value={image} key={image}>Image catalogue {index + 1}</option>)}</select></label>
      {value.heroImage && <Image className="hero-admin-preview" src={value.heroImage} alt="Aperçu" width={520} height={360} unoptimized={value.heroImage.startsWith("/api/media/")} />}
      <small>Après l’import, cliquez sur « Enregistrer la façade » pour la publier.</small>
    </section>
    <section className="storefront-config-block"><h3>Palette Lovely Step</h3><div className="theme-color-grid">{([['navy','Bleu marine'],['coral','Corail'],['cream','Crème'],['sand','Beige sable'],['background','Fond']] as const).map(([key, label]) => <label key={key}>{label}<span><input type="color" value={value.theme[key]} onChange={(event) => setValue({ ...value, theme: { ...value.theme, [key]: event.target.value.toUpperCase() } })} /><input value={value.theme[key]} pattern="#[0-9A-Fa-f]{6}" onChange={(event) => setValue({ ...value, theme: { ...value.theme, [key]: event.target.value } })} /></span></label>)}</div></section>
    <section className="storefront-config-block"><h3>Textes multilingues</h3><div className="localized-editor">{localizedLabels.map(([key, label]) => <article key={key}><strong>{label}</strong><div className="localized-fields">{([['fr','Français'],['en','English'],['ar','العربية']] as const).map(([locale, localeLabel]) => <label key={locale}>{localeLabel}<textarea dir={locale === 'ar' ? 'rtl' : 'ltr'} rows={key.includes("Description") ? 3 : 2} value={value[key][locale]} onChange={(event) => updateText(key, locale, event.target.value)} /></label>)}</div></article>)}</div></section>
    <div className="modal-actions"><Link href="/" target="_blank">Aperçu boutique ↗</Link><button className="admin-primary" disabled={busy || uploading}>Enregistrer la façade</button></div>
  </form>;
}

function DeliveryEditor({ rates, zrExpress, busy, onSyncZrExpress, onSaveRates }: { rates: DeliveryRate[]; zrExpress: AdminData["zrExpress"]; busy: boolean; onSyncZrExpress: () => Promise<DeliveryRate[] | null>; onSaveRates: (rates: DeliveryRate[]) => Promise<void> }) {
  const [values, setValues] = useState(rates);
  const [search, setSearch] = useState("");
  const filtered = values.filter((rate) => `${rate.wilayaCode} ${rate.wilayaNameFr} ${rate.wilayaNameAr}`.toLocaleLowerCase("fr").includes(search.toLocaleLowerCase("fr")));
  function update(code: string, patch: Partial<DeliveryRate>) { setValues((current) => current.map((rate) => rate.wilayaCode === code ? { ...rate, ...patch } : rate)); }
  return <div className="delivery-admin-layout">
    <form className="admin-card" onSubmit={(event) => { event.preventDefault(); void onSaveRates(values); }}>
      <div className="zr-sync-card">
        <div>
          <span className={`status ${zrExpress.ready ? "published" : "draft"}`}>{zrExpress.ready ? "Connexion prête" : "Configuration incomplète"}</span>
          <h3>Tarifs automatiques ZR Express</h3>
          <p>Récupère les prix officiels domicile et point relais, puis remplit automatiquement les wilayas ci-dessous.</p>
          {!zrExpress.apiKeyConfigured && <small>Variable manquante : ZREXPRESS_API_KEY</small>}
          {!zrExpress.tenantConfigured && <small>Variable manquante : ZREXPRESS_TENANT_ID (X-Tenant)</small>}
        </div>
        <button type="button" className="admin-primary" disabled={busy || !zrExpress.ready} onClick={() => void onSyncZrExpress().then((syncedRates) => { if (syncedRates) setValues(syncedRates); })}>{busy ? "Synchronisation…" : "Synchroniser ZR Express"}</button>
      </div>
      <div className="card-title"><div><h2>Tarifs par wilaya</h2><p>Montants en DZD, séparés pour domicile et bureau. Vous pouvez toujours les corriger manuellement.</p></div><button className="admin-primary" disabled={busy}>Enregistrer les tarifs</button></div>
      <input className="admin-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher une wilaya…" />
      <div className="delivery-rate-table">
        <div className="delivery-rate-row head"><span>Wilaya</span><span>Domicile</span><span>Bureau</span><span>Active</span></div>
        {filtered.map((rate) => <div className="delivery-rate-row" key={rate.wilayaCode}><strong>{rate.wilayaCode} · {rate.wilayaNameFr}<small>{rate.wilayaNameAr}</small></strong><label><input aria-label={`Domicile ${rate.wilayaNameFr}`} type="number" min="0" step="1" value={rate.homeCents / 100} onChange={(event) => update(rate.wilayaCode, { homeCents: Math.round(Math.max(0, Number(event.target.value) || 0) * 100) })} /> DZD</label><label><input aria-label={`Bureau ${rate.wilayaNameFr}`} type="number" min="0" step="1" value={rate.officeCents / 100} onChange={(event) => update(rate.wilayaCode, { officeCents: Math.round(Math.max(0, Number(event.target.value) || 0) * 100) })} /> DZD</label><input aria-label={`Activer ${rate.wilayaNameFr}`} type="checkbox" checked={rate.active} onChange={(event) => update(rate.wilayaCode, { active: event.target.checked })} /></div>)}
      </div>
    </form>
    <article className="admin-card delivery-connector">
      <span className={`status ${zrExpress.ready ? "published" : "failed"}`}>{zrExpress.ready ? "ZR Express prêt" : "Configuration incomplète"}</span>
      <div className="card-title"><div><h2>Envoi des commandes</h2><p>Le colis est créé uniquement après votre confirmation téléphonique.</p></div></div>
      <ol className="delivery-send-steps">
        <li>Passez la commande au statut <strong>Confirmée</strong>.</li>
        <li>Cliquez sur <strong>Envoyer à ZR Express</strong> dans l’onglet Commandes.</li>
        <li>L’identifiant du colis ZR est enregistré dans Lovely Step.</li>
      </ol>
      <div className="import-warning"><strong>Protection contre le double envoi</strong><p>Une commande déjà transmise ne peut pas créer un deuxième colis.</p></div>
    </article>
  </div>;
}

function OrdersTable({ orders, onStatus, onDispatch, zrExpressReady, busy }: { orders: Order[]; onStatus: (id: number, status: OrderStatus) => void; onDispatch: (order: Order) => void; zrExpressReady: boolean; busy: boolean }) {
  if (!orders.length) return <div className="empty-admin">Aucune commande pour le moment.</div>;
  return <div className="orders-table"><div className="order-row order-head"><span>N°</span><span>Client</span><span>Articles</span><span>Total</span><span>Date</span><span>Statut et livraison</span></div>{orders.map((order) => {
    const canDispatch = order.status === "confirmed" || order.status === "preparing";
    return <article className="order-row" key={order.id}><div className="order-number"><small>Commande</small><strong>{order.orderNumber}</strong><span>{new Date(order.createdAt).toLocaleDateString("fr-FR")}</span></div><div className="order-customer"><b>{order.customerName}</b><a href={`tel:${order.phone.replace(/\s+/g, "")}`}>{order.phone}</a><small>{order.commune || order.city} · {order.wilayaName || order.city}<br />{order.deliveryType === "office" ? "Bureau" : "Domicile"}</small></div><div className="order-items"><b>{order.items.reduce((sum, item) => sum + item.quantity, 0)} article(s)</b><small>{order.items.map((item) => `${item.name} (${item.size}${item.color ? ` · ${item.color}` : ""})`).join(", ")}</small></div><div className="order-total"><small>Total</small><strong>{money(order.totalCents)}</strong><span>Livraison {money(order.shippingCents)}</span></div><div className="order-date">{new Date(order.createdAt).toLocaleDateString("fr-FR")}</div><div className="order-status-cell"><label><span>Statut</span><select aria-label={`Statut de la commande ${order.orderNumber}`} disabled={busy} value={order.status} onChange={(event) => onStatus(order.id, event.target.value as OrderStatus)}>{Object.entries(orderLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{order.deliverySyncStatus === "sent" ? <><span className="status published">Envoyée à ZR</span><small className="zr-parcel-id">ID colis : {order.deliveryExternalId}</small></> : order.deliverySyncStatus === "pending" ? <span className="status draft">Envoi ZR en cours…</span> : <>{order.deliverySyncStatus === "failed" && <><span className="status failed">Échec ZR Express</span><small className="delivery-sync-error">{order.deliverySyncError}</small></>}{canDispatch ? <button type="button" className="zr-send-button" disabled={busy || !zrExpressReady} onClick={() => onDispatch(order)}>{order.deliverySyncStatus === "failed" ? "Réessayer l’envoi ZR" : "Envoyer à ZR Express"}</button> : <small className="zr-help">Confirmez la commande avant l’envoi.</small>}</>}</div></article>;
  })}</div>;
}

function initialVariants(product: Product | null): ProductVariant[] {
  if (product?.variants.length) return product.variants;
  const sizes = product?.sizes.length ? product.sizes : [{ label: "0-3 mois", stock: 10, age: "0-3 mois", weight: "", height: "" }];
  const colors = product ? (product.colors.length ? product.colors : (product.color ? [product.color] : [""])) : [""];
  return colors.flatMap((color, colorIndex) => sizes.map((size) => ({ color, size: size.label, stock: colorIndex === 0 ? size.stock : 0, age: size.age, weight: size.weight, height: size.height })));
}

function ProductEditor({ product, busy, csrfToken, onError, onClose, onSave }: { product: Product | null; busy: boolean; csrfToken: string; onError: (value: string) => void; onClose: () => void; onSave: (body: Partial<Product>) => void }) {
  const [images, setImages] = useState(product?.images ?? []);
  const [colorImages, setColorImages] = useState<Record<string, string>>(product?.colorImages ?? {});
  const [colors, setColors] = useState<string[]>(product?.colors?.length ? product.colors : (product?.color ? product.color.split(",").map((value) => value.trim()).filter(Boolean) : []));
  const [variants, setVariants] = useState<ProductVariant[]>(() => initialVariants(product));
  const [testimonials, setTestimonials] = useState<ProductTestimonial[]>(product?.testimonials ?? []);
  function changeColors(next: string[]) {
    const previous = colors;
    setColorImages((current) => Object.fromEntries(next.flatMap((color, index) => {
      const previousColor = previous[index];
      const image = current[color] || (previousColor ? current[previousColor] : "");
      return color && image ? [[color, image]] : [];
    })));
    setVariants((current) => {
      if (previous.length === 0 && next.length === 1) return current.map((variant) => ({ ...variant, color: next[0] }));
      if (next.length === 0) return current.map((variant) => ({ ...variant, color: "" }));
      if (previous.length === next.length) return current.map((variant) => {
        const index = previous.indexOf(variant.color);
        return index >= 0 ? { ...variant, color: next[index] } : variant;
      });
      return current.filter((variant) => next.includes(variant.color));
    });
    setColors(next);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const cleanColors = colors.map((value) => value.trim()).filter(Boolean);
    const cleanVariants = variants.map((variant) => ({ ...variant, color: variant.color.trim(), size: variant.size.trim(), stock: Math.max(0, Math.floor(Number(variant.stock) || 0)) })).filter((variant) => variant.size && (cleanColors.length === 0 || cleanColors.includes(variant.color)));
    const cleanSizes = [...cleanVariants.reduce((map, variant) => {
      const current = map.get(variant.size);
      if (current) current.stock += variant.stock;
      else map.set(variant.size, { label: variant.size, stock: variant.stock, age: variant.age, weight: variant.weight, height: variant.height });
      return map;
    }, new Map<string, ProductSize>()).values()];
    const cleanTestimonials = testimonials.map((item) => ({ ...item, quote: item.quote.trim(), author: item.author?.trim(), source: item.source?.trim(), rating: Math.min(5, Math.max(0, Number(item.rating) || 0)) })).filter((item) => item.quote);
    onSave({ id: product?.id, name: String(form.get("name")), slug: String(form.get("slug")), priceCents: Math.round(Number(form.get("price")) * 100), costCents: Math.round(Number(form.get("cost")) * 100), compareAtCents: form.get("compareAt") ? Math.round(Number(form.get("compareAt")) * 100) : null, currency: "DZD", status: String(form.get("status")) as Product["status"], category: String(form.get("category")), badge: String(form.get("badge") || "") || null, color: cleanColors.join(", "), colors: cleanColors, shortDescription: String(form.get("short") || ""), description: String(form.get("description") || ""), materials: String(form.get("materials") || ""), care: String(form.get("care") || ""), images, colorImages: Object.fromEntries(Object.entries(colorImages).filter(([color, image]) => cleanColors.includes(color) && images.includes(image))), features: String(form.get("features") || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean), translations: { en: { name: String(form.get("en-name") || ""), shortDescription: String(form.get("en-short") || ""), description: String(form.get("en-description") || ""), materials: String(form.get("en-materials") || ""), care: String(form.get("en-care") || ""), features: String(form.get("en-features") || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean) }, ar: { name: String(form.get("ar-name") || ""), shortDescription: String(form.get("ar-short") || ""), description: String(form.get("ar-description") || ""), materials: String(form.get("ar-materials") || ""), care: String(form.get("ar-care") || ""), features: String(form.get("ar-features") || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean) } }, sizes: cleanSizes, variants: cleanVariants, testimonials: cleanTestimonials, sourceUrl: product?.sourceUrl });
  }
  return <div className="modal-backdrop admin-modal"><section><button className="modal-x" onClick={onClose}>×</button><span className="admin-kicker">Catalogue</span><h2>{product ? "Modifier le produit" : "Nouveau produit"}</h2><form onSubmit={submit}>
    <div className="form-row"><label>Nom<input name="name" defaultValue={product?.name} required /></label><label>Slug<input name="slug" defaultValue={product?.slug} pattern="[a-z0-9]+(-[a-z0-9]+)*" required /></label></div>
    <div className="form-row three"><label>Prix de vente (DZD)<input name="price" type="number" min="0" step="1" defaultValue={product ? product.priceCents / 100 : ""} required /></label><label>Ancien prix (DZD)<input name="compareAt" type="number" min="0" step="1" defaultValue={product?.compareAtCents ? product.compareAtCents / 100 : ""} /></label><label>Statut<select name="status" defaultValue={product?.status || "draft"}><option value="draft">Brouillon</option><option value="published">Publié</option><option value="archived">Archivé</option></select></label></div>
    <div className="form-row private-cost-row"><label>Coût d’achat privé (DZD)<input name="cost" type="number" min="0" step="1" defaultValue={product ? product.costCents / 100 : ""} required /></label><p>Visible uniquement dans l’administration. Il sert à calculer le bénéfice des commandes livrées.</p></div>
    <div className="form-row"><label>Catégorie<input name="category" defaultValue={product?.category || "Ensembles"} /></label><label>Badge<input name="badge" defaultValue={product?.badge || ""} /></label></div>
    <ColorsEditor colors={colors} onChange={changeColors} />
    <label>Accroche<textarea name="short" rows={2} defaultValue={product?.shortDescription} /></label><label>Description<textarea name="description" rows={4} defaultValue={product?.description} /></label>
    <div className="form-row"><label>Matières<textarea name="materials" rows={3} defaultValue={product?.materials} /></label><label>Entretien<textarea name="care" rows={3} defaultValue={product?.care} /></label></div>
    <ProductTranslationsEditor product={product} />
    <ImageManager images={images} csrfToken={csrfToken} onChange={setImages} onError={onError} />
    <ColorImageEditor colors={colors} images={images} value={colorImages} onChange={setColorImages} />
    <VariantStockEditor variants={variants} colors={colors} onChange={setVariants} />
    <label>Points forts — un par ligne<textarea name="features" rows={3} defaultValue={product?.features.join("\n")} /></label>
    <TestimonialsEditor testimonials={testimonials} onChange={setTestimonials} />
    <div className="modal-actions"><button type="button" onClick={onClose}>Annuler</button><button className="admin-primary" disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer"}</button></div>
  </form></section></div>;
}

function ProductTranslationsEditor({ product }: { product: Product | null }) {
  return <details className="product-translations-editor"><summary>Traductions du produit · English / العربية</summary><p>Les champs vides utilisent automatiquement le texte français.</p>{([['en','English','ltr'],['ar','العربية','rtl']] as const).map(([locale, label, dir]) => { const value = product?.translations?.[locale]; return <section key={locale} dir={dir}><h3>{label}</h3><div className="form-row"><label>Nom<input name={`${locale}-name`} defaultValue={value?.name || ""} /></label><label>Accroche<input name={`${locale}-short`} defaultValue={value?.shortDescription || ""} /></label></div><label>Description<textarea name={`${locale}-description`} rows={4} defaultValue={value?.description || ""} /></label><div className="form-row"><label>Matières<textarea name={`${locale}-materials`} rows={2} defaultValue={value?.materials || ""} /></label><label>Entretien<textarea name={`${locale}-care`} rows={2} defaultValue={value?.care || ""} /></label></div><label>Points forts — un par ligne<textarea name={`${locale}-features`} rows={3} defaultValue={value?.features?.join("\n") || ""} /></label></section>; })}</details>;
}

function ColorImageEditor({ colors, images, value, onChange }: { colors: string[]; images: string[]; value: Record<string, string>; onChange: (value: Record<string, string>) => void }) {
  if (!colors.length) return null;
  return <div className="structured-editor color-image-editor"><div className="structured-title"><div><strong>Image par couleur</strong><span>La photo principale change automatiquement quand le visiteur choisit cette couleur.</span></div></div><div className="color-image-grid">{colors.map((color) => <label key={color}>{color || "Couleur sans nom"}<select value={value[color] || ""} onChange={(event) => onChange({ ...value, [color]: event.target.value })}><option value="">Image de couverture</option>{images.map((image, index) => <option key={image} value={image}>Image {index + 1}{index === 0 ? " · couverture" : ""}</option>)}</select>{value[color] && <Image src={value[color]} alt={color} width={72} height={72} unoptimized={value[color].startsWith("/api/media/")} />}</label>)}</div></div>;
}

function ColorsEditor({ colors, onChange }: { colors: string[]; onChange: (value: string[]) => void }) {
  return <div className="structured-editor"><div className="structured-title"><div><strong>Couleurs disponibles</strong><span>Ajoutez chaque couleur ou variante séparément.</span></div><button type="button" onClick={() => onChange([...colors, ""])}>+ Ajouter une couleur</button></div>{colors.length === 0 ? <p className="empty-structured">Aucune couleur renseignée.</p> : <div className="color-editor-list">{colors.map((color, index) => <div key={index}><input aria-label={`Couleur ${index + 1}`} value={color} placeholder="Ex. Beige" onChange={(event) => onChange(colors.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} /><button type="button" aria-label="Supprimer la couleur" onClick={() => onChange(colors.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>)}</div>}</div>;
}

function VariantStockEditor({ variants, colors, onChange }: { variants: ProductVariant[]; colors: string[]; onChange: (value: ProductVariant[]) => void }) {
  const groups = colors.length ? colors : [""];
  const total = variants.reduce((sum, variant) => sum + Math.max(0, Number(variant.stock) || 0), 0);
  return <div className="variant-stock-editor"><div className="variant-summary"><strong>Inventaire par couleur</strong><span>Stock total : {total} pièce{total > 1 ? "s" : ""}</span></div>{groups.map((color, colorIndex) => {
    const sizes = variants.filter((variant) => variant.color === color).map((variant) => ({ label: variant.size, stock: variant.stock, age: variant.age, weight: variant.weight, height: variant.height }));
    return <section className="variant-color-card" key={`${color || "no-color"}-${colorIndex}`}><h3>{color || "Sans couleur"}</h3><SizeStockEditor sizes={sizes} onChange={(nextSizes) => onChange([
      ...variants.filter((variant) => variant.color !== color),
      ...nextSizes.map((size) => ({ color, size: size.label, stock: size.stock, age: size.age, weight: size.weight, height: size.height })),
    ])} /></section>;
  })}</div>;
}

function SizeStockEditor({ sizes, onChange }: { sizes: ProductSize[]; onChange: (value: ProductSize[]) => void }) {
  const stock = sizes.reduce((sum, size) => sum + Math.max(0, Number(size.stock) || 0), 0);
  function update(index: number, patch: Partial<ProductSize>) { onChange(sizes.map((size, itemIndex) => itemIndex === index ? { ...size, ...patch } : size)); }
  return <div className="structured-editor"><div className="structured-title"><div><strong>Âges et quantités</strong><span>Stock total : {stock} pièce{stock > 1 ? "s" : ""}</span></div><button type="button" onClick={() => onChange([...sizes, { label: "", stock: 0, age: "", weight: "", height: "" }])}>+ Ajouter un âge</button></div>{sizes.length === 0 ? <p className="empty-structured">Aucun âge. Ajoutez au moins une ligne.</p> : <div className="size-editor age-size-editor"><div className="size-editor-head"><span>Âge affiché</span><span>Quantité</span><span /></div>{sizes.map((size, index) => <div className="size-editor-row" key={index}><input aria-label="Âge affiché" value={frenchAgeLabel(size)} placeholder="Ex. 8-11 mois" onChange={(event) => update(index, { label: event.target.value, age: event.target.value, weight: "", height: "" })} /><input aria-label="Quantité" type="number" min="0" step="1" value={size.stock} onChange={(event) => update(index, { stock: Math.max(0, Number(event.target.value) || 0) })} /><button type="button" aria-label="Supprimer l’âge" onClick={() => onChange(sizes.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>)}</div>}</div>;
}

function TestimonialsEditor({ testimonials, onChange }: { testimonials: ProductTestimonial[]; onChange: (value: ProductTestimonial[]) => void }) {
  function update(index: number, patch: Partial<ProductTestimonial>) { onChange(testimonials.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)); }
  return <div className="structured-editor"><div className="structured-title"><div><strong>Témoignages reconnus</strong><span>Vérifiez le texte, l’auteur et la source avant publication.</span></div><button type="button" onClick={() => onChange([...testimonials, { quote: "", author: "", rating: 5, source: "Fiche fournisseur 1688" }])}>+ Ajouter un témoignage</button></div>{testimonials.length === 0 ? <p className="empty-structured">Aucun témoignage détecté dans les captures.</p> : <div className="testimonial-editor-list">{testimonials.map((item, index) => <article key={index}><label>Texte<textarea rows={3} value={item.quote} onChange={(event) => update(index, { quote: event.target.value })} /></label><div className="form-row three"><label>Auteur<input value={item.author || ""} onChange={(event) => update(index, { author: event.target.value })} /></label><label>Note / 5<input type="number" min="0" max="5" step="1" value={item.rating || 0} onChange={(event) => update(index, { rating: Number(event.target.value) })} /></label><label>Source<input value={item.source || ""} onChange={(event) => update(index, { source: event.target.value })} /></label></div><button type="button" onClick={() => onChange(testimonials.filter((_, itemIndex) => itemIndex !== index))}>Supprimer</button></article>)}</div>}</div>;
}

function ImageManager({ images, csrfToken, onChange, onError }: { images: string[]; csrfToken: string; onChange: (images: string[]) => void; onError: (value: string) => void }) {
  const inputId = useId();
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  async function upload(files: File[]) {
    if (!files.length) return;
    setUploading(true); onError("");
    try {
      const form = new FormData(); files.slice(0, 12).forEach((file) => form.append("images", file));
      const response = await fetch("/api/admin/uploads", { method: "POST", headers: { "x-csrf-token": csrfToken }, body: form });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) { onError(value.error || "Envoi des images impossible."); return; }
      onChange([...images, ...value.images]);
    } catch {
      onError("Connexion interrompue pendant l’envoi des images.");
    } finally {
      setUploading(false);
    }
  }
  function drop(event: DragEvent<HTMLLabelElement>) { event.preventDefault(); setDragging(false); void upload(Array.from(event.dataTransfer.files)); }
  return <div className="image-manager"><div className="field-title">Images du produit</div><label htmlFor={inputId} className={`drop-zone compact ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}><input id={inputId} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => void upload(Array.from(event.target.files || []))} /><strong>{uploading ? "Suppression du fond et ajout de l’overlay…" : "Déposez vos photos ici"}</strong><span>Le fond sera supprimé localement avant l’ajout de l’overlay · la première image servira au guide des tailles</span></label>{images.length > 0 && <div className="uploaded-image-grid">{images.map((image, index) => <div key={`${image}-${index}`}><Image src={image} alt="" fill sizes="120px" unoptimized={image.startsWith("/api/media/")} /><span>{index === 0 ? "Couverture" : index + 1}</span><div><button type="button" disabled={index === 0} onClick={() => onChange([image, ...images.filter((_, itemIndex) => itemIndex !== index)])}>★</button><button type="button" onClick={() => onChange(images.filter((_, itemIndex) => itemIndex !== index))}>×</button></div></div>)}</div>}</div>;
}

function FileDropzone({ label, help, files, onChange, max }: { label: string; help: string; files: File[]; onChange: (files: File[]) => void; max: number }) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  function add(incoming: File[]) { onChange([...files, ...incoming.filter((file) => file.type.startsWith("image/"))].slice(0, max)); }
  function input(event: ChangeEvent<HTMLInputElement>) { add(Array.from(event.target.files || [])); event.target.value = ""; }
  function drop(event: DragEvent<HTMLLabelElement>) { event.preventDefault(); setDragging(false); add(Array.from(event.dataTransfer.files)); }
  return <div className="file-drop-field"><span className="field-title">{label}</span><label htmlFor={inputId} className={`drop-zone ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}><input id={inputId} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={input} /><strong>Glissez-déposez les images ici</strong><span>{help}</span></label>{files.length > 0 && <div className="selected-file-grid">{files.map((file, index) => <FilePreview key={`${file.name}-${file.lastModified}-${index}`} file={file} onRemove={() => onChange(files.filter((_, itemIndex) => itemIndex !== index))} />)}</div>}</div>;
}

function FilePreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const source = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(source), [source]);
  return <div><Image src={source} alt="" width={58} height={58} unoptimized /><span>{file.name}<small>{(file.size / 1024 / 1024).toFixed(1)} Mo</small></span><button type="button" onClick={onRemove}>×</button></div>;
}
