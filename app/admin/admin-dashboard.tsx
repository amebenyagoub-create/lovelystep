"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, DragEvent, FormEvent, useCallback, useEffect, useId, useMemo, useState } from "react";
import type { DeliveryRate, LocalizedText, Order, OrderStatus, Product, ProductSize, ProductTestimonial, ProductVariant, StoreSettings } from "@/lib/types";
import { frenchAgeLabel, recommendedHeightLabel } from "@/lib/product-size";
import { filterAdminOrders, type AdminOrderStatusFilter } from "@/lib/admin-order-filter";
import AnalyticsPanel from "./analytics-panel";
import CampaignIntelligencePanel from "./campaign-intelligence-panel";
import MetaPanel from "./meta-panel";
import AgentTestPanel from "./agent-test-panel";

type AdminData = { admin: { email: string }; csrfToken: string; stats: { products: number; published: number; newOrders: number; orders: number; deliveredRevenueCents: number; grossProfitCents: number; visitors30d: number; repeatBuyerRate: number; inventoryUnits: number }; meta: { pixelConfigured: boolean; insightsConfigured: boolean }; zrExpress: { apiKeyConfigured: boolean; tenantConfigured: boolean; ready: boolean }; sheetSync: { unknownStates: string[]; error: string | null; depth: { pending: number; failing: number; oldestPendingAt: string | null }; lastScheduledSync: string | null }; products: Product[]; orders: Order[]; storeSettings: StoreSettings; deliveryRates: DeliveryRate[] };
type Tab = "overview" | "analytics" | "campaigns" | "meta" | "agent" | "orders" | "products" | "store" | "delivery";
const money = (cents: number) => new Intl.NumberFormat("fr-DZ", { style: "currency", currency: "DZD", maximumFractionDigits: 0 }).format(cents / 100);
const productStock = (product: Product) => (product.variants.length ? product.variants : product.sizes).reduce((total, item) => total + Math.max(0, Math.floor(Number(item.stock) || 0)), 0);
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
  const [editingOrder, setEditingOrder] = useState<Order | "new" | null>(null);
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatus, setOrderStatus] = useState<AdminOrderStatusFilter>("all");

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
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000);
    return () => { window.clearTimeout(timer); window.clearInterval(poll); };
  }, [load]);

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
  async function updateOrder(id: number, status: OrderStatus) {
    const value = await jsonRequest("/api/admin/orders", { method: "PATCH", body: JSON.stringify({ id, status }) });
    if (!value) return;
    // Une annulation que l'agent n'a pas recue est pire qu'un echec visible : il continuerait
    // a ecrire au client. Le message du serveur passe donc en avertissement, pas en confirmation.
    if (value.warning) setError(String(value.warning));
    else setNotice(status === "cancelled" ? "Commande annulée. L’agent de confirmation a été prévenu." : "Statut de la commande mis à jour.");
  }
  async function removeOrder(order: Order) {
    const stockNotice = ["refused", "returned", "cancelled"].includes(order.status) ? "" : "\n\nLes articles réservés seront remis en stock.";
    if (!window.confirm(`Supprimer définitivement la commande ${order.orderNumber} ?${stockNotice}\n\nCette action est irréversible.`)) return;
    const value = await jsonRequest("/api/admin/orders", { method: "DELETE", body: JSON.stringify({ id: order.id }) });
    if (value) setNotice(`Commande ${order.orderNumber} supprimée.`);
  }
  async function retrySheetExport(order: Order | null) {
    const value = await jsonRequest("/api/admin/orders/sheet-retry", { method: "POST", body: JSON.stringify(order ? { id: order.id } : {}) });
    if (!value) return;
    const outbox = value.outbox as { exported: number; refreshed: number; alreadyPresent: number; failed: number };
    setNotice(outbox.failed
      ? `${outbox.failed} commande(s) toujours en échec d’export vers Google Sheets.`
      : `Export Google Sheets à jour (${outbox.exported} ajoutée(s), ${outbox.refreshed ?? 0} corrigée(s), ${outbox.alreadyPresent} déjà présente(s)).`);
  }
  async function sendOrderToZr(order: Order) {
    // L'agent de confirmation cree lui aussi des colis. La synchronisation recopie desormais
    // son numero de colis et de suivi dans la commande, donc ce bouton disparait des qu'un
    // colis existe : il ne reste visible que pour les commandes qu'aucun colis ne couvre.
    if (!window.confirm(`Envoyer la commande ${order.orderNumber} à ZR Express ?\n\nCette action crée un vrai colis chez le transporteur.`)) return;
    const value = await jsonRequest("/api/admin/orders/zrexpress", { method: "POST", body: JSON.stringify({ id: order.id }) });
    if (value) setNotice(`Commande envoyée à ZR Express. ID colis : ${value.parcelId}`);
  }
  /** Publication manuelle : le seul recours quand l'annonce automatique a ete refusee ou interrompue. */
  async function postToFacebook(product: Product) {
    if (!window.confirm(`Publier « ${product.name} » sur la Page Facebook ?`)) return;
    const value = await jsonRequest("/api/admin/meta/page-post", { method: "POST", body: JSON.stringify({ productId: product.id }) });
    if (value) setNotice("Produit publié sur la Page Facebook.");
  }

  async function generateGuide(id: number) { const value = await jsonRequest(`/api/admin/products/${id}/size-guide`, { method: "POST" }); if (value) setNotice("Le guide des tailles a été généré et ajouté à la page produit."); }

  async function removeProduct(product: Product) {
    if (!window.confirm(`Supprimer définitivement « ${product.name} » ?`)) return;
    const value = await jsonRequest("/api/admin/products", { method: "DELETE", body: JSON.stringify({ id: product.id }) });
    if (value) setNotice("Produit supprimé.");
  }

  const filteredOrders = useMemo(() => data ? filterAdminOrders(data.orders, orderStatus, orderSearch) : [], [data, orderSearch, orderStatus]);

  if (!data) return <main className="admin-loading"><Image src="/brand/lovelystep-logo.png" alt="" width={130} height={130} /><p>Chargement du dashboard…</p>{error && <p className="form-error">{error}</p>}</main>;

  const navigation: [Tab, string, string][] = [["overview", "Vue d’ensemble", "⌂"], ["analytics", "Rentabilité", "◫"], ["campaigns", "Campaign Manager", "◆"], ["meta", "Meta", "◎"], ["agent", "Agent WhatsApp", "◉"], ["orders", "Commandes", "▤"], ["products", "Produits", "◇"], ["store", "Façade boutique", "✦"], ["delivery", "Livraison", "▣"]];
  const tabTitle = tab === "overview" ? "Bonjour 👋" : tab === "analytics" ? "Rentabilité" : tab === "campaigns" ? "Campaign Intelligence" : tab === "meta" ? "Connexion Meta" : tab === "agent" ? "Test de l’agent WhatsApp" : tab === "orders" ? "Commandes" : tab === "products" ? "Catalogue produits" : tab === "store" ? "Façade de la boutique" : "Livraison";
  const primaryMobileTabs: Tab[] = ["overview", "orders", "products", "store"];
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

      {tab === "overview" && <><section className="stat-grid kpi-grid"><article className="revenue-stat"><span>Solde · CA livré</span><strong>{money(data.stats.deliveredRevenueCents)}</strong><small>Commandes marquées livrées</small></article><article className="profit-stat"><span>Bénéfice brut</span><strong>{money(data.stats.grossProfitCents)}</strong><small>CA livré moins coût des articles</small></article><article><span>Visiteurs · 30 jours</span><strong>{data.stats.visitors30d}</strong><small>Visiteurs uniques de la boutique</small></article><article><span>Acheteurs récurrents</span><strong>{data.stats.repeatBuyerRate}%</strong><small>Clients livrés ayant acheté au moins 2 fois</small></article><article><span>Inventaire</span><strong>{data.stats.inventoryUnits}</strong><small>Pièces disponibles, toutes variantes</small></article><article className="meta-stat"><span>Meta Ads</span><strong>{data.meta.insightsConfigured ? "Accès prêt" : data.meta.pixelConfigured ? "Pixel actif" : "À configurer"}</strong><small>{data.meta.insightsConfigured ? "Identifiants fournis · synchronisation KPI à activer" : data.meta.pixelConfigured ? "Ajoutez le compte Ads et le jeton Insights" : "Ajoutez le Pixel ID dans l’environnement"}</small></article></section><section className="stat-grid"><article><span>Commandes à traiter</span><strong>{data.stats.newOrders}</strong><button onClick={() => setTab("orders")}>Voir les commandes →</button></article><article><span>Commandes totales</span><strong>{data.stats.orders}</strong><small>Paiement à la livraison</small></article><article><span>Produits publiés</span><strong>{data.stats.published}</strong><small>sur {data.stats.products} produits</small></article><article className="coral-stat"><span>Ajouter un produit</span><strong>+</strong><button onClick={() => { setTab("products"); setEditing("new"); }}>Créer →</button></article></section><section className="admin-card"><div className="card-title"><div><h2>Commandes récentes</h2><p>Les nouvelles commandes doivent être confirmées par téléphone.</p></div><button onClick={() => setTab("orders")}>Tout afficher</button></div><OrdersTable orders={data.orders.slice(0, 5)} onEdit={setEditingOrder} onStatus={updateOrder} onDelete={removeOrder} onDispatch={sendOrderToZr} onRetrySheet={retrySheetExport} zrExpressReady={data.zrExpress.ready} busy={busy} /></section></>}
      {tab === "analytics" && <AnalyticsPanel />}
      {tab === "campaigns" && <CampaignIntelligencePanel csrfToken={data.csrfToken} />}
      {tab === "meta" && <MetaPanel csrfToken={data.csrfToken} onNotice={setNotice} onError={setError} />}
      {tab === "agent" && <AgentTestPanel products={data.products} rates={data.deliveryRates} csrfToken={data.csrfToken} onError={setError} />}
      {tab === "orders" && <section className="admin-card"><div className="card-title"><div><h2>Toutes les commandes</h2><p>De la confirmation téléphonique jusqu’à la livraison.{ordersNeedingAttention(data.orders) > 0 ? ` · ${ordersNeedingAttention(data.orders)} commande(s) attendent une action de votre part.` : ""}</p></div><div className="orders-actions"><button type="button" className="admin-primary" disabled={busy} onClick={() => setEditingOrder("new")}>Nouvelle commande</button><button type="button" className="admin-secondary" disabled={busy} onClick={() => retrySheetExport(null)}>Synchroniser Google Sheets</button><a className="admin-primary" href="/api/admin/orders/export">Exporter Excel</a></div></div><SheetSyncBanner sync={data.sheetSync} /><div className="order-filters"><label><span>Rechercher</span><input type="search" value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} placeholder="N°, client, téléphone, produit, wilaya…" /></label><label><span>Statut</span><select value={orderStatus} onChange={(event) => setOrderStatus(event.target.value as AdminOrderStatusFilter)}><option value="all">Tous les statuts</option>{Object.entries(orderLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><output aria-live="polite">{filteredOrders.length} sur {data.orders.length}</output>{(orderSearch || orderStatus !== "all") && <button type="button" onClick={() => { setOrderSearch(""); setOrderStatus("all"); }}>Effacer</button>}</div><OrdersTable orders={filteredOrders} emptyMessage="Aucune commande ne correspond à votre recherche." onEdit={setEditingOrder} onStatus={updateOrder} onDelete={removeOrder} onDispatch={sendOrderToZr} onRetrySheet={retrySheetExport} zrExpressReady={data.zrExpress.ready} busy={busy} /></section>}
      {tab === "products" && <section className="admin-card">
        <div className="card-title">
          <div>
            <h2>Produits</h2>
            <p>Inventaire total : {data.stats.inventoryUnits} pièce{data.stats.inventoryUnits > 1 ? "s" : ""}. Les brouillons ne sont jamais visibles dans la boutique.</p>
          </div>
          <button className="admin-primary" onClick={() => setEditing("new")}>+ Nouveau produit</button>
        </div>
        <div className="admin-product-list">{data.products.map((product) => {
          const cover = product.images[0] || "/images/soft-days.jpg";
          const stock = productStock(product);
          const stockClassName = stock === 0 ? "product-stock empty" : stock <= 5 ? "product-stock low" : "product-stock";
          return <article key={product.id}>
            <Image src={cover} alt="" width={74} height={82} unoptimized={cover.startsWith("/api/media/")} />
            <div>
              <strong>{product.name}</strong>
              <span>{product.category} · {money(product.priceCents)}</span>
              <small>Mis à jour {new Date(product.updatedAt).toLocaleDateString("fr-FR")}</small>
              <small className={stockClassName}>{stock === 0 ? "Rupture de stock" : `Stock restant : ${stock} pièce${stock > 1 ? "s" : ""}`}</small>
            </div>
            <span className={`status ${product.status}`}>{product.status === "published" ? "Publié" : product.status === "draft" ? "Brouillon" : "Archivé"}</span>
            <ProductStockBySize product={product} />
            <div className="row-actions">
              <button onClick={() => setEditing(product)}>Modifier</button>
              <button className="danger-button" disabled={busy} onClick={() => void removeProduct(product)}>Supprimer</button>
              <button disabled={busy || product.sizes.length === 0 || product.images.length === 0} onClick={() => generateGuide(product.id)}>Générer le visuel tailles</button>
              <button disabled={busy || product.status !== "published"} title={product.status === "published" ? "" : "Publiez le produit d’abord."} onClick={() => void postToFacebook(product)}>Publier sur Facebook</button>
              {product.status === "published" && <Link href={`/produits/${product.slug}`} target="_blank">Voir ↗</Link>}
            </div>
          </article>;
        })}</div>
      </section>}
      {tab === "store" && <StorefrontEditor settings={data.storeSettings} images={[...new Set(data.products.flatMap((product) => product.images))]} csrfToken={data.csrfToken} busy={busy} onError={setError} onSave={async (settings) => { const value = await jsonRequest("/api/admin/store-settings", { method: "POST", body: JSON.stringify(settings) }); if (value) setNotice("Façade de la boutique mise à jour."); }} />}
      {tab === "delivery" && <DeliveryEditor rates={data.deliveryRates} zrExpress={data.zrExpress} busy={busy} onSyncZrExpress={async () => { const value = await jsonRequest("/api/admin/delivery/sync-zrexpress", { method: "POST" }); if (!value) return null; setNotice(`${value.syncedWilayas} wilaya(s) synchronisée(s) depuis ZR Express.`); return value.rates as DeliveryRate[]; }} onSaveRates={async (rates) => { const value = await jsonRequest("/api/admin/delivery", { method: "POST", body: JSON.stringify({ rates }) }); if (value) setNotice("Tarifs de livraison enregistrés."); }} />}
    </main>
    <nav className="admin-mobile-bottom-nav" aria-label="Navigation principale">{navigation.filter(([value]) => primaryMobileTabs.includes(value)).map(([value, label, icon]) => <button key={value} className={tab === value ? "active" : ""} onClick={() => selectTab(value)}><span>{icon}</span><small>{value === "overview" ? "Accueil" : label}</small>{value === "orders" && data.stats.newOrders > 0 && <b>{data.stats.newOrders}</b>}</button>)}<button className={!primaryMobileTabs.includes(tab) ? "active" : ""} onClick={() => setMobileMenuOpen(true)}><span>•••</span><small>Plus</small></button></nav>
    {mobileMenuOpen && <div className="admin-mobile-menu-overlay"><button className="admin-mobile-menu-backdrop" aria-label="Fermer le menu" onClick={() => setMobileMenuOpen(false)} /><section className="admin-mobile-more-menu" role="dialog" aria-modal="true" aria-label="Plus de rubriques"><header><div><span className="admin-kicker">Navigation</span><h2>Plus d’outils</h2></div><button aria-label="Fermer" onClick={() => setMobileMenuOpen(false)}>×</button></header><nav>{navigation.filter(([value]) => !primaryMobileTabs.includes(value)).map(([value, label, icon]) => <button key={value} className={tab === value ? "active" : ""} onClick={() => selectTab(value)}><span>{icon}</span><strong>{label}</strong><i>›</i></button>)}</nav><footer><small>{data.admin.email}</small><button onClick={logout}>Se déconnecter</button></footer></section></div>}
    {editingOrder && <OrderEditor order={editingOrder === "new" ? null : editingOrder} products={data.products} deliveryRates={data.deliveryRates} busy={busy} onError={setError} onClose={() => setEditingOrder(null)} onSave={async (body) => {
      const creating = editingOrder === "new";
      const value = await jsonRequest("/api/admin/orders", creating
        ? { method: "POST", body: JSON.stringify(body) }
        : { method: "PUT", body: JSON.stringify({ id: editingOrder.id, ...body }) });
      if (value) { setEditingOrder(null); setNotice(creating ? "Commande créée. Elle n\u2019est pas rattachée à une campagne Meta." : "Commande modifiée. Le stock et l\u2019export Sheets ont été mis à jour."); }
    }} />}
    {editing && <ProductEditor product={editing === "new" ? null : editing} busy={busy} csrfToken={data.csrfToken} onError={setError} onClose={() => setEditing(null)} onSave={async (body) => { const value = await jsonRequest("/api/admin/products", { method: "POST", body: JSON.stringify(body) }); if (value) { setEditing(null); const automation = value.metaAutomation as { catalog?: boolean; pagePost?: boolean; instagramPost?: boolean } | undefined; setNotice(automation?.pagePost && automation?.instagramPost ? "Produit enregistré. Publications Facebook et Instagram programmées." : automation?.instagramPost ? "Produit enregistré. Publication Instagram programmée." : automation?.pagePost ? "Produit enregistré. Publication Facebook programmée." : automation?.catalog ? "Produit enregistré. Synchronisation du catalogue programmée." : "Produit enregistré."); } }} />}
  </div>;
}

