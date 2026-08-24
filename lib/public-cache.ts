import "server-only";

import { unstable_cache } from "next/cache";
import { getProductBySlug, getStoreSettings, isTrackingDisabledByAdmin, listDeliveryRates, listProducts } from "./db-postgres";
import type { DeliveryRate, Product, StoreSettings } from "./types";

/**
 * Read-through cache for the public storefront.
 *
 * Every shop page was `force-dynamic` with no caching, so each visitor cost
 * three or four round trips to Supabase before a single byte was sent. On a
 * mobile connection in Algeria that latency is most of the time-to-first-byte.
 *
 * One tag covers the whole catalogue. It is invalidated the moment anything a
 * shopper can see changes — a product saved or deleted, storefront settings,
 * delivery rates, and stock after an order — so the cache is never the reason
 * someone sees a stale price or an item that just sold out. The TTL is only a
 * backstop for a revalidation we forgot to wire up.
 */
export const CATALOG_TAG = "catalog";

const CATALOG_TTL_SECONDS = 300;

export const cachedProducts = unstable_cache(
  async (): Promise<Product[]> => listProducts(),
  ["storefront-products"],
  { tags: [CATALOG_TAG], revalidate: CATALOG_TTL_SECONDS },
);

export const cachedStoreSettings = unstable_cache(
  async (): Promise<StoreSettings> => getStoreSettings(),
  ["storefront-settings"],
  { tags: [CATALOG_TAG], revalidate: CATALOG_TTL_SECONDS },
);

export const cachedDeliveryRates = unstable_cache(
  async (): Promise<DeliveryRate[]> => listDeliveryRates(),
  ["storefront-delivery-rates"],
  { tags: [CATALOG_TAG], revalidate: CATALOG_TTL_SECONDS },
);

/**
 * Published products only. `includeUnpublished` is never exposed here on
 * purpose: a cached draft would be one shared cache entry away from being
 * served to the public.
 */
export const cachedProductBySlug = unstable_cache(
  async (slug: string): Promise<Product | null> => getProductBySlug(slug),
  ["storefront-product"],
  { tags: [CATALOG_TAG], revalidate: CATALOG_TTL_SECONDS },
);

/**
 * The tracking kill switch is read on every storefront request. It changes
 * roughly never, so paying a Supabase round trip for it on the critical path is
 * pure latency. Invalidated from the Meta tracking admin route.
 */
export const cachedTrackingDisabled = unstable_cache(
  async (): Promise<boolean> => isTrackingDisabledByAdmin().catch(() => false),
  ["storefront-tracking-disabled"],
  { tags: [CATALOG_TAG], revalidate: CATALOG_TTL_SECONDS },
);
