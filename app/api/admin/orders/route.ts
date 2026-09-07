import { NextResponse } from "next/server";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { audit, deleteOrder, updateOrderDetails, updateOrderStatus, type OrderEditInput } from "@/lib/db-postgres";
import { findWilaya } from "@/lib/algeria";
import type { OrderStatus } from "@/lib/types";

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
