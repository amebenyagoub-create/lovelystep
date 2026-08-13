import "server-only";

import {
  claimProductPagePost,
  failProductPagePost,
  finishProductPagePost,
  recordSyncResult,
} from "../db-postgres";
import { siteUrl } from "../site-url";
import type { Product } from "../types";
import { redact } from "./capi";
import { graphDeleteWithAccessToken, graphPostWithAccessToken } from "./graph";

const MAX_FACEBOOK_POST_IMAGES = 10;

export type MetaPagePostingStatus = {
  enabled: boolean;
  pageConfigured: boolean;
  tokenConfigured: boolean;
  ready: boolean;
};

export function metaPagePostingStatus(): MetaPagePostingStatus {
  const pageConfigured = /^\d{5,30}$/.test((process.env.META_PAGE_ID ?? "").trim());
  const tokenConfigured = (process.env.META_PAGE_ACCESS_TOKEN ?? "").trim().length > 20;
  const enabled = process.env.META_AUTO_POST_ENABLED === "true";
  return { enabled, pageConfigured, tokenConfigured, ready: enabled && pageConfigured && tokenConfigured };
}

function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const origin = siteUrl();
  return `${origin}${path.startsWith("/") ? "" : "/"}${path}`;
}

export function buildProductPageCaption(product: Product): string {
  const productUrl = `${siteUrl()}/produits/${product.slug}`;
  const price = new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(product.priceCents / 100);
  const description = (product.shortDescription || product.description).trim().replace(/\s+/g, " ").slice(0, 500);
  return [
    "✨ Nouveau chez Lovely Step",
    "",
    product.name,
    description,
    `Prix : ${price} DA`,
    "",
    `Découvrir : ${productUrl}`,
  ].filter((line, index, lines) => line || (index > 0 && lines[index - 1] !== "")).join("\n").slice(0, 2_000);
}

export type PublishProductResult = {
  ok: boolean;
  skipped?: "disabled" | "not_published" | "already_claimed" | "missing_image" | "invalid_site_url";
  postId?: string;
  error?: string;
};

function productPostImages(product: Product): string[] {
  return [...new Set(product.images.map((image) => image.trim()).filter(Boolean))]
    .slice(0, MAX_FACEBOOK_POST_IMAGES)
    .map(absoluteUrl);
}

async function discardUnpublishedPhotos(photoIds: string[], token: string): Promise<void> {
  await Promise.allSettled(photoIds.map((photoId) => graphDeleteWithAccessToken(photoId, token)));
}

/**
 * Publishes one photo post exactly once for a product. Products with several images are sent as
 * one Facebook multi-photo post. The database claim happens before the Graph call, preventing
 * duplicate public posts when two saves arrive at the same time.
 */
export async function publishProductToFacebookPage(product: Product, retryFailed = false): Promise<PublishProductResult> {
  const config = metaPagePostingStatus();
  if (!config.ready) return { ok: false, skipped: "disabled" };
  if (product.status !== "published") return { ok: false, skipped: "not_published" };
  const images = productPostImages(product);
  if (!images.length) return { ok: false, skipped: "missing_image" };
  if (!/^https:\/\//i.test(siteUrl())) return { ok: false, skipped: "invalid_site_url" };

  const pageId = (process.env.META_PAGE_ID ?? "").trim();
  const token = (process.env.META_PAGE_ACCESS_TOKEN ?? "").trim();
  const claimed = await claimProductPagePost(product.id, pageId, retryFailed);
  if (!claimed) return { ok: false, skipped: "already_claimed" };

  try {
    if (images.length === 1) {
      const response = await graphPostWithAccessToken<{ id?: string; post_id?: string }>(`${pageId}/photos`, {
        url: images[0],
        caption: buildProductPageCaption(product),
        published: true,
      }, token);
      const postId = String(response.post_id ?? response.id ?? "");
      if (!postId) throw new Error("Meta did not return a Facebook post ID.");
      await finishProductPagePost(product.id, postId);
      await recordSyncResult("page_post", true, null, { productId: product.id, postId, imageCount: 1 });
      return { ok: true, postId };
    }

    const photoIds: string[] = [];
    try {
      for (const url of images) {
        const photo = await graphPostWithAccessToken<{ id?: string }>(`${pageId}/photos`, {
          url,
          published: false,
        }, token);
        const photoId = String(photo.id ?? "");
        if (!photoId) throw new Error("Meta did not return a Facebook photo ID.");
        photoIds.push(photoId);
      }
    } catch (error) {
      // No public post was attempted yet, so these staged photos are safe to delete.
      await discardUnpublishedPhotos(photoIds, token);
      throw error;
    }

    // Do not delete the staged photos after this call starts. A timeout can be ambiguous: Meta
    // may have created the public post even if our server never received its response.
    const response = await graphPostWithAccessToken<{ id?: string }>(`${pageId}/feed`, {
      message: buildProductPageCaption(product),
      attached_media: photoIds.map((media_fbid) => ({ media_fbid })),
      published: true,
    }, token);
    const postId = String(response.id ?? "");
    if (!postId) throw new Error("Meta did not return a Facebook post ID.");
    await finishProductPagePost(product.id, postId);
    await recordSyncResult("page_post", true, null, { productId: product.id, postId, imageCount: photoIds.length });
    return { ok: true, postId };
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : "Facebook Page publication failed.");
    await failProductPagePost(product.id, message).catch(() => undefined);
    await recordSyncResult("page_post", false, message, { productId: product.id }).catch(() => undefined);
    return { ok: false, error: message };
  }
}

export const __testing = { absoluteUrl, productPostImages };
