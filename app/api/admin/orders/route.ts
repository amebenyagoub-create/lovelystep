import { NextResponse } from "next/server";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { audit, updateOrderStatus } from "@/lib/db-postgres";
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
