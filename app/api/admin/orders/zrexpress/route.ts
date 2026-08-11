import { NextResponse } from "next/server";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { audit, claimOrderForDelivery, updateDeliverySync } from "@/lib/db-postgres";
import { createZrExpressParcel } from "@/lib/zrexpress";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { id?: number };
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Commande invalide." }, { status: 400 });

  const claim = await claimOrderForDelivery(id);
  if (claim.status === "not_found") return NextResponse.json({ error: "Commande introuvable." }, { status: 404 });
  if (claim.status === "not_confirmed") return NextResponse.json({ error: "Confirmez d’abord la commande par téléphone." }, { status: 409 });
  if (claim.status === "pending") return NextResponse.json({ error: "Cette commande est déjà en cours d’envoi." }, { status: 409 });
  if (claim.status === "already_sent") return NextResponse.json({ error: "Cette commande a déjà été envoyée à ZR Express." }, { status: 409 });

  try {
    const parcel = await createZrExpressParcel(claim.order);
    await updateDeliverySync(id, { status: "sent", externalId: parcel.id, error: null });
    await audit(session.adminId, "delivery.zrexpress.send", "order", String(id), { parcelId: parcel.id });
    return NextResponse.json({ ok: true, parcelId: parcel.id });
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Envoi ZR Express impossible.").slice(0, 500);
    await updateDeliverySync(id, { status: "failed", externalId: null, error: message });
    await audit(session.adminId, "delivery.zrexpress.failed", "order", String(id), { error: message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
