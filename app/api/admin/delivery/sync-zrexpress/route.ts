import { NextResponse } from "next/server";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { audit } from "@/lib/db-postgres";
import { syncZrExpressDeliveryRates } from "@/lib/zrexpress";

export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  try {
    const result = await syncZrExpressDeliveryRates();
    await audit(session.adminId, "delivery.rates.sync", "settings", "zrexpress", {
      syncedWilayas: result.syncedWilayas,
      ignoredEntries: result.ignoredEntries,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Synchronisation ZR Express impossible.";
    return NextResponse.json({ error: message.slice(0, 400) }, { status: 502 });
  }
}
