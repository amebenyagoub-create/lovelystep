"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import LanguageSwitcher from "@/app/language-switcher";
import { parseStoredCart, type CartItem } from "@/lib/cart";
import { localizedAgeLabel, recommendedHeightLabel } from "@/lib/product-size";
import { isProductOutOfStock } from "@/lib/product-stock";
import type { PublicProduct } from "@/lib/types";
import { trackMeta } from "@/lib/meta-pixel";
import { contentId } from "@/lib/meta/events";
import { useLocale } from "@/lib/use-locale";
import { deliveryPromise } from "@/lib/delivery-promise";

const CART_KEY = "lovelystep_cart";
const productCopy = {
  fr: { announcement: "Paiement à la livraison · Confirmation par téléphone · Échange facile", back: "← Retour à la boutique", cart: "Voir mon panier", home: "Accueil", save: "Économisez", cod: "Payez seulement à la livraison", codText: "Commandez sans carte. Nous confirmons par téléphone avant l’envoi.", chooseSize: "Choisir l’âge", sizeGuide: "Guide des âges", soldOut: "Épuisé", stock: "en stock", add: "Ajouter au panier", choose: "Choisissez l’âge de l’enfant.", love: "Pourquoi on l’aime", comfort: "Confortable à chaque petit pas", materials: "Matières", care: "Entretien", delivery: "Livraison & paiement", goodChoice: "Bien choisir", sizeAdvice: "Mesurez l’enfant debout et pieds nus comme illustré. Utilisez sa stature en priorité ; l’âge reste indicatif. Entre deux tailles, choisissez la plus grande.", age: "Âge conseillé", weight: "Poids", height: "Stature", discover: "À découvrir aussi", maybe: "Vous aimerez peut-être", addShort: "Ajouter", orderNow: "Commander maintenant", reviews: "avis", deliveryTracked: "Livraison suivie", shippingByWilaya: "Frais calculés selon votre wilaya", exchangeSize: "Échange de taille", exchangeHelp: "Notre équipe vous accompagne", codShort: "Paiement à la livraison", codHelp: "Aucune carte bancaire nécessaire" },
  en: { announcement: "Cash on delivery · Phone confirmation · Easy exchange", back: "← Back to store", cart: "View my cart", home: "Home", save: "Save", cod: "Pay only on delivery", codText: "Order without a card. We confirm by phone before shipping.", chooseSize: "Choose the age", sizeGuide: "Age guide", soldOut: "Sold out", stock: "in stock", add: "Add to cart", choose: "Choose the child’s age.", love: "Why we love it", comfort: "Comfort for every little step", materials: "Materials", care: "Care", delivery: "Delivery & payment", goodChoice: "Choose well", sizeAdvice: "Measure the child standing barefoot as illustrated. Use height first; age is only a guide. If between two sizes, choose the larger one.", age: "Recommended age", weight: "Weight", height: "Height", discover: "Discover more", maybe: "You may also like", addShort: "Add", orderNow: "Order now", reviews: "reviews", deliveryTracked: "Tracked delivery", shippingByWilaya: "Fee calculated for your wilaya", exchangeSize: "Size exchange", exchangeHelp: "Our team will help you", codShort: "Cash on delivery", codHelp: "No bank card required" },
  ar: { announcement: "الدفع عند الاستلام · تأكيد هاتفي · استبدال سهل", back: "العودة إلى المتجر →", cart: "عرض السلة", home: "الرئيسية", save: "وفروا", cod: "الدفع فقط عند الاستلام", codText: "اطلبوا دون بطاقة. نؤكد الطلب هاتفياً قبل الشحن.", chooseSize: "اختيار المقاس", sizeGuide: "دليل المقاسات", soldOut: "نفد", stock: "متوفر", add: "أضف إلى السلة", choose: "اختاروا المقاس.", love: "لماذا نحبّه", comfort: "راحة مع كل خطوة صغيرة", materials: "الخامات", care: "العناية", delivery: "التوصيل والدفع", goodChoice: "اختيار المقاس", sizeAdvice: "قيسوا طول الطفل وهو واقف وحافي القدمين كما في الصورة. اعتمدوا الطول أولاً، فالعمر إرشادي فقط. بين مقاسين اختاروا الأكبر.", age: "العمر", weight: "الوزن", height: "الطول", discover: "اكتشفوا أيضاً", maybe: "قد يعجبكم أيضاً", addShort: "أضف", orderNow: "اطلب الآن", reviews: "تقييمات", deliveryTracked: "توصيل متابع", shippingByWilaya: "السعر حسب الولاية", exchangeSize: "استبدال المقاس", exchangeHelp: "فريقنا يساعدكم", codShort: "الدفع عند الاستلام", codHelp: "لا حاجة لبطاقة بنكية" },
} as const;

