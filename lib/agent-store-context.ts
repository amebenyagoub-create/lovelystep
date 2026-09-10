import type { DeliveryRate, Product } from "./types";
import { frenchAgeLabel } from "./product-size";

export type AgentStoreContext = {
  store: string;
  updatedAt: string;
  products: Array<{
    id: number;
    name: string;
    slug: string;
    productUrl: string;
    imageUrl: string;
    description: string;
    category: string;
    priceDzd: number;
    compareAtDzd: number | null;
    colors: string[];
    variants: Array<{ color: string; supplierSize: string; age: string; stock: number }>;
    totalStock: number;
  }>;
  delivery: Array<{
    wilayaCode: string;
    wilaya: string;
    homeDzd: number;
    officeDzd: number;
  }>;
  promotions: never[];
};

const dzd = (cents: number) => Math.max(0, Number(cents) || 0) / 100;

function whatsappImageUrl(product: Product, base: string): string {
  const image = product.images.find((value) => value?.trim())?.trim() || "";
  const match = /^\/api\/media\/products\/([a-zA-Z0-9._-]+)$/.exec(image);
  return base && match ? `${base}/api/wa-image/${match[1]}` : "";
}

export function buildAgentStoreContext(products: Product[], rates: DeliveryRate[], publicOrigin: string): AgentStoreContext {
  const base = publicOrigin.replace(/\/+$/, "");
  return {
    store: "Lovely Step",
    updatedAt: new Date().toISOString(),
    products: products.filter((product) => product.status === "published").map((product) => {
      const variants = product.variants.length
        ? product.variants.map((variant) => ({
          color: variant.color,
          supplierSize: variant.size,
          age: frenchAgeLabel({ label: variant.size, age: variant.age }),
          stock: Math.max(0, Math.floor(Number(variant.stock) || 0)),
        }))
        : product.sizes.map((size) => ({
          color: product.color || product.colors[0] || "",
          supplierSize: size.label,
          age: frenchAgeLabel(size),
          stock: Math.max(0, Math.floor(Number(size.stock) || 0)),
        }));
      return {
        id: product.id,
        name: product.name,
        slug: product.slug,
        productUrl: base ? `${base}/produits/${product.slug}` : `/produits/${product.slug}`,
        imageUrl: whatsappImageUrl(product, base),
        description: product.shortDescription || product.description,
        category: product.category,
        priceDzd: dzd(product.priceCents),
        compareAtDzd: product.compareAtCents == null ? null : dzd(product.compareAtCents),
        colors: [...new Set([...product.colors, ...variants.map((variant) => variant.color)].filter(Boolean))],
        variants,
        totalStock: variants.reduce((total, variant) => total + variant.stock, 0),
      };
    }),
    delivery: rates.filter((rate) => rate.active).map((rate) => ({
      wilayaCode: rate.wilayaCode,
      wilaya: rate.wilayaNameFr,
      homeDzd: dzd(rate.homeCents),
      officeDzd: dzd(rate.officeCents),
    })),
    // No promotion engine exists yet. An empty list prevents the agent from
    // inventing discounts or free delivery thresholds.
    promotions: [],
  };
}
