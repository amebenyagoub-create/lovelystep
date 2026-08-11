import "server-only";

import crypto from "node:crypto";
import { listCatalogItems, listProducts, upsertCatalogItemState } from "../db-postgres";
import { siteUrl } from "../site-url";
import type { Product } from "../types";
import { contentId } from "./events";
import { graphPost } from "./graph";

/**
 * Meta product catalog synchronization via POST /{catalog_id}/items_batch.
 *
 * The `id` field sent here MUST equal the `content_ids` value the Pixel and CAPI send,
 * otherwise events cannot be matched to catalog products. Both come from contentId().
 */

// Verified against Meta's items_batch reference (2026-08-10).
const MAX_BATCH = 1000; // Meta allows 5000, recommends 3000; smaller batches give clearer per-item errors.
type BatchMethod = "CREATE" | "UPDATE" | "DELETE";
type BatchRequest = { method: BatchMethod; data: Record<string, unknown> };

function absoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${siteUrl()}${path.startsWith("/") ? "" : "/"}${path}`;
}

function totalStock(product: Product): number {
  return product.variants.length
    ? product.variants.reduce((sum, variant) => sum + Math.max(0, Math.floor(Number(variant.stock) || 0)), 0)
    : product.sizes.reduce((sum, size) => sum + Math.max(0, Math.floor(Number(size.stock) || 0)), 0);
}

/** Meta availability enum: "in stock" | "out of stock" | "available for order" | "discontinued". */
function availability(product: Product): string {
  if (product.status === "archived") return "discontinued";
  return totalStock(product) > 0 ? "in stock" : "out of stock";
}

/** Price format required by Meta: amount and 3-letter ISO code separated by a space. */
function priceString(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency || "DZD"}`;
}

export function buildCatalogItem(product: Product): Record<string, unknown> {
  const images = product.images.map(absoluteUrl).filter(Boolean);
  const item: Record<string, unknown> = {
    id: contentId(product.slug),
    title: product.name.slice(0, 100),
    // Meta requires a non-empty description; fall back through the available copy.
    description: (product.shortDescription || product.description || product.name).slice(0, 5000),
    availability: availability(product),
    condition: "new",
    price: priceString(product.priceCents, product.currency),
    link: `${siteUrl()}/produits/${product.slug}`,
    brand: "Lovely Step",
  };
  if (images.length) {
    item.image_link = images[0];
    if (images.length > 1) item.additional_image_link = images.slice(1, 11);
  }
  // A sale price is only meaningful when a higher reference price exists.
  if (product.compareAtCents && product.compareAtCents > product.priceCents) {
    item.price = priceString(product.compareAtCents, product.currency);
    item.sale_price = priceString(product.priceCents, product.currency);
  }
  if (product.category) item.product_type = product.category;
  const colors = product.colors.filter(Boolean);
  if (colors.length) item.color = colors.join(", ").slice(0, 100);
  // GTIN/MPN are omitted rather than invented: sending a wrong identifier is worse than none.
  return item;
}

/** Stable hash of the payload, so unchanged products are skipped on incremental runs. */
function itemHash(item: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(JSON.stringify(item)).digest("hex").slice(0, 32);
}

export type CatalogSyncResult = {
  total: number;
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  failed: number;
  errors: Array<{ retailerId: string; error: string }>;
  handles: string[];
};

type BatchResponse = { handles?: string[]; validation_status?: Array<{ retailer_id?: string; errors?: Array<{ message?: string }> }> };

async function sendBatch(catalogId: string, requests: BatchRequest[]): Promise<BatchResponse> {
  return graphPost<BatchResponse>(`${catalogId}/items_batch`, {
    item_type: "PRODUCT_ITEM",
    // Upsert semantics mean a CREATE for an existing id updates it instead of failing.
    allow_upsert: true,
    requests,
  });
}

/**
 * Synchronizes products to the catalog.
 * `full = true` sends every published product; otherwise only products whose payload changed.
 */