export default function ProductDetail({ product, related }: { product: PublicProduct; related: PublicProduct[] }) {
  const router = useRouter();
  const colors = product.colors.length ? product.colors : (product.color ? [product.color] : []);
  const [activeImage, setActiveImage] = useState(product.colorImages[colors[0]] || product.images[0] || "/images/soft-days.jpg");
  const { locale, setLocale, dir, t } = useLocale();
  const copy = productCopy[locale];
  const promise = deliveryPromise(locale);
  const outOfStock = isProductOutOfStock(product);
  const outOfStockLabel = locale === "ar" ? "نفد المخزون" : locale === "en" ? "Out of stock" : "Rupture de stock";
  const translated = locale === "fr" ? undefined : product.translations[locale];
  const display = { name: translated?.name || product.name, shortDescription: translated?.shortDescription || product.shortDescription, description: translated?.description || product.description, materials: translated?.materials || product.materials, care: translated?.care || product.care, features: translated?.features?.length ? translated.features : product.features };
  const money = (cents: number) => new Intl.NumberFormat(locale === "ar" ? "ar-DZ" : locale === "en" ? "en-DZ" : "fr-DZ", { style: "currency", currency: "DZD", maximumFractionDigits: 0 }).format(cents / 100);
  const [selectedColor, setSelectedColor] = useState(colors[0] || "");
  const [size, setSize] = useState(product.variants.find((value) => value.color === (colors[0] || "") && value.stock > 0)?.size || product.sizes.find((value) => value.stock > 0)?.label || "");
  const [quantity, setQuantity] = useState(1);
  const [notice, setNotice] = useState("");
  const availableSizes = useMemo(() => product.variants.length
    ? product.variants.filter((variant) => variant.color === selectedColor).map((variant) => ({ label: variant.size, stock: variant.stock, age: variant.age, weight: variant.weight, height: variant.height }))
    : product.sizes, [product.sizes, product.variants, selectedColor]);
  const availableStock = availableSizes.find((value) => value.label === size)?.stock || 0;
  const reviewCount = product.testimonials.length;
  const ratings = product.testimonials.flatMap((item) => item.rating ? [item.rating] : []);
  const reviewAverage = ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : 0;

  useEffect(() => {
    void fetch("/api/analytics/visit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: `/produits/${product.slug}`, productId: product.id }) }).catch(() => undefined);
    trackMeta("ViewContent", { content_ids: [contentId(product.slug)], content_type: "product", content_name: product.name, content_category: product.category, value: product.priceCents / 100, currency: "DZD" });
  }, [product.id, product.priceCents, product.slug, product.name, product.category]);

  function selectColor(color: string) {
    setSelectedColor(color);
    setActiveImage(product.colorImages[color] || product.images[0] || "/images/soft-days.jpg");
    const nextSize = product.variants.find((variant) => variant.color === color && variant.stock > 0)?.size || (product.variants.length ? "" : product.sizes.find((item) => item.stock > 0)?.label || "");
    setSize(nextSize);
    setQuantity(1);
    setNotice("");
  }

  function addToCart(destination: "cart" | "checkout" = "cart") {
    if (!size) { setNotice(copy.choose); return; }
    if (availableStock < quantity) { setNotice(locale === "ar" ? `بقيت ${availableStock} قطعة فقط.` : locale === "en" ? `Only ${availableStock} item(s) remain in this size.` : `Il reste seulement ${availableStock} pièce(s) dans cette taille.`); return; }
    const cart: CartItem[] = parseStoredCart(localStorage.getItem(CART_KEY));
    const found = cart.find((item) => item.productId === product.id && item.size === size && item.color === selectedColor);
    if (found) found.quantity = Math.min(availableStock, found.quantity + quantity);
    else {
      const selectedSize = availableSizes.find((item) => item.label === size);
      cart.push({ productId: product.id, slug: product.slug, name: display.name, image: product.colorImages[selectedColor] || product.images[0] || "", size, sizeLabel: localizedAgeLabel({ label: size, age: selectedSize?.age }, locale), color: selectedColor || undefined, quantity, unitPriceCents: product.priceCents });
    }
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    trackMeta("AddToCart", { content_ids: [contentId(product.slug)], content_type: "product", content_name: display.name, content_category: product.category, contents: [{ id: contentId(product.slug), quantity, item_price: product.priceCents / 100 }], value: product.priceCents * quantity / 100, currency: "DZD", num_items: quantity });
    router.push(destination === "checkout" ? "/?checkout=1" : "/?bag=1");
  }

  return <div className="product-page" dir={dir}>
    <div className="announcement">{copy.announcement}</div>
    <header className="product-header"><Link href="/" className="brand"><Image src="/brand/lovelystep-logo.png" alt="Lovely Step" width={112} height={112} priority /></Link><Link className="back-link" href="/">{copy.back}</Link><div className="header-actions"><LanguageSwitcher locale={locale} onChange={setLocale} /><Link className="header-cart" href="/?bag=1" aria-label={copy.cart}><span className="cart-label-long">{copy.cart}</span><span className="cart-label-short">{t("cart")}</span></Link></div></header>
    <main>
      <div className="breadcrumbs"><Link href="/">{copy.home}</Link><span>/</span><span>{product.category}</span><span>/</span><strong>{display.name}</strong></div>
      <section className="product-detail-grid">
        <div className="gallery"><div className="gallery-main"><Image src={activeImage} alt={display.name} fill priority sizes="(max-width: 900px) 100vw, 55vw" />{product.images.length > 1 && <span className="gallery-count">{Math.max(1, product.images.indexOf(activeImage) + 1)} / {product.images.length}</span>}</div>{product.images.length > 1 && <div className="thumbnails">{product.images.map((image) => <button type="button" aria-label={`${display.name} ${product.images.indexOf(image) + 1}`} key={image} className={image === activeImage ? "active" : ""} onClick={() => setActiveImage(image)}><Image src={image} alt="" fill sizes="90px" /></button>)}</div>}</div>
        <div className="product-panel">{outOfStock ? <span className="badge standalone badge-out-of-stock">{outOfStockLabel}</span> : product.badge && <span className="badge standalone">{product.badge}</span>}<span className="product-category">{product.category}</span><h1>{display.name}</h1>{reviewCount > 0 && <a className="rating-summary" href="#avis">{reviewAverage > 0 && <><span>{"★".repeat(Math.round(reviewAverage))}{"☆".repeat(5 - Math.round(reviewAverage))}</span><strong>{reviewAverage.toFixed(1)}</strong></>}<u>{reviewCount} {copy.reviews}</u></a>}<p className="product-lead">{display.shortDescription}</p><div className="detail-price"><strong>{money(product.priceCents)}</strong>{product.compareAtCents && <del>{money(product.compareAtCents)}</del>}{product.compareAtCents && <span>{copy.save} {money(product.compareAtCents - product.priceCents)}</span>}</div>
          <div className="cod-card"><span>✓</span><div><strong>{copy.cod}</strong><p>{copy.codText}</p></div></div>
          {colors.length > 0 && <fieldset className="color-picker"><legend>{t("color")} <strong>{selectedColor}</strong></legend><div>{colors.map((color) => { const colorImage = product.colorImages[color] || product.images[0]; return <button type="button" key={color} aria-pressed={selectedColor === color} className={selectedColor === color ? "selected" : ""} onClick={() => selectColor(color)}>{colorImage && <Image src={colorImage} alt="" width={46} height={54} />}<span>{color}</span></button>; })}</div></fieldset>}
          <fieldset className="size-picker"><div><legend>{copy.chooseSize}</legend><a href="#guide-tailles">{copy.sizeGuide}</a></div><div className="size-options">{availableSizes.map((item) => <button type="button" key={item.label} disabled={item.stock < 1} className={size === item.label ? "selected" : ""} onClick={() => { setSize(item.label); setQuantity(1); setNotice(""); }}>{localizedAgeLabel(item, locale)}<small>{item.stock < 1 ? copy.soldOut : `${item.stock} ${copy.stock}`}</small></button>)}</div></fieldset>
          <div className="buy-row"><div className="quantity large"><button type="button" aria-label="−" onClick={() => setQuantity(Math.max(1, quantity - 1))}>−</button><b>{quantity}</b><button type="button" aria-label="+" disabled={!size || quantity >= availableStock} onClick={() => setQuantity(Math.min(availableStock || 1, quantity + 1))}>+</button></div><button className="secondary-button add-cart-button" disabled={!size || availableStock < 1} onClick={() => addToCart("cart")}>{copy.add}</button><button className="primary-button buy-button" disabled={!size || availableStock < 1} onClick={() => addToCart("checkout")}>{copy.orderNow} · {money(product.priceCents * quantity)}</button></div>{notice && <p className="form-error">{notice}</p>}
          <div className="product-reassurance"><p><b>🚚 {copy.deliveryTracked}</b><span>{promise.delay || copy.shippingByWilaya}</span></p><p><b>↔ {copy.exchangeSize}</b><span>{promise.exchange || copy.exchangeHelp}</span></p><p><b>✓ {copy.codShort}</b><span>{copy.codHelp}</span></p></div>
        </div>
      </section>
      <section className="product-content"><article><span className="eyebrow">{copy.love}</span><h2>{copy.comfort}</h2><p>{display.description}</p><ul>{display.features.map((feature) => <li key={feature}>✓ {feature}</li>)}</ul></article><aside><details open><summary>{copy.materials}</summary><p>{display.materials}</p></details><details><summary>{copy.care}</summary><p>{display.care}</p></details><details><summary>{copy.delivery}</summary><p>{copy.codText}</p></details></aside></section>
      <section className="size-section" id="guide-tailles"><div><span className="eyebrow">{copy.goodChoice}</span><h2>{copy.sizeGuide}</h2><p>{copy.sizeAdvice}</p><div className="size-table"><div className="size-row age-size-row size-head"><span>{copy.age}</span><span>{copy.height}</span><span>{locale === "ar" ? "التوفر" : locale === "en" ? "Availability" : "Disponibilité"}</span></div>{product.sizes.map((item) => <div className="size-row age-size-row" key={item.label}><strong>{localizedAgeLabel(item, locale)}</strong><span>{recommendedHeightLabel(item, locale)}</span><span>{item.stock > 0 ? copy.stock : copy.soldOut}</span></div>)}</div></div><div className="size-guide-visual"><Image src="/images/size-guide-how-to-measure.webp" alt={`${copy.sizeGuide} — ${copy.sizeAdvice}`} fill sizes="(max-width: 800px) calc(100vw - 40px), 38vw" /></div></section>
      {product.testimonials.length > 0 && <section className="product-testimonials" id="avis"><div className="section-heading"><div><span className="eyebrow">Avis sur ce produit</span><h2>Ce qu’en disent les acheteurs</h2></div><p>Ces avis ont été importés depuis la source indiquée et vérifiés dans le dashboard.</p></div><div className="testimonial-grid">{product.testimonials.map((item, index) => <article key={`${item.quote}-${index}`}><div className="stars">{item.rating ? "★".repeat(Math.round(item.rating)) : "Avis client"}</div><blockquote>“{item.quote}”</blockquote><strong>{item.author || "Acheteur vérifié sur la source"}</strong><small>{item.source || "Source fournisseur"}</small></article>)}</div></section>}
      {related.length > 0 && <section className="related"><div className="section-heading"><div><span className="eyebrow">{copy.discover}</span><h2>{copy.maybe}</h2></div></div><div className="product-grid compact">{related.map((item) => { const image = item.colorImages[item.colors[0] || item.color] || item.images[0] || "/images/soft-days.jpg"; const itemTranslation = locale === "fr" ? undefined : item.translations[locale]; const itemName = itemTranslation?.name || item.name; const itemOutOfStock = isProductOutOfStock(item); return <article className="product-card" key={item.id}><Link href={`/produits/${item.slug}`} className="product-image">{itemOutOfStock && <span className="badge badge-out-of-stock">{outOfStockLabel}</span>}<Image src={image} alt={itemName} fill sizes="33vw" /></Link><div className="product-info"><span className="product-category">{item.category}</span><Link href={`/produits/${item.slug}`}><h3>{itemName}</h3></Link><strong>{money(item.priceCents)}</strong></div></article>; })}</div></section>}
    </main>
    <div className="mobile-buy">{(promise.delay || promise.exchange) && <p className="mobile-buy-promise">{[promise.delay, promise.exchange].filter(Boolean).join(" · ")}</p>}<div><small>{size ? localizedAgeLabel(availableSizes.find((item) => item.label === size) || { label: size }, locale) : display.name}</small><strong>{money(product.priceCents * quantity)}</strong></div><button disabled={outOfStock} onClick={() => addToCart("checkout")}>{outOfStock ? outOfStockLabel : copy.orderNow}</button></div>
    <footer><Image src="/brand/lovelystep-logo.png" alt="Lovely Step" width={120} height={120} /><p>Tiny Steps, Big Love</p><small>© {new Date().getFullYear()} Lovely Step. {t("rights")}</small><small>{t("legalEntity")}</small><nav className="legal-links"><Link href="/mentions-legales">{t("legalNotices")}</Link></nav></footer>
  </div>;
}
