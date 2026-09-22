import { NextResponse } from "next/server";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { deleteAbandonedCheckoutById } from "@/lib/db-postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { id?: number };
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Panier invalide." }, { status: 400 });
  if (!await deleteAbandonedCheckoutById(id)) return NextResponse.json({ error: "Panier introuvable." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