export async function syncCatalog(full = false): Promise<CatalogSyncResult> {
  const catalogId = (process.env.META_CATALOG_ID ?? "").trim();
  if (!catalogId) throw new Error("META_CATALOG_ID est absent du serveur.");
  if (!siteUrl()) throw new Error("SITE_URL est requis pour produire des liens absolus.");

  const [products, knownItems] = await Promise.all([listProducts(true), listCatalogItems()]);
  const known = new Map(knownItems.map((item) => [item.productId, item]));
  const result: CatalogSyncResult = { total: 0, created: 0, updated: 0, deleted: 0, skipped: 0, failed: 0, errors: [], handles: [] };

  const requests: BatchRequest[] = [];
  const pending: Array<{ productId: number; retailerId: string; hash: string; method: BatchMethod }> = [];

  for (const product of products) {
    const retailerId = contentId(product.slug);
    // Drafts and archived products are removed from the catalog rather than advertised.
    if (product.status !== "published") {
      if (known.has(product.id)) {
        requests.push({ method: "DELETE", data: { id: retailerId } });
        pending.push({ productId: product.id, retailerId, hash: "", method: "DELETE" });
      }
      continue;
    }
    const item = buildCatalogItem(product);
    const hash = itemHash(item);
    const previous = known.get(product.id);
    if (!full && previous && previous.contentHash === hash && !previous.lastError) {
      result.skipped += 1;
      continue;
    }
    requests.push({ method: previous ? "UPDATE" : "CREATE", data: item });
    pending.push({ productId: product.id, retailerId, hash, method: previous ? "UPDATE" : "CREATE" });
  }

  result.total = requests.length;
  if (!requests.length) return result;

  for (let index = 0; index < requests.length; index += MAX_BATCH) {
    const slice = requests.slice(index, index + MAX_BATCH);
    const slicePending = pending.slice(index, index + MAX_BATCH);
    try {
      const response = await sendBatch(catalogId, slice);
      if (Array.isArray(response.handles)) result.handles.push(...response.handles);
      // Meta reports per-item validation problems without failing the whole batch.
      const failures = new Map<string, string>();
      for (const entry of response.validation_status ?? []) {
        const message = entry.errors?.map((error) => error.message).filter(Boolean).join("; ");
        if (entry.retailer_id && message) failures.set(entry.retailer_id, message.slice(0, 300));
      }
      for (const item of slicePending) {
        const error = failures.get(item.retailerId) ?? null;
        if (error) { result.failed += 1; result.errors.push({ retailerId: item.retailerId, error }); }
        else if (item.method === "CREATE") result.created += 1;
        else if (item.method === "UPDATE") result.updated += 1;
        else result.deleted += 1;
        await upsertCatalogItemState(item.productId, item.retailerId, item.hash, item.method, error);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : "Erreur inconnue";
      result.failed += slicePending.length;
      for (const item of slicePending) {
        result.errors.push({ retailerId: item.retailerId, error: message });
        await upsertCatalogItemState(item.productId, item.retailerId, item.hash, item.method, message).catch(() => undefined);
      }
    }
  }
  return result;
}

/** Reconciliation view: what the catalog should contain versus what we last managed to send. */
export async function catalogQualityReport(): Promise<{ published: number; synced: number; failed: number; neverSynced: number; failures: Array<{ retailerId: string; error: string }> }> {
  const [products, items] = await Promise.all([listProducts(true), listCatalogItems()]);
  const published = products.filter((product) => product.status === "published");
  const byId = new Map(items.map((item) => [item.productId, item]));
  const failures = items.filter((item) => item.lastError).map((item) => ({ retailerId: item.retailerId, error: String(item.lastError) }));
  return {
    published: published.length,
    synced: published.filter((product) => byId.get(product.id)?.lastSyncedAt).length,
    failed: failures.length,
    neverSynced: published.filter((product) => !byId.get(product.id)?.lastSyncedAt).length,
    failures,
  };
}

export const __testing = { buildCatalogItem, availability, priceString, itemHash };
