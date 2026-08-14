import "server-only";

import { recordSyncResult } from "../db-postgres";
import type { Product } from "../types";
import { redact } from "./capi";
import { removeProductFromCatalog, syncCatalog } from "./catalog";
import { publishProductToInstagram } from "./instagram-posts";
import { publishProductToFacebookPage } from "./page-posts";

export function productMetaAutomationPlan(previous: Product | null, product: Product): {
  catalog: boolean;
  pagePost: boolean;
  instagramPost: boolean;
} {
  return {
    // Any save can affect title, image, price, availability, stock or publication status.
    catalog: process.env.META_AUTO_CATALOG_SYNC_ENABLED === "true",
    // A Page post is an announcement, so edits to an already-published product must not repost it.
    pagePost: process.env.META_AUTO_POST_ENABLED === "true"
      && product.status === "published"
      && previous?.status !== "published",
    instagramPost: process.env.META_INSTAGRAM_AUTO_POST_ENABLED === "true"
      && product.status === "published"
      && previous?.status !== "published",
  };
}

/** Runs after the product response. Failure is recorded for the Meta dashboard and never rolls back the store save. */
export async function runProductMetaAutomation(previous: Product | null, product: Product): Promise<void> {
  const plan = productMetaAutomationPlan(previous, product);
  if (plan.catalog) {
    try {
      const result = await syncCatalog(false);
      await recordSyncResult("catalog", result.failed === 0, result.failed ? `${result.failed} item(s) rejected` : null, result);
    } catch (error) {
      const message = redact(error instanceof Error ? error.message : "Automatic catalogue synchronization failed.");
      await recordSyncResult("catalog", false, message, { trigger: "product_save", productId: product.id }).catch(() => undefined);
    }
  }
  if (plan.pagePost) await publishProductToFacebookPage(product);
  if (plan.instagramPost) await publishProductToInstagram(product);
}

export async function runDeletedProductMetaAutomation(product: Product): Promise<void> {
  if (process.env.META_AUTO_CATALOG_SYNC_ENABLED !== "true") return;
  try {
    const result = await removeProductFromCatalog(product);
    await recordSyncResult("catalog", true, null, { trigger: "product_delete", productId: product.id, ...result });
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : "Automatic catalogue deletion failed.");
    await recordSyncResult("catalog", false, message, { trigger: "product_delete", productId: product.id }).catch(() => undefined);
  }
}
