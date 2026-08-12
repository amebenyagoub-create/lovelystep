import { NextResponse } from "next/server";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { audit, listFxRates, upsertFxRate } from "@/lib/db-postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Lists the recorded rates, most recent first, so the admin can see what is already covered.
 * Gaps matter more than values here: a day without a rate makes that day's profit unavailable.
 */
export async function GET(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });

  const url = new URL(request.url);
  const requested = (url.searchParams.get("currency") ?? "USD").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(requested)) return NextResponse.json({ error: "Devise invalide." }, { status: 400 });

  const rates = (await listFxRates([requested]))
    .sort((left, right) => right.rateDate.localeCompare(left.rateDate))
    .slice(0, 90);

  return NextResponse.json({ currency: requested, rates });
}

/** Records the DZD value of one unit of a foreign currency for a given date. */
export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { rateDate?: string; currency?: string; dzdPerUnit?: number; rates?: Array<{ rateDate: string; currency: string; dzdPerUnit: number }> };

  const entries = Array.isArray(body.rates) ? body.rates : [{ rateDate: String(body.rateDate ?? ""), currency: String(body.currency ?? ""), dzdPerUnit: Number(body.dzdPerUnit) }];
  if (!entries.length || entries.length > 400) return NextResponse.json({ error: "Liste de taux invalide." }, { status: 400 });

  for (const entry of entries) {
    const currency = String(entry.currency ?? "").trim().toUpperCase();
    const rate = Number(entry.dzdPerUnit);
    if (!isoDate.test(String(entry.rateDate ?? "")) || !/^[A-Z]{3}$/.test(currency) || !Number.isFinite(rate) || rate <= 0 || rate > 100_000) {
      return NextResponse.json({ error: `Taux invalide pour ${entry.currency ?? "?"} le ${entry.rateDate ?? "?"}.` }, { status: 400 });
    }
  }

  for (const entry of entries) {
    await upsertFxRate(String(entry.rateDate), String(entry.currency).toUpperCase(), Number(entry.dzdPerUnit));
  }
  await audit(session.adminId, "fx.rates.upsert", "settings", "fx_rates", { count: entries.length });
  return NextResponse.json({ ok: true, saved: entries.length });
}
