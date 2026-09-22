import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { isValidCheckoutDraftToken } from "@/lib/checkout-draft";
import { normalizeAlgerianPhone, validSameOrigin } from "@/lib/customer-auth";
import { AbandonedCheckoutRateLimitError, deleteAbandonedCheckout, getProductById, upsertAbandonedCheckout } from "@/lib/db-postgres";
import type { OrderItem } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DraftItem = { productId?: number; size?: string; color?: string; quantity?: number };

function requestIpHash(request: Request): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  return crypto.createHash("sha256").update(`lovelystep-checkout:${ip}`).digest("hex");
}

export async function POST(request: Request) {
  if (!validSameOrigin(request)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 64 * 1024) return NextResponse.json({ error: "Requête trop volumineuse." }, { status: 413 });
  const body = await request.json().catch(() => ({})) as {
    checkoutToken?: string;
    customerName?: string;
    phone?: string;
    locale?: "fr" | "en" | "ar";
    consentWhatsapp?: boolean;
    items?: DraftItem[];
  };
  if (!isValidCheckoutDraftToken(body.checkoutToken)) return NextResponse.json({ error: "Session de panier invalide." }, { status: 400 });
  const phone = normalizeAlgerianPhone(String(body.phone ?? ""));
  if (!phone) return NextResponse.json({ error: "Numéro de téléphone invalide." }, { status: 400 });
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) return NextResponse.json({ error: "Panier invalide." }, { status: 400 });

  const items: OrderItem[] = [];
  for (const submitted of body.items) {
    const productId = Number(submitted?.productId);
    const quantity = Number(submitted?.quantity);
    const size = String(submitted?.size ?? "").trim().slice(0, 60);
    const requestedColor = String(submitted?.color ?? "").trim().slice(0, 80);
    if (!Number.isInteger(productId) || productId < 1 || !Number.isInteger(quantity) || quantity < 1 || quantity > 10 || !size) {
      return NextResponse.json({ error: "Article invalide." }, { status: 400 });
    }
    const product = await getProductById(productId);
    if (!product || product.status !== "published") return NextResponse.json({ error: "Un article n’est plus disponible." }, { status: 409 });
    const colors = product.colors.length ? product.colors : (product.color ? [product.color] : []);
    const color = requestedColor || colors[0] || undefined;
    if (requestedColor && !colors.includes(requestedColor)) return NextResponse.json({ error: "Couleur invalide." }, { status: 409 });
    const variantExists = product.variants.length
      ? product.variants.some((variant) => variant.size === size && variant.color === (color ?? ""))
      : product.sizes.some((entry) => entry.label === size);
    if (!variantExists) return NextResponse.json({ error: "Taille invalide." }, { status: 409 });
    items.push({ productId, slug: product.slug, name: product.name, image: (color ? product.colorImages[color] : "") || product.images[0] || "", size, color, quantity, unitPriceCents: product.priceCents });
  }

  try {
    const draft = await upsertAbandonedCheckout({
      checkoutToken: body.checkoutToken,
      customerName: String(body.customerName ?? "").trim().replace(/\s+/g, " ").slice(0, 160),
      phone,
      locale: body.locale === "en" || body.locale === "ar" ? body.locale : "fr",
      consentWhatsapp: body.consentWhatsapp === true,
      items,
      subtotalCents: items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0),
      ipHash: requestIpHash(request),
    });
    return NextResponse.json({ ok: true, reminderDueAt: draft.reminderDueAt, reminderStatus: draft.reminderStatus }, { status: 201 });
  } catch (error) {
    if (error instanceof AbandonedCheckoutRateLimitError) return NextResponse.json({ error: "Trop de tentatives." }, { status: 429 });
    return NextResponse.json({ error: "Sauvegarde provisoire impossible." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!validSameOrigin(request)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { checkoutToken?: string };
  if (!isValidCheckoutDraftToken(body.checkoutToken)) return NextResponse.json({ error: "Session de panier invalide." }, { status: 400 });
  await deleteAbandonedCheckout(body.checkoutToken);
  return NextResponse.json({ ok: true });
}