function ProductStockBySize({ product }: { product: Product }) {
  const entries = product.variants.length
    ? product.variants.map((variant) => ({ color: variant.color, label: variant.size, stock: variant.stock, age: variant.age, weight: variant.weight, height: variant.height }))
    : product.sizes.map((size) => ({ color: "", ...size }));

  return <section className="product-size-stock" aria-label={`Stock par taille pour ${product.name}`}>
    <strong>Stock par taille</strong>
    {entries.length === 0 ? <small>Aucune taille enregistrée</small> : <div className="product-size-stock-grid">{entries.map((entry, index) => {
      const quantity = Math.max(0, Math.floor(Number(entry.stock) || 0));
      const age = frenchAgeLabel(entry);
      const className = quantity === 0 ? "empty" : quantity <= 2 ? "low" : "";
      return <div className={`product-size-stock-item ${className}`} key={`${entry.color}-${entry.label}-${index}`}>
        <span>{entry.color || "Toutes couleurs"}</span>
        <strong>{age === entry.label ? `Taille ${entry.label}` : age}</strong>
        {age !== entry.label && <small>Taille {entry.label}</small>}
        <b>{quantity}<small> pièce{quantity > 1 ? "s" : ""}</small></b>
      </div>;
    })}</div>}
  </section>;
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
      if (Array.isArray(result.warnings) && result.warnings.length) onError(result.warnings.join(" "));
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
  function fillAll(patch: Partial<DeliveryRate>) { setValues((current) => current.map((rate) => ({ ...rate, ...patch }))); }
  const [bulk, setBulk] = useState({ ret: "150" });
  const toMinor = (value: string) => Math.round(Math.max(0, Number(value) || 0) * 100);
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
      <div className="card-title"><div><h2>Tarifs par wilaya</h2><p>Les frais de livraison payés par le client sont reversés intégralement à ZR Express : ils s\u2019annulent dans le calcul du bénéfice, aucun coût d\u2019envoi n\u2019est à saisir. Seul le <b>retour</b> vous est facturé, sur un colis refusé ou retourné.</p></div><button className="admin-primary" disabled={busy}>Enregistrer les tarifs</button></div>
      <div className="delivery-bulk-fill">
        <span>Frais de retour, appliqué à toutes les wilayas :</span>
        <label>Retour (DZD)<input type="number" min="0" step="1" value={bulk.ret} onChange={(event) => setBulk({ ...bulk, ret: event.target.value })} /></label>
        <button type="button" className="secondary-button" onClick={() => fillAll(bulk.ret === "" ? {} : { returnCostCents: toMinor(bulk.ret) })}>Remplir</button>
      </div>
      <input className="admin-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher une wilaya…" />
      <div className="delivery-rate-table">
        <div className="delivery-rate-row head"><span>Wilaya</span><span>Prix domicile</span><span>Prix bureau</span><span>Frais de retour</span><span>Active</span></div>
        {filtered.map((rate) => <div className="delivery-rate-row" key={rate.wilayaCode}><strong>{rate.wilayaCode} · {rate.wilayaNameFr}<small>{rate.wilayaNameAr}</small></strong><label><input aria-label={`Domicile ${rate.wilayaNameFr}`} type="number" min="0" step="1" value={rate.homeCents / 100} onChange={(event) => update(rate.wilayaCode, { homeCents: Math.round(Math.max(0, Number(event.target.value) || 0) * 100) })} /> DZD</label><label><input aria-label={`Bureau ${rate.wilayaNameFr}`} type="number" min="0" step="1" value={rate.officeCents / 100} onChange={(event) => update(rate.wilayaCode, { officeCents: Math.round(Math.max(0, Number(event.target.value) || 0) * 100) })} /> DZD</label><label><input aria-label={`Retour ${rate.wilayaNameFr}`} type="number" min="0" step="1" value={rate.returnCostCents / 100} onChange={(event) => update(rate.wilayaCode, { returnCostCents: Math.round(Math.max(0, Number(event.target.value) || 0) * 100) })} /> DZD</label><input aria-label={`Activer ${rate.wilayaNameFr}`} type="checkbox" checked={rate.active} onChange={(event) => update(rate.wilayaCode, { active: event.target.checked })} /></div>)}
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

function SheetSyncBanner({ sync }: { sync: AdminData["sheetSync"] }) {
  // Silence used to be the failure mode here: a lost export meant the confirmation
  // agent never saw the order, and nothing on this page said so.
  if (sync.error) return <div className="sheet-sync-banner error">Google Sheets injoignable : {sync.error}</div>;
  // The page only reads the database. This timestamp proves that the scheduled
  // Google Sheets reconciliation is running independently from the dashboard.
  const lastRun = sync.lastScheduledSync ? Date.parse(sync.lastScheduledSync) : null;
  const silentFor = lastRun ? Math.round((Date.now() - lastRun) / 60000) : null;
  if (silentFor === null) {
    return <div className="sheet-sync-banner error">La synchronisation automatique n’a jamais tourné. Les statuts Google Sheets peuvent être en retard ; vérifiez la tâche planifiée Railway.</div>;
  }
  if (silentFor > 60) {
    return <div className="sheet-sync-banner error">La synchronisation automatique n’a pas tourné depuis {silentFor > 1440 ? `${Math.round(silentFor / 1440)} jour(s)` : `${silentFor} minutes`}. Les statuts Google Sheets peuvent être en retard.</div>;
  }
  const parts: string[] = [];
  if (sync.depth.pending) parts.push(`${sync.depth.pending} commande(s) en attente d’export`);
  if (sync.depth.failing) parts.push(`dont ${sync.depth.failing} en échec répété`);
  if (sync.unknownStates.length) parts.push(`état(s) inconnu(s) dans le Sheet : ${sync.unknownStates.join(", ")}`);
  if (!parts.length) return null;
  return <div className="sheet-sync-banner">{parts.join(" · ")}</div>;
}

/**
 * Fil WhatsApp de confirmation, en lecture seule.
 *
 * L'agent de confirmation ecrit chaque message dans la colonne convo_log du Google Sheet, au
 * format « [MM-JJ HH:MM] fleche texte », fleche gauche pour le client et droite pour nous, les
 * retours a la ligne remplaces par un pictogramme. On le relit tel quel : la boutique ne parle
 * jamais sur WhatsApp, un seul robot est abonne au numero et deux emetteurs repondraient deux
 * fois au meme client. Pour repondre, il faut passer par la boite de reception de l'agent.
 */
type ConversationMessage = { direction: "in" | "out"; at: string; text: string };

function parseConversation(log: string | null): ConversationMessage[] {
  if (!log) return [];
  return log.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const match = /^\[([^\]]*)\]\s*([\u2190\u2192])?\s*([\s\S]*)$/.exec(line);
    if (!match) return { direction: "in" as const, at: "", text: line };
    return { direction: match[2] === "\u2192" ? "out" as const : "in" as const, at: match[1], text: (match[3] || "").replaceAll(" \u23ce ", "\n") };
  });
}

