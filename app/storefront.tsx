"use client";

import Image from "next/image";
import Link from "next/link";
import { type CSSProperties, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import LanguageSwitcher from "./language-switcher";
import { parseStoredCart, type CartItem } from "@/lib/cart";
import { trackMeta } from "@/lib/meta-pixel";
import { localizedAgeLabel } from "@/lib/product-size";
import type { AlgeriaWilaya, Customer, DeliveryRate, DeliveryType, PublicProduct, StoreSettings } from "@/lib/types";
import { useLocale } from "@/lib/use-locale";

const CART_KEY = "lovelystep_cart";

function Icon({ name }: { name: "bag" | "menu" | "close" | "truck" | "cash" | "heart" | "shield" | "arrow" | "user" }) {
  const paths = { bag: "M6 8h12l-1 12H7L6 8Zm3 0V6a3 3 0 0 1 6 0v2", menu: "M4 7h16M4 12h16M4 17h16", close: "M6 6l12 12M18 6 6 18", truck: "M3 6h11v10H3V6Zm11 4h4l3 3v3h-7v-6ZM7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z", cash: "M3 6h18v12H3V6Zm9 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 9V8h2M18 15v1h-2", heart: "M12 20s-8-4.8-8-10a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.2-8 10-8 10Z", shield: "M12 3 5 6v5c0 4.8 2.8 8.2 7 10 4.2-1.8 7-5.2 7-10V6l-7-3Zm-3 9 2 2 4-5", arrow: "m9 18 6-6-6-6", user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 8a7 7 0 0 0-14 0" };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

type CheckoutState = { fullName: string; phone: string; wilayaCode: string; commune: string; deliveryType: DeliveryType; notes: string };
const emptyCheckout: CheckoutState = { fullName: "", phone: "", wilayaCode: "", commune: "", deliveryType: "home", notes: "" };

export default function Storefront({ products, settings, wilayas, deliveryRates }: { products: PublicProduct[]; settings: StoreSettings; wilayas: AlgeriaWilaya[]; deliveryRates: DeliveryRate[] }) {
  const { locale, setLocale, t, dir } = useLocale();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [checkout, setCheckout] = useState<CheckoutState>(emptyCheckout);
  const cartLoaded = useRef(false);

  const money = (cents: number) => new Intl.NumberFormat(locale === "ar" ? "ar-DZ" : locale === "en" ? "en-DZ" : "fr-DZ", { style: "currency", currency: "DZD", maximumFractionDigits: 0 }).format(cents / 100);
  const text = (value: StoreSettings["announcement"]) => value[locale] || value.fr;
  const style = { "--navy": settings.theme.navy, "--coral": settings.theme.coral, "--cream": settings.theme.cream, "--sand": settings.theme.sand, "--pale": settings.theme.background } as CSSProperties;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCart(parseStoredCart(localStorage.getItem(CART_KEY)));
      cartLoaded.current = true;
      if (new URLSearchParams(window.location.search).get("bag") === "1") setCartOpen(true);
    }, 0);
    void fetch("/api/account/me", { cache: "no-store" }).then((response) => response.json()).then((value) => {
      if (!value.customer) return;
      const current = value.customer as Customer;
      setCustomer(current);
      setCheckout((state) => ({ ...state, fullName: `${current.firstName} ${current.lastName}`.trim(), phone: current.phone, wilayaCode: current.wilayaCode, commune: current.commune }));
    }).catch(() => undefined);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => { if (cartLoaded.current) localStorage.setItem(CART_KEY, JSON.stringify(cart)); }, [cart]);
  useEffect(() => { void fetch("/api/analytics/visit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "/" }) }).catch(() => undefined); }, []);

  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cart.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  const categories = [...new Set(products.map((product) => product.category))];
  const selectedWilaya = wilayas.find((wilaya) => wilaya.code === checkout.wilayaCode);
  const selectedRate = deliveryRates.find((rate) => rate.wilayaCode === checkout.wilayaCode && rate.active);
  const shipping = selectedRate ? (checkout.deliveryType === "office" ? selectedRate.officeCents : selectedRate.homeCents) : 0;
  const total = subtotal + shipping;
  const heroImage = settings.heroImage || "/images/lovelystep-hero-v2.webp";
  const productText = (product: PublicProduct) => {
    const translated = locale === "fr" ? undefined : product.translations[locale];
    return { name: translated?.name || product.name, shortDescription: translated?.shortDescription || product.shortDescription };
  };

  function add(product: PublicProduct) {
    const firstVariant = product.variants.find((value) => value.stock > 0);
    const size = firstVariant?.size ?? product.sizes.find((value) => value.stock > 0)?.label;
    if (!size) return;
    const color = firstVariant?.color || product.colors[0] || product.color || undefined;
    const image = (color ? product.colorImages[color] : "") || product.images[0] || "";
    const display = productText(product);
    const sizeDetails = firstVariant ?? product.sizes.find((value) => value.label === size);
    const sizeLabel = localizedAgeLabel({ label: size, age: sizeDetails?.age }, locale);
    setCart((current) => {
      const found = current.find((item) => item.productId === product.id && item.size === size && item.color === color);
      return found ? current.map((item) => item === found ? { ...item, quantity: Math.min(10, item.quantity + 1) } : item)
        : [...current, { productId: product.id, slug: product.slug, name: display.name, image, size, sizeLabel, color, quantity: 1, unitPriceCents: product.priceCents }];
    });
    trackMeta("AddToCart", { content_ids: [product.slug], content_type: "product", value: product.priceCents / 100, currency: "DZD" });
    setCartOpen(true);
  }

  const updateQuantity = (index: number, delta: number) => setCart((current) => current.flatMap((item, itemIndex) => itemIndex === index ? (item.quantity + delta <= 0 ? [] : [{ ...item, quantity: Math.min(10, item.quantity + delta) }]) : [item]));

  async function placeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true); setMessage(""); setOrderSuccess(false);
    try {
      const response = await fetch("/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...checkout, items: cart.map(({ productId, size, color, quantity }) => ({ productId, size, color, quantity })) }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(data.error || t("accountError")); return; }
      trackMeta("Purchase", { content_ids: cart.map((item) => item.slug), contents: cart.map((item) => ({ id: item.slug, quantity: item.quantity })), content_type: "product", value: Number(data.totalCents || total) / 100, currency: "DZD" });
      setCart([]); setOrderSuccess(true); setMessage(locale === "ar" ? `شكراً! تم تسجيل طلبكم ${data.orderNumber}. سنتصل بكم للتأكيد.` : locale === "en" ? `Thank you! Order ${data.orderNumber} is registered. We will call to confirm it.` : `Merci ! Votre commande ${data.orderNumber} est enregistrée. Nous vous appellerons pour la confirmer.`);
    } catch { setMessage(locale === "ar" ? "تعذر الاتصال بالخادم. حاولوا من جديد." : locale === "en" ? "The server could not be reached. Please try again." : "Connexion au serveur impossible. Vérifiez votre réseau puis réessayez."); }
    finally { setSubmitting(false); }
  }

  return <div className="store-shell" style={style} dir={dir}>
    <div className="announcement">{text(settings.announcement)}</div>
    <header className="site-header">
      <button className="icon-button mobile-only" aria-label="Menu" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button>
      <Link href="/" className="brand"><Image src="/brand/lovelystep-logo.png" alt="Lovely Step" width={116} height={116} priority /></Link>
      <nav className="main-nav" aria-label="Navigation"><a href="#nouveautes">{t("new")}</a>{categories.slice(0, 4).map((category) => <a key={category} href={`#${category.toLowerCase()}`}>{category}</a>)}<a href="#notre-promesse">{t("promise")}</a></nav>
      <div className="header-actions"><LanguageSwitcher locale={locale} onChange={setLocale} /><button className="account-button" onClick={() => setAccountOpen(true)}><Icon name="user" /><span>{customer ? customer.firstName : t("account")}</span></button><button className="bag-button" onClick={() => setCartOpen(true)}><Icon name="bag" /><span>{t("cart")}</span>{count > 0 && <b>{count}</b>}</button></div>
    </header>
    <main>
      <section className="hero">
        <div className="hero-backdrop" aria-hidden="true"><Image src={heroImage} alt="" fill priority sizes="100vw" unoptimized={heroImage.startsWith("/api/media/")} /></div>
        <div className="hero-copy"><span className="eyebrow">{text(settings.heroEyebrow)}</span><h1>{text(settings.heroTitle)} <em>{text(settings.heroAccent)}</em></h1><p>{text(settings.heroDescription)}</p><div className="hero-actions"><a className="primary-button" href="#nouveautes">{text(settings.primaryCta)}</a><a className="text-link" href="#notre-promesse">{t("promise")} <Icon name="arrow" /></a></div><div className="mini-trust"><span>✓ {t("noOnline")}</span><span>✓ {t("phoneConfirm")}</span></div></div>
      </section>
      <section className="trust-strip" id="notre-promesse">{[{ icon: "cash" as const, title: t("cod"), copy: t("codText") }, { icon: "truck" as const, title: t("tracked"), copy: t("trackedText") }, { icon: "heart" as const, title: t("children"), copy: t("childrenText") }, { icon: "shield" as const, title: t("exchange"), copy: t("exchangeText") }].map((item) => <article key={item.title}><Icon name={item.icon} /><div><strong>{item.title}</strong><span>{item.copy}</span></div></article>)}</section>
      <section className="collection" id="nouveautes"><div className="section-heading"><div><span className="eyebrow">{t("favorites")}</span><h2>{t("collection")}</h2></div><p>{t("collectionText")}</p></div><div className="product-grid">{products.map((product) => { const firstColor = product.colors[0] || product.color; const image = product.colorImages[firstColor] || product.images[0] || "/images/soft-days.jpg"; const display = productText(product); return <article className="product-card" key={product.id} id={product.category.toLowerCase()}><Link href={`/produits/${product.slug}`} className="product-image">{product.badge && <span className="badge">{product.badge}</span>}<Image src={image} alt={display.name} fill sizes="(max-width: 700px) 50vw, 33vw" unoptimized={image.startsWith("/api/media/")} /></Link><div className="product-info"><div><span className="product-category">{product.category}</span><Link href={`/produits/${product.slug}`}><h3>{display.name}</h3></Link><p>{product.colors.length ? product.colors.join(" · ") : product.color}</p></div><div className="price-line"><strong>{money(product.priceCents)}</strong>{product.compareAtCents && <del>{money(product.compareAtCents)}</del>}</div><div className="card-actions"><Link className="secondary-button" href={`/produits/${product.slug}`}>{t("viewProduct")}</Link><button aria-label={display.name} onClick={() => add(product)}><Icon name="bag" /></button></div></div></article>; })}</div></section>
      <section className="story"><div><span className="eyebrow">Tiny Steps, Big Love</span><h2>{text(settings.storyTitle)}</h2><p>{text(settings.storyDescription)}</p><a href="#nouveautes" className="primary-button">{t("findOutfit")}</a></div><Image src="/images/little-explorer.jpg" alt="Lovely Step" width={700} height={700} /></section>
    </main>
    <footer><Image src="/brand/lovelystep-logo.png" alt="Lovely Step" width={120} height={120} /><p>Tiny Steps, Big Love</p><small>© {new Date().getFullYear()} Lovely Step. {t("rights")}</small><Link href="/admin/login" className="admin-link">Administration</Link></footer>

    {menuOpen && <div className="mobile-menu"><button className="icon-button" aria-label="Close" onClick={() => setMenuOpen(false)}><Icon name="close" /></button><Image src="/brand/lovelystep-logo.png" alt="Lovely Step" width={130} height={130} /><LanguageSwitcher locale={locale} onChange={setLocale} /><a href="#nouveautes" onClick={() => setMenuOpen(false)}>{t("new")}</a>{categories.map((category) => <a key={category} href={`#${category.toLowerCase()}`} onClick={() => setMenuOpen(false)}>{category}</a>)}</div>}
    {cartOpen && <><button className="drawer-backdrop" aria-label="Close" onClick={() => setCartOpen(false)} /><aside className="cart-drawer" aria-label={t("cart")}><div className="drawer-head"><div><span>{t("yourCart")}</span><strong>{count} {count > 1 ? t("items") : t("item")}</strong></div><button className="icon-button" onClick={() => setCartOpen(false)} aria-label="Close"><Icon name="close" /></button></div>{cart.length === 0 ? <div className="empty-cart"><Icon name="bag" /><h3>{t("emptyCart")}</h3><p>{t("emptyCartText")}</p><button className="primary-button" onClick={() => setCartOpen(false)}>{t("seeCollection")}</button></div> : <><div className="cart-lines">{cart.map((item, index) => <div className="cart-line" key={`${item.productId}-${item.size}-${item.color || ""}`}><Image src={item.image} alt="" width={86} height={104} unoptimized={item.image.startsWith("/api/media/")} /><div><Link href={`/produits/${item.slug}`}>{item.name}</Link><span>{t("size")} : {item.sizeLabel || item.size}{item.color ? ` · ${t("color")} : ${item.color}` : ""}</span><div className="quantity"><button onClick={() => updateQuantity(index, -1)}>−</button><b>{item.quantity}</b><button onClick={() => updateQuantity(index, 1)}>+</button></div></div><strong>{money(item.unitPriceCents * item.quantity)}</strong></div>)}</div><div className="cart-summary"><div><span>{t("subtotal")}</span><strong>{money(subtotal)}</strong></div><div><span>{t("delivery")}</span><strong>{locale === "ar" ? "حسب الولاية" : locale === "en" ? "Based on wilaya" : "Selon la wilaya"}</strong></div><button className="primary-button full" onClick={() => { setCheckoutOpen(true); setMessage(""); setOrderSuccess(false); }}>{t("checkout")} · {money(subtotal)}</button><small>{t("cash")}</small></div></>}</aside></>}
    {checkoutOpen && <div className="modal-backdrop"><section className="checkout-modal">
      <button className="icon-button modal-close" aria-label="Close" onClick={() => setCheckoutOpen(false)}><Icon name="close" /></button>
      <span className="eyebrow">{t("cod")}</span><h2>{t("finish")}</h2>
      {orderSuccess ? <div className="success-message"><span>✓</span><p>{message}</p><button className="primary-button" onClick={() => { setCheckoutOpen(false); setCartOpen(false); }}>{t("finishButton")}</button></div> : <form onSubmit={placeOrder}>
        <label>{t("fullName")}<input value={checkout.fullName} onChange={(event) => setCheckout({ ...checkout, fullName: event.target.value })} autoComplete="name" required minLength={3} /></label>
        <label>{t("phone")}<input value={checkout.phone} onChange={(event) => setCheckout({ ...checkout, phone: event.target.value })} type="tel" autoComplete="tel" required placeholder="0550 00 00 00" /></label>
        <div className="form-row"><label>{t("wilaya")}<select value={checkout.wilayaCode} onChange={(event) => setCheckout({ ...checkout, wilayaCode: event.target.value, commune: "" })} required><option value="">{t("choose")}</option>{wilayas.map((wilaya) => <option key={wilaya.code} value={wilaya.code}>{wilaya.code} · {locale === "ar" ? wilaya.nameAr : wilaya.nameFr}</option>)}</select></label><label>{t("commune")}<select value={checkout.commune} onChange={(event) => setCheckout({ ...checkout, commune: event.target.value })} required disabled={!selectedWilaya}><option value="">{t("choose")}</option>{selectedWilaya?.communes.map((commune) => <option key={commune.code} value={commune.nameFr}>{locale === "ar" ? commune.nameAr : commune.nameFr}</option>)}</select></label></div>
        <fieldset className="delivery-choice"><legend>{t("deliveryMode")}</legend><label><input type="radio" checked={checkout.deliveryType === "home"} onChange={() => setCheckout({ ...checkout, deliveryType: "home" })} /> <Icon name="truck" /> {t("home")}</label><label><input type="radio" checked={checkout.deliveryType === "office"} onChange={() => setCheckout({ ...checkout, deliveryType: "office" })} /> <Icon name="shield" /> {t("office")}</label></fieldset>
        <label>{t("note")}<textarea value={checkout.notes} onChange={(event) => setCheckout({ ...checkout, notes: event.target.value })} rows={3} /></label>
        {message && <p className="form-error">{message}</p>}<div className="checkout-breakdown"><span>{t("subtotal")}<b>{money(subtotal)}</b></span><span>{t("shippingPrice")}<b>{selectedRate ? money(shipping) : "—"}</b></span></div><div className="checkout-total"><span>{t("total")}</span><strong>{money(total)}</strong></div><button className="primary-button full" disabled={submitting || !selectedRate}>{submitting ? t("sending") : t("confirm")}</button><small>{t("orderHelp")}</small>
      </form>}
    </section></div>}
    {accountOpen && <AccountModal customer={customer} wilayas={wilayas} locale={locale} t={t} onClose={() => setAccountOpen(false)} onCustomer={(value) => { setCustomer(value); setCheckout((state) => ({ ...state, fullName: `${value.firstName} ${value.lastName}`.trim(), phone: value.phone, wilayaCode: value.wilayaCode, commune: value.commune })); }} onLogout={() => { setCustomer(null); setCheckout(emptyCheckout); }} />}
  </div>;
}

function AccountModal({ customer, wilayas, locale, t, onClose, onCustomer, onLogout }: { customer: Customer | null; wilayas: AlgeriaWilaya[]; locale: "fr" | "en" | "ar"; t: ReturnType<typeof useLocale>["t"]; onClose: () => void; onCustomer: (customer: Customer) => void; onLogout: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [wilayaCode, setWilayaCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const communes = useMemo(() => wilayas.find((wilaya) => wilaya.code === wilayaCode)?.communes ?? [], [wilayaCode, wilayas]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const body = mode === "login" ? { phone: form.get("phone"), password: form.get("password") } : { firstName: form.get("firstName"), lastName: form.get("lastName"), phone: form.get("phone"), password: form.get("password"), wilayaCode, commune: form.get("commune"), address: form.get("address") };
    try {
      const response = await fetch(`/api/account/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) setMessage(value.error || t("accountError")); else onCustomer(value.customer as Customer);
    } catch { setMessage(t("accountError")); } finally { setBusy(false); }
  }

  async function logout() { await fetch("/api/account/logout", { method: "POST" }).catch(() => undefined); onLogout(); }

  return <div className="modal-backdrop"><section className="checkout-modal account-modal"><button className="icon-button modal-close" aria-label="Close" onClick={onClose}><Icon name="close" /></button><span className="eyebrow">Lovely Step</span><h2>{t("accountTitle")}</h2>{customer ? <div className="customer-profile"><span className="profile-icon"><Icon name="user" /></span><h3>{t("welcome")}, {customer.firstName} !</h3><p>{customer.phone}<br />{customer.commune}, {customer.wilayaName}</p><small>{t("savedAddress")}</small><button className="secondary-button" onClick={logout}>{t("logout")}</button></div> : <><div className="account-tabs"><button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setMessage(""); }}>{t("login")}</button><button className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setMessage(""); }}>{t("register")}</button></div><form onSubmit={submit}>{mode === "register" && <><div className="form-row"><label>{t("firstName")}<input name="firstName" autoComplete="given-name" required minLength={2} /></label><label>{t("lastName")}<input name="lastName" autoComplete="family-name" required minLength={2} /></label></div></>}<label>{t("phone")}<input name="phone" type="tel" autoComplete="tel" required placeholder="0550 00 00 00" /></label><label>{t("password")}<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} required /><small>{mode === "register" ? t("passwordHelp") : ""}</small></label>{mode === "register" && <><div className="form-row"><label>{t("wilaya")}<select value={wilayaCode} onChange={(event) => setWilayaCode(event.target.value)} required><option value="">{t("choose")}</option>{wilayas.map((wilaya) => <option key={wilaya.code} value={wilaya.code}>{wilaya.code} · {locale === "ar" ? wilaya.nameAr : wilaya.nameFr}</option>)}</select></label><label>{t("commune")}<select name="commune" disabled={!wilayaCode} required><option value="">{t("choose")}</option>{communes.map((commune) => <option key={commune.code} value={commune.nameFr}>{locale === "ar" ? commune.nameAr : commune.nameFr}</option>)}</select></label></div><label>{t("optionalAddress")}<input name="address" autoComplete="street-address" /></label></>}{message && <p className="form-error">{message}</p>}<button className="primary-button full" disabled={busy}>{busy ? t("sending") : mode === "login" ? t("login") : t("register")}</button></form></>}</section></div>;
}
