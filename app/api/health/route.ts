import { NextResponse } from "next/server";
import { databasePing, sheetOutboxDepth } from "@/lib/db-postgres";
import { getZrExpressStatus } from "@/lib/zrexpress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOOTED_AT = new Date().toISOString();

/**
 * Public health check for an uptime monitor.
 *
 * Booleans and counts only — no hostnames, no identifiers, nothing that helps an
 * attacker. Returns 503 when the database is unreachable or the Google Sheet
 * outbox has genuinely stalled, so a monitor can page on either. A backlog alone
 * is not a failure: the cron may simply not have run yet.
 */
export async function GET() {
  const database = await databasePing();

  let outbox: { pending: number; failing: number; oldestPendingAt: string | null } | null = null;
  try {
    outbox = await sheetOutboxDepth();
  } catch {
    outbox = null;
  }

  // Orders queued for more than an hour mean the scheduled sync is not running,
  // and every one of them is a customer the confirmation agent never saw.
  const stalled = Boolean(outbox?.oldestPendingAt && Date.now() - Date.parse(outbox.oldestPendingAt) > 60 * 60 * 1000);
  const zr = getZrExpressStatus();
  const ok = database && !stalled;

  return NextResponse.json({
    ok,
    bootedAt: BOOTED_AT,
    uptimeMinutes: Math.round(process.uptime() / 60),
    database,
    googleSheets: { configured: Boolean((process.env.GOOGLE_SHEETS_SPREADSHEET_ID ?? "").trim()), outbox, stalled },
    zrExpress: { configured: zr.ready },
  }, { status: ok ? 200 : 503 });
}