function OrderConversation({ order }: { order: Order }) {
  const [open, setOpen] = useState(false);
  const messages = parseConversation(order.whatsappLog);
  if (!messages.length) return null;
  const last = messages[messages.length - 1];
  return <div className="order-convo">
    <button type="button" className="convo-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="convo-mark" aria-hidden="true">{"\u25cf"}</span>
      WhatsApp · {messages.length} message(s)
      {!open && <em>{last.text.slice(0, 60)}{last.text.length > 60 ? "\u2026" : ""}</em>}
      <b>{open ? "\u2212" : "+"}</b>
    </button>
    {open && <div className="convo-thread">
      {messages.map((message, index) => <div className={`convo-line ${message.direction}`} key={index}>
        <span>{message.text}</span>
        {message.at && <time>{message.at}</time>}
      </div>)}
      <small className="convo-note">Lecture seule — les réponses partent de l’agent de confirmation.</small>
    </div>}
  </div>;
}

/**
 * Ce que l'agent a reellement constate, affiche sous le statut a neuf valeurs.
 *
 * Le statut de la boutique replie dix-neuf etats de l'agent sur neuf : « livraison manquee »,
 * « bloquee depuis 72 h » et « chez le livreur » s'affichent tous « Expediee » ; « donnees a
 * corriger » et « client sans reponse » s'affichent tous deux « A confirmer ». Les etats qui
 * demandent une action etaient donc rigoureusement invisibles dans ce tableau, alors que
 * l'agent les ecrivait a chaque fois. On les affiche a cote, sans toucher au statut lui-meme.
 */
