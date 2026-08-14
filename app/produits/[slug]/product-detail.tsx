"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import LanguageSwitcher from "@/app/language-switcher";
import { parseStoredCart, type CartItem } from "@/lib/cart";
import { localizedAgeLabel } from "@/lib/product-size";
import { isProductOutOfStock } from "@/lib/product-stock";
import type { PublicProduct } from "@/lib/types";
import { trackMeta } from "@/lib/meta-pixel";
import { contentId } from "@/lib/meta/events";
import { useLocale } from "@/lib/use-locale";

const CART_KEY = "lovelystep_cart";
const productCopy = {
  fr: { announcement: "Paiement à la livraison · Confirmation par téléphone · Échange facile", back: "← Retour à la boutique", cart: "Voir mon panier", home: "Accueil", save: "Économisez", cod: "Payez seulement à la livraison", codText: "Commandez sans carte. Nous confirmons par téléphone avant l’envoi.", chooseSize: "Choisir l’âge", sizeGuide: "Guide des âges", soldOut: "Épuisé", stock: "en stock", add: "Ajouter au panier", choose: "Choisissez l’âge de l’enfant.", love: "Pourquoi on l’aime", comfort: "Confortable à chaque petit pas", materials: "Matières", care: "Entretien", delivery: "Livraison & paiement", goodChoice: "Bien choisir", sizeAdvice: "Choisissez la tranche d’âge habituelle de l’enfant. En cas d’hésitation entre deux âges, prenez la tranche supérieure.", age: "Âge conseillé", weight: "Poids", height: "Stature", discover: "À découvrir aussi", maybe: "Vous aimerez peut-être", addShort: "Ajouter" },
  en: { announcement: "Cash on delivery · Phone confirmation · Easy exchange", back: "← Back to store", cart: "View my cart", home: "Home", save: "Save", cod: "Pay only on delivery", codText: "Order without a card. We confirm by phone before shipping.", chooseSize: "Choose the age", sizeGuide: "Age guide", soldOut: "Sold out", stock: "in stock", add: "Add to cart", choose: "Choose the child’s age.", love: "Why we love it", comfort: "Comfort for every little step", materials: "Materials", care: "Care", delivery: "Delivery & payment", goodChoice: "Choose well", sizeAdvice: "Choose the child’s usual age range. If between two ranges, select the older one.", age: "Recommended age", weight: "Weight", height: "Height", discover: "Discover more", maybe: "You may also like", addShort: "Add" },
  ar: { announcement: "الدفع عند الاستلام · تأكيد هاتفي · استبدال سهل", back: "العودة إلى المتجر →", cart: "عرض السلة", home: "الرئيسية", save: "وفروا", cod: "الدفع فقط عند الاستلام", codText: "اطلبوا دون بطاقة. نؤكد الطلب هاتفياً قبل الشحن.", chooseSize: "اختيار المقاس", sizeGuide: "دليل المقاسات", soldOut: "نفد", stock: "متوفر", add: "أضف إلى السلة", choose: "اختاروا المقاس.", love: "لماذا نحبّه", comfort: "راحة مع كل خطوة صغيرة", materials: "الخامات", care: "العناية", delivery: "التوصيل والدفع", goodChoice: "اختيار المقاس", sizeAdvice: "قيسوا طول الطفل واعتمدوه أولاً. عند التردد بين مقاسين اختاروا الأكبر.", age: "العمر", weight: "الوزن", height: "الطول", discover: "اكتشفوا أيضاً", maybe: "قد يعجبكم أيضاً", addShort: "أضف" },
} as const;

