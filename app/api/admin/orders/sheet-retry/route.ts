import { NextResponse } from "next/server";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { audit, resetOrderSheetSync, sheetOutboxDepth } from "@/lib/db-postgres";
import { drainOrderSheetOutbox } from "@/lib/google-sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manual retry of the Google Sheet export.
 *
 * With an `id`, that order is put back at the front of the queue. Without one,
 * the whole outbox is drained — the "sync now" button, for when you do not want
 * to wait for the scheduled run.
 */
export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });

  const body = await request.json().catch(() => ({})) as { id?: number };
  const id = Number(body.id);

  if (Number.isInteger(id) && id > 0) {
    await resetOrderSheetSync(id);
    await audit(session.adminId, "order.sheet.retry", "order", String(id), null);
  }

  try {
    const outbox = await drainOrderSheetOutbox(100);
    return NextResponse.json({ ok: outbox.failed === 0, outbox, depth: await sheetOutboxDepth() });
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Export impossible.").slice(0, 300);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
