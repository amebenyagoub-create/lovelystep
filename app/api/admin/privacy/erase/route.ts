import { NextResponse } from "next/server";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { audit, eraseCustomerData } from "@/lib/db-postgres";
import { normalizeAlgerianPhone } from "@/lib/customer-auth";

export const runtime = "nodejs";

/**
 * Right-to-erasure request for one phone number.
 *
 * Irreversible. Orders are kept with their amounts and statuses (accounting records) but every
 * personal field is overwritten. Requires an explicit confirmation flag so a stray request
 * cannot destroy data.
 */
export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { phone?: string; confirm?: boolean };
  const phone = normalizeAlgerianPhone(String(body.phone ?? ""));
  if (!phone) return NextResponse.json({ error: "Numéro de téléphone invalide." }, { status: 400 });
  if (body.confirm !== true) return NextResponse.json({ error: "Confirmation explicite requise : cette action est irréversible." }, { status: 400 });

  const result = await eraseCustomerData(phone);
  if (result.customersAnonymised === 0 && result.ordersAnonymised === 0) {
    return NextResponse.json({ error: "Aucune donnée trouvée pour ce numéro." }, { status: 404 });
  }
  // The audit trail records that an erasure happened, never the erased number itself.
  await audit(session.adminId, "privacy.erase", "customer", result.token, {
    customersAnonymised: result.customersAnonymised,
    ordersAnonymised: result.ordersAnonymised,
    attributionDeleted: result.attributionDeleted,
  });
  return NextResponse.json({
    ok: true,
    ...result,
    note: "Données personnelles effacées. Les commandes sont conservées sans identité, à des fins comptables.",
  });
}
