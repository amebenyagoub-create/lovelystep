import { NextResponse } from "next/server";
import { after } from "next/server";
import { validAlgeriaAddress } from "@/lib/algeria";
import { getCustomerSession, normalizeAlgerianPhone } from "@/lib/customer-auth";
import { allowOrderAttempt, allowOrderForPhone, createOrder, getDeliveryRate, getProductById, StockUnavailableError } from "@/lib/db-postgres";
import { shippingAfterPromotion } from "@/lib/free-shipping";
import { getFreeShippingThresholdCents } from "@/lib/free-shipping-server";
import { queueOrderGoogleSheetSync } from "@/lib/google-sheets";
import { sendPurchaseEvent } from "@/lib/meta/purchase";
import { purchaseEventId } from "@/lib/meta/events";
import { parseAttributionPayload, persistOrderAttribution } from "@/lib/meta/persist-attribution";
import { metaRequestContext } from "@/lib/meta/request";
import type { DeliveryType, OrderItem } from "@/lib/types";

export const runtime = "nodejs";
type RequestItem = { productId?: number; size?: string; color?: string; quantity?: number };

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 64 * 1024) return NextResponse.json({ error: "Requête trop volumineuse." }, { status: 413 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  if (!await allowOrderAttempt(ip)) return NextResponse.json({ error: "Trop de tentatives. Veuillez réessayer dans 30 minutes." }, { status: 429 });
  const body = await request.json().catch(() => ({})) as { fullName?: string; firstName?: string; lastName?: string; phone?: string; wilayaCode?: string; commune?: string; deliveryType?: DeliveryType; address?: string; notes?: string; locale?: "fr" | "en" | "ar"; items?: RequestItem[]; attribution?: unknown };
  const submittedName = String(body.fullName ?? "").trim().replace(/\s+/g, " ").slice(0, 160);
  const nameParts = submittedName.split(" ").filter(Boolean);
  const firstName = String(body.firstName ?? nameParts.shift() ?? "").trim().slice(0, 80);
  const lastName = String(body.lastName ?? nameParts.join(" ")).trim().slice(0, 80);
  const customerName = submittedName || `${firstName} ${lastName}`.trim();
  const phone = normalizeAlgerianPhone(String(body.phone ?? ""));
  const wilayaCode = String(body.wilayaCode ?? "").padStart(2, "0");
  const commune = String(body.commune ?? "").trim().slice(0, 120);
  const deliveryType: DeliveryType = body.deliveryType === "office" ? "office" : "home";
  const wilaya = validAlgeriaAddress(wilayaCode, commune);
  const address = "";
  const notes = String(body.notes ?? "").trim().slice(0, 500);
  if (customerName.length < 3 || !phone || !wilaya) {
    return NextResponse.json({ error: "Veuillez vérifier vos coordonnées de livraison." }, { status: 400 });
  }
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) {
    return NextResponse.json({ error: "Votre panier est vide ou invalide." }, { status: 400 });
  }
  // Per-IP throttling above does not stop a rotating-IP flood of fake COD orders,
  // each of which reserves stock and costs a confirmation message.
  if (!await allowOrderForPhone(phone)) {
    return NextResponse.json({ error: "Plusieurs commandes sont déjà en attente de confirmation avec ce numéro. Confirmez-les avant d’en passer une nouvelle." }, { status: 429 });
  }

  const requestedItems = new Map<string, Required<Pick<RequestItem, "productId" | "size" | "quantity">> & { color: string }>();
  for (const item of body.items) {
    if (!item || typeof item !== "object") return NextResponse.json({ error: "Un article du panier est invalide." }, { status: 400 });
    const productId = Number(item.productId);
    const quantity = Number(item.quantity);
    const size = String(item.size ?? "").trim().slice(0, 60);
    const color = String(item.color ?? "").trim().slice(0, 80);
    if (!Number.isInteger(productId) || productId < 1 || !Number.isInteger(quantity) || quantity < 1 || quantity > 10 || !size) {
      return NextResponse.json({ error: "Un article du panier est invalide." }, { status: 400 });
    }
    const key = `${productId}\u0000${size}\u0000${color}`;
    const current = requestedItems.get(key);
    const combinedQuantity = (current?.quantity ?? 0) + quantity;
    if (combinedQuantity > 10) return NextResponse.json({ error: "Maximum 10 pièces identiques par commande." }, { status: 400 });
    requestedItems.set(key, { productId, size, color, quantity: combinedQuantity });
  }

  const items: OrderItem[] = [];
  for (const item of requestedItems.values()) {
    const product = await getProductById(item.productId);
    if (!product || product.status !== "published") return NextResponse.json({ error: "Un article n’est plus disponible." }, { status: 409 });
    const availableColors = product.colors.length ? product.colors : (product.color ? [product.color] : []);
    const color = item.color || availableColors[0] || undefined;
    if (item.color && !availableColors.includes(item.color)) return NextResponse.json({ error: "La couleur sélectionnée n’est plus disponible." }, { status: 409 });
    const availableStock = product.variants.length
      ? product.variants.find((variant) => variant.size === item.size && variant.color === (color ?? ""))?.stock ?? 0
      : product.sizes.find((value) => value.label === item.size)?.stock ?? 0;
    if (availableStock < item.quantity) return NextResponse.json({ error: "Cette couleur ou cette taille n’est plus disponible." }, { status: 409 });
    items.push({
      productId: product.id,
      slug: product.slug,
      name: product.name,
      image: (color ? product.colorImages[color] : "") || product.images[0] || "",
      size: item.size,
      color,
      quantity: item.quantity,
      unitPriceCents: product.priceCents,
      unitCostCents: product.costCents,
    });
  }

  const subtotalCents = items.reduce((total, item) => total + item.unitPriceCents * item.quantity, 0);
  const deliveryRate = await getDeliveryRate(wilayaCode);
  if (!deliveryRate || !deliveryRate.active) return NextResponse.json({ error: "La livraison n’est pas encore disponible dans cette wilaya." }, { status: 409 });
  const regularShippingCents = deliveryType === "office" ? deliveryRate.officeCents : deliveryRate.homeCents;
  const shippingCents = shippingAfterPromotion(subtotalCents, regularShippingCents, getFreeShippingThresholdCents());
  try {
    const customer = await getCustomerSession();
    const order = await createOrder({ customerId: customer?.id ?? null, firstName, lastName, customerName, phone, city: commune, wilayaCode, wilayaName: wilaya.nameFr, commune, address, deliveryType, notes, items, subtotalCents, shippingCents, totalCents: subtotalCents + shippingCents });
    // Tracking runs after the response and swallows its own failures: it must never affect the order.
    const metaContext = metaRequestContext(request);
    const attribution = metaContext.consentGranted ? parseAttributionPayload(body.attribution) : null;
    after(() => persistOrderAttribution(order.id, attribution, metaContext));
    after(() => sendPurchaseEvent(order, metaContext));
    after(() => queueOrderGoogleSheetSync(order));
    // The browser Pixel must reuse this exact id, otherwise Meta counts the purchase twice.
    return NextResponse.json({ ok: true, orderNumber: order.orderNumber, totalCents: order.totalCents, metaEventId: purchaseEventId(order.orderNumber) }, { status: 201 });
  } catch (error) {
    if (error instanceof StockUnavailableError) return NextResponse.json({ error: "Le stock vient de changer. Actualisez votre panier puis réessayez." }, { status: 409 });
    return NextResponse.json({ error: "La commande n’a pas pu être enregistrée." }, { status: 500 });
  }
}
