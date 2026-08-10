// Shared by the browser Pixel and the server Conversions API.
// Both sides must produce the SAME event_id for the same real-world event, or Meta counts it twice.
// No "server-only" import here on purpose: this module is imported by client components.

export type MetaStandardEvent =
  | "PageView" | "ViewContent" | "Search" | "AddToCart" | "AddToWishlist"
  | "InitiateCheckout" | "AddPaymentInfo" | "Lead" | "CompleteRegistration" | "Purchase";

export type MetaContent = { id: string; quantity: number; item_price?: number };

export type MetaCustomData = {
  content_ids?: string[];
  content_type?: "product" | "product_group";
  contents?: MetaContent[];
  content_name?: string;
  content_category?: string;
  value?: number;
  currency?: string;
  num_items?: number;
  order_id?: string;
  search_string?: string;
};

/**
 * Catalog retailer id for a product.
 * Phase 4 (catalog sync) must feed Meta this exact same string as `retailer_id`,
 * otherwise event `content_ids` will not match the catalog and attribution breaks.
 * Product-level (slug) rather than per-variant: the store sells one price per product
 * across colours/sizes, so variant-level ids would add rows without adding signal.
 */
export function contentId(slug: string): string {
  return slug;
}

/**
 * Purchase events are deduplicated on a value derived from the order number, so a page
 * refresh, a webhook retry or a second CAPI attempt all collapse onto one conversion.
 */
export function purchaseEventId(orderNumber: string): string {
  return `purchase_${orderNumber}`;
}

/** Non-purchase browser events have no natural key, so they get a random id per occurrence. */
export function randomEventId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `evt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/** Drops empty/undefined keys so Meta never receives null-ish parameters. */
export function cleanCustomData(data: MetaCustomData): MetaCustomData {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0)),
  ) as MetaCustomData;
}
