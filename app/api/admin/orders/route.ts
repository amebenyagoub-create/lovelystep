import { NextResponse } from "next/server";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { after } from "next/server";
import { revalidateTag } from "next/cache";
import { audit, createOrder, deleteOrder, getDeliveryRate, getProductById, StockUnavailableError, updateOrderDetails, updateOrderStatus, type OrderEditInput } from "@/lib/db-postgres";
import { queueOrderGoogleSheetSync } from "@/lib/google-sheets";
import { CATALOG_TAG } from "@/lib/public-cache";
import { findWilaya } from "@/lib/algeria";
import type { OrderItem, OrderStatus } from "@/lib/types";

const statuses: OrderStatus[] = ["new","to_confirm","confirmed","preparing","shipped","delivered","refused","returned","cancelled"];

export async function PATCH(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { id?: number; status?: OrderStatus; reasonCode?: string; note?: string };
  const id = Number(body.id);
  if (!Number.isInteger(id) || !statuses.includes(body.status as OrderStatus)) return NextResponse.json({ error: "Statut invalide." }, { status: 400 });
  const reasonCode = String(body.reasonCode ?? "").trim().slice(0, 60) || null;
  const note = String(body.note ?? "").trim().slice(0, 500) || null;
  const result = await updateOrderStatus(id, body.status!, session.adminId, reasonCode, note);
  if (result === "not_found") return NextResponse.json({ error: "Commande introuvable." }, { status: 404 });
  if (result === "stock_unavailable") return NextResponse.json({ error: "Stock insuffisant pour réactiver cette commande." }, { status: 409 });
  await audit(session.adminId, "order.status", "order", String(id), { status: body.status });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { id?: number };
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Commande invalide." }, { status: 400 });
  try {
    const result = await deleteOrder(id);
    if (result.status === "not_found") return NextResponse.json({ error: "Commande introuvable." }, { status: 404 });
    if (result.status === "delivery_in_progress") {
      return NextResponse.json({ error: "Cette commande est déjà liée à ZR Express. Annulez d’abord le colis chez le transporteur." }, { status: 409 });
    }
    await audit(session.adminId, "order.delete", "order", String(id), {
      orderNumber: result.order.orderNumber,
      status: result.order.status,
      stockRestored: !["refused", "returned", "cancelled"].includes(result.order.status),
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Suppression impossible." }, { status: 500 });
  }
}

/**
 * Admin correction of an existing order: contact, delivery and contents.
 *
 * The body carries no money. Prices, names and images are re-read from the catalogue inside
 * updateOrderDetails, so a tampered request can change what was ordered but never what it cost.
 */
export async function PUT(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });

  const body = await request.json().catch(() => ({})) as Partial<OrderEditInput> & { id?: number };
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Commande invalide." }, { status: 400 });

  const customerName = String(body.customerName ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const commune = String(body.commune ?? "").trim();
  const wilaya = findWilaya(String(body.wilayaCode ?? ""));
  if (customerName.length < 3) return NextResponse.json({ error: "Nom du client trop court." }, { status: 400 });
  if (phone.replace(/\D/g, "").length < 9) return NextResponse.json({ error: "Numéro de téléphone invalide." }, { status: 400 });
  if (!wilaya) return NextResponse.json({ error: "Wilaya invalide." }, { status: 400 });
  if (!commune) return NextResponse.json({ error: "Commune manquante." }, { status: 400 });
  if (!Array.isArray(body.items) || body.items.length === 0) return NextResponse.json({ error: "La commande doit contenir au moins un article." }, { status: 400 });

  try {
    const result = await updateOrderDetails(id, {
      customerName, phone, commune,
      wilayaCode: wilaya.code,
      wilayaName: wilaya.nameFr,
      address: String(body.address ?? "").trim(),
      deliveryType: body.deliveryType === "office" ? "office" : "home",
      items: body.items.map((item) => ({
        productId: Number(item.productId),
        size: String(item.size ?? ""),
        color: item.color == null ? undefined : String(item.color),
        quantity: Number(item.quantity),
      })),
    }, session.adminId);

    if (result.status === "not_found") return NextResponse.json({ error: "Commande introuvable." }, { status: 404 });
    if (result.status === "invalid") return NextResponse.json({ error: result.reason }, { status: 400 });
    if (result.status === "stock_unavailable") return NextResponse.json({ error: "Stock insuffisant pour cette modification." }, { status: 409 });
    if (result.status === "dispatched") {
      return NextResponse.json({ error: "Commande déjà envoyée à ZR Express : annulez le colis chez le transporteur avant de la modifier." }, { status: 409 });
    }
    return NextResponse.json({ ok: true, order: result.order });
  } catch {
    return NextResponse.json({ error: "Modification impossible." }, { status: 500 });
  }
}

/**
 * Manual order, taken by phone, WhatsApp or Instagram DM.
 *
 * Built exactly like a storefront order — same catalogue prices, same stock reservation, same
 * Google Sheets queue — with two deliberate omissions:
 *
 *  - No Meta attribution row. Nobody clicked an ad, so there is no campaign to attach it to.
 *  - No Purchase event to Meta. Reporting it would credit the campaign with a sale it did not
 *    produce, inflating ROAS and lowering the target CPA the engine derives from it. A manual
 *    order is real revenue for the store and no revenue for the advertising, and the numbers
 *    only stay usable if that stays true.
 *
 * It still reaches Google Sheets and ZR Express, because it is a real parcel to deliver.
 */
export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });

  const body = await request.json().catch(() => ({})) as Partial<OrderEditInput> & { notes?: string };
  const customerName = String(body.customerName ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const commune = String(body.commune ?? "").trim();
  const wilaya = findWilaya(String(body.wilayaCode ?? ""));
  const deliveryType = body.deliveryType === "office" ? "office" : "home";
  if (customerName.length < 3) return NextResponse.json({ error: "Nom du client trop court." }, { status: 400 });
  if (phone.replace(/\D/g, "").length < 9) return NextResponse.json({ error: "Numéro de téléphone invalide." }, { status: 400 });
  if (!wilaya) return NextResponse.json({ error: "Wilaya invalide." }, { status: 400 });
  if (!commune) return NextResponse.json({ error: "Commune manquante." }, { status: 400 });
  if (!Array.isArray(body.items) || body.items.length === 0) return NextResponse.json({ error: "Ajoutez au moins un article." }, { status: 400 });

  const items: OrderItem[] = [];
  for (const line of body.items) {
    const quantity = Math.floor(Number(line.quantity));
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) return NextResponse.json({ error: "Quantité invalide (1 à 10)." }, { status: 400 });
    const product = await getProductById(Math.floor(Number(line.productId)));
    if (!product) return NextResponse.json({ error: "Produit introuvable." }, { status: 400 });
    const size = String(line.size ?? "").trim();
    if (!size) return NextResponse.json({ error: `Taille manquante pour ${product.name}.` }, { status: 400 });
    const availableColors = product.colors.length ? product.colors : (product.color ? [product.color] : []);
    const color = String(line.color ?? "").trim() || availableColors[0] || undefined;
    const stock = product.variants.length
      ? product.variants.find((variant) => variant.size === size && variant.color === (color ?? ""))?.stock ?? 0
      : product.sizes.find((value) => value.label === size)?.stock ?? 0;
    if (stock < quantity) return NextResponse.json({ error: `Stock insuffisant : ${product.name} ${size}.` }, { status: 409 });
    items.push({
      productId: product.id, slug: product.slug, name: product.name,
      image: (color ? product.colorImages[color] : "") || product.images[0] || "",
      size, ...(color ? { color } : {}), quantity,
      unitPriceCents: product.priceCents, unitCostCents: product.costCents,
    });
  }

  const subtotalCents = items.reduce((total, item) => total + item.unitPriceCents * item.quantity, 0);
  const rate = await getDeliveryRate(wilaya.code);
  if (!rate) return NextResponse.json({ error: "Wilaya sans tarif de livraison." }, { status: 409 });
  const shippingCents = Math.max(0, Math.round(Number(deliveryType === "office" ? rate.officeCents : rate.homeCents) || 0));

  try {
    const [firstName, ...rest] = customerName.split(/\s+/);
    const order = await createOrder({
      customerId: null, firstName, lastName: rest.join(" "), customerName, phone,
      city: commune, wilayaCode: wilaya.code, wilayaName: wilaya.nameFr, commune,
      address: String(body.address ?? "").trim(),
      deliveryType,
      notes: String(body.notes ?? "").trim().slice(0, 500),
      items, subtotalCents, shippingCents, totalCents: subtotalCents + shippingCents,
    });
    revalidateTag(CATALOG_TAG, { expire: 0 });
    after(() => queueOrderGoogleSheetSync(order));
    await audit(session.adminId, "order.manual_create", "order", String(order.id), { orderNumber: order.orderNumber, totalCents: order.totalCents, items: items.length });
    return NextResponse.json({ ok: true, order });
  } catch (error) {
    if (error instanceof StockUnavailableError) return NextResponse.json({ error: "Stock insuffisant." }, { status: 409 });
    return NextResponse.json({ error: "Création impossible." }, { status: 500 });
  }
}
