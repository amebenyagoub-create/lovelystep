import { NextResponse } from "next/server";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { audit, recordSyncResult } from "@/lib/db-postgres";
import { backfillInsights, syncRecentInsights } from "@/lib/meta/ads-insights";
import { syncCatalog } from "@/lib/meta/catalog";
import { MetaTokenExpiredError } from "@/lib/meta/graph";

export const runtime = "nodejs";
export const maxDuration = 300;

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/** Manual "Sync now" for the admin Meta page. */
export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { target?: string; since?: string; until?: string; full?: boolean };
  const target = String(body.target ?? "");

  try {
    if (target === "catalog") {
      const result = await syncCatalog(body.full === true);
      await recordSyncResult("catalog", result.failed === 0, result.failed ? `${result.failed} article(s) refusé(s)` : null, result);
      await audit(session.adminId, "meta.sync.catalog", "meta", "catalog", { total: result.total, failed: result.failed });
      return NextResponse.json({ result });
    }
    if (target === "insights") {
      const result = await syncRecentInsights();
      await recordSyncResult("insights", true, null, result);
      await audit(session.adminId, "meta.sync.insights", "meta", "insights", { levels: result.length });
      return NextResponse.json({ result });
    }
    if (target === "backfill") {
      const since = String(body.since ?? "");
      const until = String(body.until ?? "");
      if (!isoDate.test(since) || !isoDate.test(until)) return NextResponse.json({ error: "Dates invalides (AAAA-MM-JJ)." }, { status: 400 });
      const result = await backfillInsights(since, until);
      await recordSyncResult("insights_backfill", true, null, { since, until, chunks: result.length });
      await audit(session.adminId, "meta.sync.backfill", "meta", "insights", { since, until });
      return NextResponse.json({ result });
    }
    return NextResponse.json({ error: "Cible de synchronisation inconnue." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "Synchronisation impossible.";
    await recordSyncResult(target || "unknown", false, message, null).catch(() => undefined);
    if (error instanceof MetaTokenExpiredError) {
      return NextResponse.json({ error: "Le jeton Meta est expiré ou invalide. Renouvelez META_ACCESS_TOKEN." }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