const agentStates: Record<string, { label: string; tone: "alert" | "info" }> = {
  NEEDS_REVIEW: { label: "Données à corriger", tone: "alert" },
  ZR_ERROR: { label: "Échec création du colis", tone: "alert" },
  MISSED_ATTEMPT: { label: "Livraison manquée", tone: "alert" },
  STALLED: { label: "Bloquée depuis 72 h", tone: "alert" },
  NO_REPLY: { label: "Client sans réponse", tone: "alert" },
  HUMAN: { label: "À reprendre à la main", tone: "alert" },
  SCHEDULED: { label: "Reportée par le client", tone: "info" },
  AGENT_TALKING: { label: "Conversation en cours", tone: "info" },
  CONFIRM_SENT: { label: "Confirmation envoyée", tone: "info" },
  OUT_FOR_DELIVERY: { label: "Chez le livreur", tone: "info" },
  ARRIVED_WILAYA: { label: "Arrivée en wilaya", tone: "info" },
};
function agentState(sheetState: string | null) {
  return agentStates[String(sheetState ?? "").trim().toUpperCase()] ?? null;
}
/** Commandes ou l'agent attend une action de votre part. */
export function ordersNeedingAttention(orders: Order[]): number {
  return orders.filter((order) => agentState(order.sheetState)?.tone === "alert").length;
}

