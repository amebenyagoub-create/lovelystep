import type { ProductOffer } from "./types";

const DEFAULT_EASYDEAL_ORIGIN = "https://easy-deal-dz-test.benameurgoub.chatgpt.site";

export function easyDealOfferUnitPriceCents(offers: ProductOffer[], quantity: number, catalogueUnitPriceCents: number): number {
  const offerTotal = offers.find((offer) => offer.quantity === quantity)?.priceCents;
  return offerTotal && offerTotal % quantity === 0 ? offerTotal / quantity : catalogueUnitPriceCents;
}

export function easyDealHasFreeShipping(offers: ProductOffer[], quantity: number): boolean {
  return offers.some((offer) => offer.quantity === quantity && offer.freeShipping);
}

export function parseEasyDealOrigins(value: string | undefined): Set<string> {
  const configured = String(value ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return new Set(configured.length ? configured : [DEFAULT_EASYDEAL_ORIGIN]);
}

export function easyDealCorsHeaders(request: Request): Headers | null {
  const origin = request.headers.get("origin")?.replace(/\/$/, "") ?? "";
  if (!origin || !parseEasyDealOrigins(process.env.EASYDEAL_ALLOWED_ORIGINS).has(origin)) return null;
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, X-Sales-Channel");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Vary", "Origin");
  return headers;
}
