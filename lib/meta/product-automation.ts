import "server-only";

import { recordSyncResult } from "../db-postgres";
import type { Product } from "../types";
import { redact } from "./capi";
import { removeProductFromCatalog, syncCatalog } from "./catalog";
import { publishProductToInstagram } from "./instagram-posts";
import { publishProductToFacebookPage, type PublishProductResult } from "./page-posts";

/**
 * Un envoi refusé avant même l'appel à Meta ne laissait aucune trace : le produit
 * n'apparaissait ni en publié ni en échec, et rien n'expliquait le silence.
 */
const SKIP_EXPLANATIONS: Record<string, string> = {
  disabled: "Publication automatique demandée, mais META_PAGE_ID ou META_PAGE_ACCESS_TOKEN est absent.",
  not_published: "Le produit n'était plus publié au moment de l'envoi.",
  already_claimed: "Une publication existe déjà pour ce produit, ou un envoi précédent est resté bloqué.",
  missing_image: "Le produit n'a aucune image publiable.",
  invalid_site_url: "SITE_URL doit être une adresse https publique pour que Meta puisse charger les photos.",
};

async function recordSkippedAnnouncement(channel: "page_post" | "instagram_post", productId: number, result: PublishProductResult): Promise<void> {
  if (result.ok || !result.skipped) return;
  await recordSyncResult(channel, false, SKIP_EXPLANATIONS[result.skipped] ?? result.skipped, { productId, skipped: result.skipped }).catch(() => undefined);
}

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
  if (plan.pagePost) await recordSkippedAnnouncement("page_post", product.id, await publishProductToFacebookPage(product));
  if (plan.instagramPost) await recordSkippedAnnouncement("instagram_post", product.id, await publishProductToInstagram(product));
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