export default function ProductDetail({ product, related }: { product: PublicProduct; related: PublicProduct[] }) {
  const router = useRouter();
  const colors = product.colors.length ? product.colors : (product.color ? [product.color] : []);
  const [activeImage, setActiveImage] = useState(product.colorImages[colors[0]] || product.images[0] || "/images/soft-days.jpg");
  const { locale, setLocale, dir, t } = useLocale();
  const copy = productCopy[locale];
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

  function addToCart() {
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
    router.push("/?bag=1");
  }

  return <div className="product-page" dir={dir}>
    <div className="announcement">{copy.announcement}</div>
    <header className="product-header"><Link href="/" className="brand"><Image src="/brand/lovelystep-logo.png" alt="Lovely Step" width={112} height={112} priority /></Link><Link className="back-link" href="/">{copy.back}</Link><div className="header-actions"><LanguageSwitcher locale={locale} onChange={setLocale} /><Link className="header-cart" href="/?bag=1" aria-label={copy.cart}><span className="cart-label-long">{copy.cart}</span><span className="cart-label-short">{t("cart")}</span></Link></div></header>
    <main>
      <div className="breadcrumbs"><Link href="/">{copy.home}</Link><span>/</span><span>{product.category}</span><span>/</span><strong>{display.name}</strong></div>
      <section className="product-detail-grid">
        <div className="gallery"><div className="gallery-main"><Image src={activeImage} alt={display.name} fill priority sizes="(max-width: 900px) 100vw, 55vw" unoptimized={activeImage.startsWith("/api/media/")} /></div>{product.images.length > 1 && <div className="thumbnails">{product.images.map((image) => <button key={image} className={image === activeImage ? "active" : ""} onClick={() => setActiveImage(image)}><Image src={image} alt="" fill sizes="90px" unoptimized={image.startsWith("/api/media/")} /></button>)}</div>}</div>
        <div className="product-panel">{outOfStock ? <span className="badge standalone badge-out-of-stock">{outOfStockLabel}</span> : product.badge && <span className="badge standalone">{product.badge}</span>}<span className="product-category">{product.category}</span><h1>{display.name}</h1><p className="product-lead">{display.shortDescription}</p><div className="detail-price"><strong>{money(product.priceCents)}</strong>{product.compareAtCents && <del>{money(product.compareAtCents)}</del>}{product.compareAtCents && <span>{copy.save} {money(product.compareAtCents - product.priceCents)}</span>}</div>
          <div className="cod-card"><span>✓</span><div><strong>{copy.cod}</strong><p>{copy.codText}</p></div></div>
          {colors.length > 0 && <fieldset className="color-picker"><legend>{t("color")}</legend><div>{colors.map((color) => <button type="button" key={color} className={selectedColor === color ? "selected" : ""} onClick={() => selectColor(color)}>{color}</button>)}</div></fieldset>}
          <fieldset className="size-picker"><div><legend>{copy.chooseSize}</legend><a href="#guide-tailles">{copy.sizeGuide}</a></div><div className="size-options">{availableSizes.map((item) => <button type="button" key={item.label} disabled={item.stock < 1} className={size === item.label ? "selected" : ""} onClick={() => { setSize(item.label); setQuantity(1); setNotice(""); }}>{localizedAgeLabel(item, locale)}<small>{item.stock < 1 ? copy.soldOut : `${item.stock} ${copy.stock}`}</small></button>)}</div></fieldset>
          <div className="buy-row"><div className="quantity large"><button onClick={() => setQuantity(Math.max(1, quantity - 1))}>−</button><b>{quantity}</b><button disabled={!size || quantity >= availableStock} onClick={() => setQuantity(Math.min(availableStock || 1, quantity + 1))}>+</button></div><button className="primary-button buy-button" disabled={!size || availableStock < 1} onClick={addToCart}>{copy.add} · {money(product.priceCents * quantity)}</button></div>{notice && <p className="form-error">{notice}</p>}
          <div className="product-reassurance"><p><b>🚚 Livraison offerte</b><span>Confirmation de l’adresse par téléphone</span></p><p><b>↔ Échange de taille</b><span>Notre équipe vous accompagne simplement</span></p><p><b>♡ Confort enfant</b><span>Une coupe pensée pour bouger librement</span></p></div>
        </div>
      </section>
      <section className="product-content"><article><span className="eyebrow">{copy.love}</span><h2>{copy.comfort}</h2><p>{display.description}</p><ul>{display.features.map((feature) => <li key={feature}>✓ {feature}</li>)}</ul></article><aside><details open><summary>{copy.materials}</summary><p>{display.materials}</p></details><details><summary>{copy.care}</summary><p>{display.care}</p></details><details><summary>{copy.delivery}</summary><p>{copy.codText}</p></details></aside></section>
      <section className="size-section" id="guide-tailles"><div><span className="eyebrow">{copy.goodChoice}</span><h2>{copy.sizeGuide}</h2><p>{copy.sizeAdvice}</p><div className="size-table"><div className="size-row age-size-row size-head"><span>{copy.age}</span><span>{locale === "ar" ? "التوفر" : locale === "en" ? "Availability" : "Disponibilité"}</span></div>{product.sizes.map((item) => <div className="size-row age-size-row" key={item.label}><strong>{localizedAgeLabel(item, locale)}</strong><span>{item.stock > 0 ? copy.stock : copy.soldOut}</span></div>)}</div></div><Image src="/images/size-guide-how-to-measure.webp" alt={`${copy.sizeGuide} — ${copy.sizeAdvice}`} width={960} height={1200} sizes="(max-width: 800px) calc(100vw - 40px), 38vw" /></section>
      {product.testimonials.length > 0 && <section className="product-testimonials"><div className="section-heading"><div><span className="eyebrow">Avis sur ce produit</span><h2>Ce qu’en disent les acheteurs</h2></div><p>Ces avis ont été importés depuis la source indiquée et vérifiés dans le dashboard.</p></div><div className="testimonial-grid">{product.testimonials.map((item, index) => <article key={`${item.quote}-${index}`}><div className="stars">{item.rating ? "★".repeat(Math.round(item.rating)) : "Avis client"}</div><blockquote>“{item.quote}”</blockquote><strong>{item.author || "Acheteur vérifié sur la source"}</strong><small>{item.source || "Source fournisseur"}</small></article>)}</div></section>}
      {related.length > 0 && <section className="related"><div className="section-heading"><div><span className="eyebrow">{copy.discover}</span><h2>{copy.maybe}</h2></div></div><div className="product-grid compact">{related.map((item) => { const image = item.colorImages[item.colors[0] || item.color] || item.images[0] || "/images/soft-days.jpg"; const itemTranslation = locale === "fr" ? undefined : item.translations[locale]; const itemName = itemTranslation?.name || item.name; const itemOutOfStock = isProductOutOfStock(item); return <article className="product-card" key={item.id}><Link href={`/produits/${item.slug}`} className="product-image">{itemOutOfStock && <span className="badge badge-out-of-stock">{outOfStockLabel}</span>}<Image src={image} alt={itemName} fill sizes="33vw" unoptimized={image.startsWith("/api/media/")} /></Link><div className="product-info"><span className="product-category">{item.category}</span><Link href={`/produits/${item.slug}`}><h3>{itemName}</h3></Link><strong>{money(item.priceCents)}</strong></div></article>; })}</div></section>}
    </main>
    <div className="mobile-buy"><div><small>{display.name}</small><strong>{money(product.priceCents)}</strong></div><button disabled={outOfStock} onClick={addToCart}>{outOfStock ? outOfStockLabel : copy.addShort}</button></div>
    <footer><Image src="/brand/lovelystep-logo.png" alt="Lovely Step" width={120} height={120} /><p>Tiny Steps, Big Love</p><small>© {new Date().getFullYear()} Lovely Step.</small></footer>
  </div>;
}
