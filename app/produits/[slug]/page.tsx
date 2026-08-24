import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cachedProductBySlug, cachedProducts } from "@/lib/public-cache";
import ProductDetail from "./product-detail";
import StoreTracking from "@/app/store-tracking";
import { isProductOutOfStock } from "@/lib/product-stock";
import { siteUrl } from "@/lib/site-url";
import { toPublicProduct, type Product } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await cachedProductBySlug(slug);
  if (!product) return {};
  return {
    title: product.seoTitle || product.name,
    description: product.seoDescription || product.shortDescription,
    // Without a canonical, every tracking parameter Meta appends to an ad click
    // (?fbclid=…) looks like a separate page to a crawler.
    alternates: { canonical: `/produits/${product.slug}` },
    openGraph: { type: "website", url: `/produits/${product.slug}`, title: product.seoTitle || product.name, description: product.seoDescription || product.shortDescription, images: product.images[0] ? [product.images[0]] : [] },
  };
}

/**
 * Product structured data.
 *
 * Deliberately no `aggregateRating` or `review`: the testimonials currently in
 * the catalog come from the supplier, not from customers. Emitting them as
 * review markup would be fabricated rich-result data — a manual-action risk with
 * Google and a lie to the shopper. Add it once real reviews exist.
 */
function productJsonLd(product: Product, origin: string) {
  const url = `${origin}/produits/${product.slug}`;
  const images = product.images.filter(Boolean).map((image) => (image.startsWith("http") ? image : `${origin}${image}`));
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.seoDescription || product.shortDescription || product.description,
    ...(images.length ? { image: images } : {}),
    sku: product.slug,
    ...(product.category ? { category: product.category } : {}),
    brand: { "@type": "Brand", name: "Lovely Step" },
    offers: {
      "@type": "Offer",
      url,
      priceCurrency: product.currency || "DZD",
      price: (product.priceCents / 100).toFixed(2),
      availability: isProductOutOfStock(product) ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
      // Cash on delivery: the shopper pays the courier, so no online payment method is advertised.
      seller: { "@type": "Organization", name: "Lovely Step" },
    },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const product = await cachedProductBySlug((await params).slug);
  if (!product) notFound();
  const related = (await cachedProducts()).filter((item) => item.id !== product.id).slice(0, 3);
  const origin = siteUrl() || "https://lovelystep.com";
  return <>
    <script type="application/ld+json" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd(product, origin)) }} />
    <ProductDetail product={toPublicProduct(product)} related={related.map(toPublicProduct)} />
    <StoreTracking />
  </>;
}
