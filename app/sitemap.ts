import type { MetadataRoute } from "next";
import { listProducts } from "@/lib/db-postgres";
import { siteUrl } from "@/lib/site-url";

// The sitemap reads the catalog, and a database read during `next build` is
// refused on purpose (see initialize() in lib/db-postgres). Generated per request.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteUrl() || "https://lovelystep.com";
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${origin}/`, changeFrequency: "daily", priority: 1 },
    { url: `${origin}/confidentialite`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${origin}/mentions-legales`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${origin}/suppression-donnees`, changeFrequency: "yearly", priority: 0.2 },
  ];

  try {
    const products = await listProducts();
    return [...staticPages, ...products.map((product) => ({
      url: `${origin}/produits/${product.slug}`,
      lastModified: new Date(product.updatedAt),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    }))];
  } catch {
    // A database hiccup must not serve a 500 to a crawler: the static pages still index.
    return staticPages;
  }
}
