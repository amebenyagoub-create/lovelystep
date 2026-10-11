const DEFAULT_EASYDEAL_ORIGIN = "https://easy-deal-dz-test.benameurgoub.chatgpt.site";

const EASYDEAL_OFFERS: Record<string, Record<number, number>> = {
  "gant-anti-poils-chat-chien": { 1: 145_000, 2: 195_000, 3: 360_000 },
};

export function easyDealOfferUnitPriceCents(slug: string, quantity: number, catalogueUnitPriceCents: number): number {
  const offerTotal = EASYDEAL_OFFERS[slug]?.[quantity];
  return offerTotal && offerTotal % quantity === 0 ? offerTotal / quantity : catalogueUnitPriceCents;
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
