import { NextResponse } from "next/server";
import { findWilaya } from "@/lib/algeria";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { audit, saveDeliveryRates } from "@/lib/db-postgres";
import type { DeliveryRate } from "@/lib/types";

export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { rates?: Partial<DeliveryRate>[] };
  if (!Array.isArray(body.rates) || body.rates.length > 100) return NextResponse.json({ error: "Liste de tarifs invalide." }, { status: 400 });
  const rates: DeliveryRate[] = [];
  for (const rate of body.rates) {
    const wilaya = findWilaya(String(rate.wilayaCode ?? ""));
    const homeCents = Number(rate.homeCents);
    const officeCents = Number(rate.officeCents);
    if (!wilaya || !Number.isInteger(homeCents) || !Number.isInteger(officeCents) || homeCents < 0 || officeCents < 0 || homeCents > 10_000_000 || officeCents > 10_000_000) {
      return NextResponse.json({ error: "Un tarif de livraison est invalide." }, { status: 400 });
    }
    rates.push({ wilayaCode: wilaya.code, wilayaNameFr: wilaya.nameFr, wilayaNameAr: wilaya.nameAr, homeCents, officeCents, active: rate.active !== false });
  }
  const saved = await saveDeliveryRates(rates);
  await audit(session.adminId, "delivery.rates.update", "settings", "delivery_rates", { count: rates.length });
  return NextResponse.json({ rates: saved });
}
