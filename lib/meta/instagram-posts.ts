import "server-only";

import {
  claimProductInstagramPost,
  failProductInstagramPost,
  finishProductInstagramPost,
  recordSyncResult,
} from "../db-postgres";
import { siteUrl } from "../site-url";
import type { Product } from "../types";
import { redact } from "./capi";
import { graphPostWithAccessToken } from "./graph";
import { buildProductPageCaption, productPostImages, type PublishProductResult } from "./page-posts";

export type MetaInstagramPostingStatus = {
  enabled: boolean;
  pageConfigured: boolean;
  accountConfigured: boolean;
  tokenConfigured: boolean;
  ready: boolean;
};

export function metaInstagramPostingStatus(): MetaInstagramPostingStatus {
  const pageConfigured = /^\d{5,30}$/.test((process.env.META_PAGE_ID ?? "").trim());
  const accountConfigured = /^\d{5,30}$/.test((process.env.META_INSTAGRAM_ACCOUNT_ID ?? "").trim());
  const tokenConfigured = (process.env.META_PAGE_ACCESS_TOKEN ?? "").trim().length > 20;
  const enabled = process.env.META_INSTAGRAM_AUTO_POST_ENABLED === "true";
  return { enabled, pageConfigured, accountConfigured, tokenConfigured, ready: enabled && pageConfigured && accountConfigured && tokenConfigured };
}

/** Publishes one Instagram feed post exactly once when a product first goes live. */
export async function publishProductToInstagram(product: Product, retryFailed = false): Promise<PublishProductResult> {
  const config = metaInstagramPostingStatus();
  if (!config.ready) return { ok: false, skipped: "disabled" };
  if (product.status !== "published") return { ok: false, skipped: "not_published" };
  const images = productPostImages(product);
  if (!images.length) return { ok: false, skipped: "missing_image" };
  if (!/^https:\/\//i.test(siteUrl())) return { ok: false, skipped: "invalid_site_url" };

  const token = (process.env.META_PAGE_ACCESS_TOKEN ?? "").trim();
  const accountId = (process.env.META_INSTAGRAM_ACCOUNT_ID ?? "").trim();
  const claimed = await claimProductInstagramPost(product.id, accountId, retryFailed);
  if (!claimed) return { ok: false, skipped: "already_claimed" };
  try {
    let creationId: string;
    if (images.length === 1) {
      const container = await graphPostWithAccessToken<{ id?: string }>(`${accountId}/media`, {
        image_url: images[0],
        caption: buildProductPageCaption(product),
      }, token);
      creationId = String(container.id ?? "");
    } else {
      const children: string[] = [];
      for (const imageUrl of images) {
        const child = await graphPostWithAccessToken<{ id?: string }>(`${accountId}/media`, {
          image_url: imageUrl,
          is_carousel_item: true,
        }, token);
        const childId = String(child.id ?? "");
        if (!childId) throw new Error("Meta n'a pas retourné l'identifiant d'une image Instagram.");
        children.push(childId);
      }
      const carousel = await graphPostWithAccessToken<{ id?: string }>(`${accountId}/media`, {
        media_type: "CAROUSEL",
        children: children.join(","),
        caption: buildProductPageCaption(product),
      }, token);
      creationId = String(carousel.id ?? "");
    }
    if (!creationId) throw new Error("Meta n'a pas retourné l'identifiant du média Instagram.");

    const published = await graphPostWithAccessToken<{ id?: string }>(`${accountId}/media_publish`, {
      creation_id: creationId,
    }, token);
    const postId = String(published.id ?? "");
    if (!postId) throw new Error("Meta n'a pas retourné l'identifiant de la publication Instagram.");
    await finishProductInstagramPost(product.id, postId);
    await recordSyncResult("instagram_post", true, null, { productId: product.id, postId, imageCount: images.length });
    return { ok: true, postId };
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : "Publication Instagram impossible.");
    await failProductInstagramPost(product.id, message).catch(() => undefined);
    await recordSyncResult("instagram_post", false, message, { productId: product.id }).catch(() => undefined);
    return { ok: false, error: message };
  }
}
