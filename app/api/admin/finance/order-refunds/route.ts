import { NextResponse } from "next/server";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { audit, createOrderRefund, RefundExceedsOrderTotalError } from "@/lib/db-postgres";

export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { orderId?: number; amountCents?: number; reason?: string };
  const orderId = Number(body.orderId);
  const amountCents = Number(body.amountCents);
  if (!Number.isInteger(orderId) || orderId < 1 || !Number.isInteger(amountCents) || amountCents < 1 || amountCents > 100_000_000) {
    return NextResponse.json({ error: "Remboursement invalide." }, { status: 400 });
  }
  const reason = String(body.reason ?? "").trim().slice(0, 300);
  try {
    const refund = await createOrderRefund(orderId, amountCents, reason, session.adminId);
    await audit(session.adminId, "order.refund", "order", String(orderId), { amountCents });
    return NextResponse.json({ refund });
  } catch (error) {
    if (error instanceof RefundExceedsOrderTotalError) return NextResponse.json({ error: "Le remboursement dépasse le total de la commande." }, { status: 409 });
    if (error instanceof Error && error.message === "ORDER_NOT_FOUND") return NextResponse.json({ error: "Commande introuvable." }, { status: 404 });
    return NextResponse.json({ error: "Remboursement impossible." }, { status: 500 });
  }
}