function OrdersTable({ orders, emptyMessage = "Aucune commande pour le moment.", onEdit, onStatus, onDelete, onDispatch, onRetrySheet, zrExpressReady, busy }: { orders: Order[]; emptyMessage?: string; onEdit: (order: Order) => void; onStatus: (id: number, status: OrderStatus) => void; onDelete: (order: Order) => void; onDispatch: (order: Order) => void; onRetrySheet: (order: Order) => void; zrExpressReady: boolean; busy: boolean }) {
  if (!orders.length) return <div className="empty-admin">{emptyMessage}</div>;
  return <div className="orders-table"><div className="order-row order-head"><span>N°</span><span>Client</span><span>Articles</span><span>Total</span><span>Date</span><span>Statut et livraison</span></div>{orders.map((order) => {
    const canDispatch = order.status === "confirmed" || order.status === "preparing";
    const agent = agentState(order.sheetState);
    const deliveryLocked = order.deliverySyncStatus === "sent" || order.deliverySyncStatus === "pending" || Boolean(order.deliveryExternalId);
    return <article className="order-row" key={order.id}><div className="order-number"><small>Commande</small><strong>{order.orderNumber}</strong><span>{new Date(order.createdAt).toLocaleDateString("fr-FR")}</span></div><div className="order-customer"><b>{order.customerName}</b><a href={`tel:${order.phone.replace(/\s+/g, "")}`}>{order.phone}</a><small>{order.commune || order.city} · {order.wilayaName || order.city}<br />{order.deliveryType === "office" ? "Bureau" : "Domicile"}{order.deliveryType === "office" && order.deliveryHubName ? <><br /><em className="order-hub">{order.deliveryHubName}</em></> : null}</small></div><div className="order-items"><b>{order.items.reduce((sum, item) => sum + item.quantity, 0)} article(s)</b><ul className="order-item-list">{order.items.map((item) => <li key={`${item.productId}-${item.size}-${item.color || ""}`}>{item.image ? <Image src={item.image} alt="" width={44} height={53} /> : <i className="order-item-noimage" aria-hidden="true" />}<span><b>{item.name}</b><small>{item.size}{item.color ? ` \u00b7 ${item.color}` : ""}</small></span><em>{"\u00d7"}{item.quantity}</em></li>)}</ul></div><div className="order-total"><small>Total</small><strong>{money(order.totalCents)}</strong><span>Livraison {money(order.shippingCents)}</span></div><div className="order-date">{new Date(order.createdAt).toLocaleDateString("fr-FR")}</div><div className="order-status-cell"><label><span>Statut</span><select aria-label={`Statut de la commande ${order.orderNumber}`} disabled={busy} value={order.status} onChange={(event) => onStatus(order.id, event.target.value as OrderStatus)}>{Object.entries(orderLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{agent && <span className={`agent-state ${agent.tone}`} title="Constaté par l’agent de confirmation">{agent.label}</span>}{order.deliverySyncStatus === "sent" ? <><span className="status published">Envoyée à ZR</span>{order.deliveryTracking ? <small className="zr-parcel-id">Suivi ZR : {order.deliveryTracking}</small> : order.deliveryExternalId ? <small className="zr-parcel-id">ID colis : {order.deliveryExternalId}</small> : null}</> : order.deliverySyncStatus === "pending" ? <span className="status draft">Envoi ZR en cours…</span> : <>{order.deliverySyncStatus === "failed" && <><span className="status failed">Échec ZR Express</span><small className="delivery-sync-error">{order.deliverySyncError}</small></>}{canDispatch ? <button type="button" className="zr-send-button" disabled={busy || !zrExpressReady} onClick={() => onDispatch(order)}>{order.deliverySyncStatus === "failed" ? "Réessayer l’envoi ZR" : "Envoyer à ZR Express"}</button> : <small className="zr-help">Confirmez la commande avant l’envoi.</small>}</>}{!order.sheetSyncedAt && <div className="sheet-sync-cell"><span className="status failed">Pas encore dans Google Sheets</span>{order.sheetLastError && <small className="delivery-sync-error">{order.sheetLastError}</small>}<button type="button" className="zr-send-button" disabled={busy} onClick={() => onRetrySheet(order)}>Réessayer l’export Sheets</button></div>}<button type="button" className="order-edit-button" disabled={busy || deliveryLocked} title={deliveryLocked ? "Colis déjà chez ZR Express : annulez-le avant de modifier" : `Modifier ${order.orderNumber}`} onClick={() => onEdit(order)}>Modifier</button><button type="button" className="order-delete-button" disabled={busy || deliveryLocked} title={deliveryLocked ? "Annulez d’abord le colis chez ZR Express" : `Supprimer ${order.orderNumber}`} onClick={() => onDelete(order)}>Supprimer</button></div><OrderConversation order={order} /></article>;
  })}</div>;
}

type OrderEditLine = { productId: number; size: string; color: string; quantity: number };

/**
 * Creates or corrects an order: who it goes to, where, and what is in it.
 *
 * `order === null` is the manual-order case — a sale taken by phone, WhatsApp or DM. It is
 * saved exactly like a storefront order except that no Meta attribution and no Purchase event
 * are produced, because no ad brought it in.
 *
 * The form sends no money. Prices come from the catalogue server-side, so the totals shown here
 * are a preview computed from the same inputs, not a value the server will trust.
 *
 * Communes are fetched per wilaya rather than bundled: the full list is 575 KB.
 */
function OrderEditor({ order, products, deliveryRates, busy, onError, onClose, onSave }: {
  order: Order | null; products: Product[]; deliveryRates: DeliveryRate[]; busy: boolean;
  onError: (message: string) => void; onClose: () => void;
  onSave: (body: { customerName: string; phone: string; wilayaCode: string; commune: string; address: string; deliveryType: Order["deliveryType"]; negotiatedTotalCents: number | null; items: OrderEditLine[] }) => Promise<void>;
}) {
  const [customerName, setCustomerName] = useState(order?.customerName ?? "");
  const [phone, setPhone] = useState(order?.phone ?? "");
  const [wilayaCode, setWilayaCode] = useState(order?.wilayaCode ?? (deliveryRates[0]?.wilayaCode ?? ""));
  const [commune, setCommune] = useState(order?.commune ?? "");
  const [address, setAddress] = useState(order?.address ?? "");
  const [deliveryType, setDeliveryType] = useState<Order["deliveryType"]>(order?.deliveryType ?? "home");
  const [lines, setLines] = useState<OrderEditLine[]>((order?.items ?? []).map((item) => ({ productId: item.productId, size: item.size, color: item.color ?? "", quantity: item.quantity })));
  // Saisi en dinars, comme on le dit au telephone. Vide = on garde le tarif catalogue.
  const [negotiated, setNegotiated] = useState(order && order.subtotalCents + order.shippingCents !== order.totalCents ? String(Math.round(order.totalCents / 100)) : "");
  const [communes, setCommunes] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!wilayaCode) { setCommunes([]); return; }
    void fetch(`/api/admin/communes?wilaya=${encodeURIComponent(wilayaCode)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((value) => { if (!cancelled && Array.isArray(value.communes)) setCommunes(value.communes as string[]); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [wilayaCode]);

  // A discontinued product stays selectable on an order that already contains it, so an edit
  // never silently drops a line the customer actually bought.
  const published = useMemo(() => products.filter((product) => product.status === "published" || (order?.items ?? []).some((item) => item.productId === product.id)), [products, order]);
  const productOf = (id: number) => published.find((product) => product.id === id) ?? null;
  const colorsOf = (product: Product | null) => product ? (product.colors.length ? product.colors : (product.color ? [product.color] : [""])) : [""];
  const sizesOf = (product: Product | null, color: string) => {
    if (!product) return [] as Array<{ label: string; stock: number }>;
    if (product.variants.length) return product.variants.filter((variant) => (variant.color ?? "") === color).map((variant) => ({ label: variant.size, stock: Number(variant.stock) || 0 }));
    return product.sizes.map((size) => ({ label: size.label, stock: Number(size.stock) || 0 }));
  };

  const patch = (index: number, next: Partial<OrderEditLine>) => setLines((current) => current.map((line, position) => position === index ? { ...line, ...next } : line));
  const rate = deliveryRates.find((item) => item.wilayaCode === wilayaCode);
  const subtotal = lines.reduce((total, line) => total + (productOf(line.productId)?.priceCents ?? 0) * line.quantity, 0);
  const shipping = rate ? (deliveryType === "office" ? rate.officeCents : rate.homeCents) : 0;
  const negotiatedCents = negotiated.trim() ? Math.round(Number(negotiated.trim().replace(",", ".")) * 100) : null;
  const effectiveTotal = negotiatedCents !== null && Number.isFinite(negotiatedCents) ? negotiatedCents : subtotal + shipping;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lines.length) { onError("La commande doit contenir au moins un article."); return; }
    if (lines.some((line) => !line.size)) { onError("Chaque article doit avoir une taille."); return; }
    const negotiatedCents = negotiated.trim() ? Math.round(Number(negotiated.trim().replace(",", ".")) * 100) : null;
    if (negotiatedCents !== null && (!Number.isFinite(negotiatedCents) || negotiatedCents < shipping)) { onError("Le prix négocié doit couvrir au moins la livraison."); return; }
    void onSave({ customerName: customerName.trim(), phone: phone.trim(), wilayaCode, commune, address: address.trim(), deliveryType, negotiatedTotalCents: negotiatedCents, items: lines });
  }

  return <div className="modal-backdrop admin-modal"><section>
    <button type="button" className="modal-x" aria-label="Fermer" onClick={onClose}>×</button>
    <span className="admin-kicker">{order ? `Commande ${order.orderNumber}` : "Vente hors boutique"}</span>
    <h2>{order ? "Modifier la commande" : "Nouvelle commande"}</h2>
    <p className="order-edit-note">{order
      ? "Le stock est ajusté automatiquement et la ligne Google Sheets est réexportée. L’événement Purchase déjà envoyé à Meta n’est pas modifié : il garde la valeur au moment de la vente."
      : "Pour une commande prise par téléphone, WhatsApp ou Instagram. Le stock est réservé et la ligne part vers Google Sheets et ZR Express comme une commande normale. Aucune attribution Meta et aucun événement Purchase : la campagne ne doit pas être créditée d’une vente qu’elle n’a pas amenée."}</p>
    <form onSubmit={submit}>
      <div className="form-row"><label>Nom du client<input value={customerName} onChange={(event) => setCustomerName(event.target.value)} required minLength={3} /></label><label>Téléphone<input value={phone} onChange={(event) => setPhone(event.target.value)} type="tel" inputMode="tel" required /></label></div>
      <div className="form-row"><label>Wilaya<select value={wilayaCode} onChange={(event) => { setWilayaCode(event.target.value); setCommune(""); }} required>{deliveryRates.map((item) => <option key={item.wilayaCode} value={item.wilayaCode}>{item.wilayaCode} · {item.wilayaNameFr}</option>)}</select></label><label>Commune<select value={commune} onChange={(event) => setCommune(event.target.value)} required disabled={!communes.length}><option value="">{communes.length ? "Choisir…" : "Chargement…"}</option>{communes.map((name) => <option key={name} value={name}>{name}</option>)}</select></label></div>
      <label>Adresse<input value={address} onChange={(event) => setAddress(event.target.value)} /></label>
      <fieldset className="delivery-choice"><legend>Mode de livraison</legend><label><input type="radio" checked={deliveryType === "home"} onChange={() => setDeliveryType("home")} /> <span>À domicile</span>{rate && <b>{money(rate.homeCents)}</b>}</label><label><input type="radio" checked={deliveryType === "office"} onChange={() => setDeliveryType("office")} /> <span>Au bureau</span>{rate && <b>{money(rate.officeCents)}</b>}</label></fieldset>

      <div className="order-edit-lines">
        <div className="card-title"><div><h3>Articles</h3><p>Le prix est repris du catalogue, jamais saisi ici.</p></div><button type="button" className="secondary-button" onClick={() => { const first = published[0]; if (!first) { onError("Aucun produit publié."); return; } const color = colorsOf(first)[0] ?? ""; setLines((current) => [...current, { productId: first.id, size: sizesOf(first, color)[0]?.label ?? "", color, quantity: 1 }]); }}>Ajouter un article</button></div>
        {lines.map((line, index) => {
          const product = productOf(line.productId);
          const colors = colorsOf(product);
          const sizes = sizesOf(product, line.color);
          return <div className="order-edit-line" key={`${line.productId}-${index}`}>
            <label>Produit<select value={line.productId} onChange={(event) => { const next = productOf(Number(event.target.value)); const color = colorsOf(next)[0] ?? ""; patch(index, { productId: Number(event.target.value), color, size: sizesOf(next, color)[0]?.label ?? "" }); }}>{published.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Couleur<select value={line.color} onChange={(event) => { const color = event.target.value; patch(index, { color, size: sizesOf(product, color)[0]?.label ?? "" }); }}>{colors.map((color) => <option key={color} value={color}>{color || "—"}</option>)}</select></label>
            <label>Taille<select value={line.size} onChange={(event) => patch(index, { size: event.target.value })} required><option value="">Choisir…</option>{sizes.map((size) => <option key={size.label} value={size.label}>{size.label} ({size.stock} en stock)</option>)}</select></label>
            <label>Qté<input type="number" min="1" max="10" value={line.quantity} onChange={(event) => patch(index, { quantity: Math.min(10, Math.max(1, Number(event.target.value) || 1)) })} /></label>
            <div className="order-edit-line-end"><strong>{money((product?.priceCents ?? 0) * line.quantity)}</strong><button type="button" className="order-delete-button" onClick={() => setLines((current) => current.filter((_, position) => position !== index))}>Retirer</button></div>
          </div>;
        })}
      </div>

      <div className="checkout-breakdown"><span>Sous-total<b>{money(subtotal)}</b></span><span>Livraison<b>{rate ? money(shipping) : "—"}</b></span></div>
      <label className="negotiated-price">Prix total négocié <small>livraison comprise — laissez vide pour garder le tarif catalogue</small>
        <div className="negotiated-field"><input value={negotiated} onChange={(event) => setNegotiated(event.target.value.replace(/[^\d.,]/g, ""))} inputMode="decimal" placeholder={String(Math.round((subtotal + shipping) / 100))} /><span>DZD</span></div>
      </label>
      <div className="checkout-total"><span>{order ? "Nouveau total" : "Total"}</span><strong>{money(effectiveTotal)}</strong></div>
      {negotiatedCents !== null && negotiatedCents !== subtotal + shipping && <p className="order-edit-diff">Tarif catalogue : {money(subtotal + shipping)} — remise de {money(subtotal + shipping - negotiatedCents)}</p>}
      {order && effectiveTotal !== order.totalCents && <p className="order-edit-diff">Ancien total : {money(order.totalCents)}</p>}
      <div className="modal-actions"><button type="button" onClick={onClose}>Annuler</button><button className="admin-primary" disabled={busy}>{busy ? "Enregistrement…" : order ? "Enregistrer" : "Créer la commande"}</button></div>
    </form>
  </section></div>;
}

function initialVariants(product: Product | null): ProductVariant[] {
  if (product?.variants.length) return product.variants;
  const sizes = product?.sizes.length ? product.sizes : [{ label: "90", stock: 0, age: "", weight: "", height: "" }];
  const colors = product ? (product.colors.length ? product.colors : (product.color ? [product.color] : [""])) : [""];
  return colors.flatMap((color, colorIndex) => sizes.map((size) => ({ color, size: size.label, stock: colorIndex === 0 ? size.stock : 0, age: size.age, weight: size.weight, height: size.height })));
}

const EDITOR_STEPS = ["L’essentiel", "Photos et couleurs", "Tailles et stock", "Textes"] as const;

/** Le slug suit le nom tant que personne ne l'a saisi a la main. */
function slugify(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function ProductEditor({ product, busy, csrfToken, onError, onClose, onSave }: { product: Product | null; busy: boolean; csrfToken: string; onError: (value: string) => void; onClose: () => void; onSave: (body: Partial<Product>) => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(product?.name ?? "");
  const [slug, setSlug] = useState(product?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(Boolean(product));
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
  function changeName(value: string) {
    setName(value);
    if (!slugEdited) setSlug(slugify(value));
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
    const status = String(form.get("status"));
    // Les etapes masquees ne peuvent pas recevoir le focus, donc la validation native
    // du navigateur bloquerait l'envoi sans rien montrer. On verifie ici et on ouvre
    // l'etape qui pose probleme.
    if (name.trim().length < 2 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !(Number(form.get("price")) >= 0) || !(Number(form.get("cost")) >= 0)) {
      setStep(0); onError("Nom, slug, prix et coût sont obligatoires. Le slug n’accepte que des minuscules, des chiffres et des tirets."); return;
    }
    if (status === "published" && images.length === 0) { setStep(1); onError("Ajoutez au moins une photo avant de publier."); return; }
    if (status === "published" && cleanVariants.length === 0) { setStep(2); onError("Ajoutez au moins une taille avant de publier."); return; }
    onSave({ id: product?.id, name: String(form.get("name")), slug: String(form.get("slug")), priceCents: Math.round(Number(form.get("price")) * 100), costCents: Math.round(Number(form.get("cost")) * 100), compareAtCents: form.get("compareAt") ? Math.round(Number(form.get("compareAt")) * 100) : null, currency: "DZD", status: status as Product["status"], category: String(form.get("category")), badge: String(form.get("badge") || "") || null, color: cleanColors.join(", "), colors: cleanColors, shortDescription: String(form.get("short") || ""), description: String(form.get("description") || ""), materials: String(form.get("materials") || ""), care: String(form.get("care") || ""), images, colorImages: Object.fromEntries(Object.entries(colorImages).filter(([color, image]) => cleanColors.includes(color) && images.includes(image))), features: String(form.get("features") || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean), translations: { en: { name: String(form.get("en-name") || ""), shortDescription: String(form.get("en-short") || ""), description: String(form.get("en-description") || ""), materials: String(form.get("en-materials") || ""), care: String(form.get("en-care") || ""), features: String(form.get("en-features") || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean) }, ar: { name: String(form.get("ar-name") || ""), shortDescription: String(form.get("ar-short") || ""), description: String(form.get("ar-description") || ""), materials: String(form.get("ar-materials") || ""), care: String(form.get("ar-care") || ""), features: String(form.get("ar-features") || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean) } }, sizes: cleanSizes, variants: cleanVariants, testimonials: cleanTestimonials, sourceUrl: product?.sourceUrl });
  }
  return <div className="modal-backdrop admin-modal"><section><button className="modal-x" onClick={onClose}>×</button><span className="admin-kicker">Catalogue</span><h2>{product ? "Modifier le produit" : "Nouveau produit"}</h2><form onSubmit={submit}>
    <nav className="editor-steps" aria-label="Etapes du produit">{EDITOR_STEPS.map((label, index) => <button type="button" key={label} className={index === step ? "active" : ""} aria-current={index === step} onClick={() => setStep(index)}><b>{index + 1}</b><span>{label}</span></button>)}</nav>
    <div className="editor-step" hidden={step !== 0}>
    <div className="form-row"><label>Nom<input name="name" value={name} onChange={(event) => changeName(event.target.value)} /></label><label>Slug<input name="slug" value={slug} onChange={(event) => { setSlugEdited(true); setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-")); }} /></label></div>
    <div className="form-row three"><label>Prix de vente (DZD)<input name="price" type="number" min="0" step="1" defaultValue={product ? product.priceCents / 100 : ""} /></label><label>Ancien prix (DZD)<input name="compareAt" type="number" min="0" step="1" defaultValue={product?.compareAtCents ? product.compareAtCents / 100 : ""} /></label><label>Statut<select name="status" defaultValue={product?.status || "draft"}><option value="draft">Brouillon</option><option value="published">Publié</option><option value="archived">Archivé</option></select></label></div>
    <div className="form-row private-cost-row"><label>Coût d’achat privé (DZD)<input name="cost" type="number" min="0" step="1" defaultValue={product ? product.costCents / 100 : ""} /></label><p>Visible uniquement dans l’administration. Il sert à calculer le bénéfice des commandes livrées.</p></div>
    <div className="form-row"><label>Catégorie<input name="category" defaultValue={product?.category || "Ensembles"} /></label><label>Badge<input name="badge" defaultValue={product?.badge || ""} /></label></div>
    </div>
    <div className="editor-step" hidden={step !== 1}>
    <ImageManager images={images} csrfToken={csrfToken} onChange={setImages} onError={onError} />
    <ColorsEditor colors={colors} onChange={changeColors} />
    <ColorImageEditor colors={colors} images={images} value={colorImages} onChange={setColorImages} />
    </div>
    <div className="editor-step" hidden={step !== 2}>
    <VariantStockEditor variants={variants} colors={colors} onChange={setVariants} />
    </div>
    <div className="editor-step" hidden={step !== 3}>
    <label>Accroche<textarea name="short" rows={2} defaultValue={product?.shortDescription} /></label><label>Description<textarea name="description" rows={4} defaultValue={product?.description} /></label>
    <div className="form-row"><label>Matières<textarea name="materials" rows={3} defaultValue={product?.materials} /></label><label>Entretien<textarea name="care" rows={3} defaultValue={product?.care} /></label></div>
    <label>Points forts — un par ligne<textarea name="features" rows={3} defaultValue={product?.features.join("\n")} /></label>
    <ProductTranslationsEditor product={product} />
    <TestimonialsEditor testimonials={testimonials} onChange={setTestimonials} />
    </div>
    <div className="modal-actions"><button type="button" onClick={onClose}>Annuler</button>{step > 0 && <button type="button" onClick={() => setStep(step - 1)}>← Précédent</button>}{step < EDITOR_STEPS.length - 1 && <button type="button" onClick={() => setStep(step + 1)}>Suivant →</button>}<button className="admin-primary" disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer"}</button></div>
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
  const unknown = sizes.some((size) => size.label.trim() && frenchAgeLabel(size) === size.label.trim());
  function update(index: number, patch: Partial<ProductSize>) { onChange(sizes.map((size, itemIndex) => itemIndex === index ? { ...size, ...patch } : size)); }
  return <div className="structured-editor"><div className="structured-title"><div><strong>Tailles et quantités</strong><span>Stock total : {stock} pièce{stock > 1 ? "s" : ""}</span></div><button type="button" onClick={() => onChange([...sizes, { label: "", stock: 0, age: "", weight: "", height: "" }])}>+ Ajouter une taille</button></div>{sizes.length === 0 ? <p className="empty-structured">Aucune taille. Ajoutez au moins une ligne.</p> : <div className="size-editor age-size-editor"><div className="size-editor-head"><span>Taille (cm)</span><span>Âge affiché</span><span>Stature de l’enfant</span><span>Quantité</span><span /></div>{sizes.map((size, index) => {
    const typed = size.label.trim();
    const age = typed ? frenchAgeLabel(size) : "";
    const known = Boolean(age) && age !== typed;
    return <div className="size-editor-row" key={index}><input aria-label="Taille en centimètres" inputMode="numeric" value={size.label} placeholder="Ex. 90" onChange={(event) => update(index, { label: event.target.value.trim(), age: "", weight: "", height: "" })} /><output className={known ? "derived" : "derived pending"}>{known ? age : "—"}</output><output className={known ? "derived" : "derived pending"}>{known ? recommendedHeightLabel(size, "fr") : "—"}</output><input aria-label="Quantité" type="number" min="0" step="1" value={size.stock} onChange={(event) => update(index, { stock: Math.max(0, Number(event.target.value) || 0) })} /><button type="button" aria-label="Supprimer la taille" onClick={() => onChange(sizes.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>;
  })}</div>}{unknown && <p className="empty-structured">Taille non reconnue : saisissez le nombre du fournisseur, par exemple 90, 100, 110 ou 120.</p>}</div>;
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
  return <div className="image-manager"><div className="field-title">Images du produit</div><label htmlFor={inputId} className={`drop-zone compact ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}><input id={inputId} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => void upload(Array.from(event.target.files || []))} /><strong>{uploading ? "Envoi des photos…" : "Déposez vos photos ici"}</strong><span>Les photos sont publiées telles quelles · la première image servira au guide des tailles</span></label>{images.length > 0 && <div className="uploaded-image-grid">{images.map((image, index) => <div key={`${image}-${index}`}><Image src={image} alt="" fill sizes="120px" unoptimized={image.startsWith("/api/media/")} /><span>{index === 0 ? "Couverture" : index + 1}</span><div><button type="button" disabled={index === 0} onClick={() => onChange([image, ...images.filter((_, itemIndex) => itemIndex !== index)])}>★</button><button type="button" onClick={() => onChange(images.filter((_, itemIndex) => itemIndex !== index))}>×</button></div></div>)}</div>}</div>;
}
