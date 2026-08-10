import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { recordSyncResult } from "@/lib/db-postgres";
import { syncRecentInsights } from "@/lib/meta/ads-insights";
import { syncCatalog } from "@/lib/meta/catalog";
import { MetaTokenExpiredError } from "@/lib/meta/graph";
import { applyRetention } from "@/lib/privacy/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Constant-time comparison so the secret cannot be recovered by timing the response. */
function authorized(request: Request): boolean {
  const expected = (process.env.CRON_SECRET ?? "").trim();
  // No secret configured means the endpoint stays closed rather than open.
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : header;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

/**
 * Scheduled Meta synchronization.
 * Insights and catalog run independently: one failing must not prevent the other.
 */
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });

  const outcome: Record<string, unknown> = {};
  let tokenExpired = false;

  try {
    const insights = await syncRecentInsights();
    outcome.insights = insights;
    await recordSyncResult("insights", true, null, insights);
  } catch (error) {
    tokenExpired ||= error instanceof MetaTokenExpiredError;
    const message = error instanceof Error ? error.message.slice(0, 300) : "Échec insights";
    outcome.insightsError = message;
    await recordSyncResult("insights", false, message, null).catch(() => undefined);
  }

  try {
    const catalog = await syncCatalog(false);
    outcome.catalog = catalog;
    await recordSyncResult("catalog", catalog.failed === 0, catalog.failed ? `${catalog.failed} article(s) refusé(s)` : null, catalog);
  } catch (error) {
    tokenExpired ||= error instanceof MetaTokenExpiredError;
    const message = error instanceof Error ? error.message.slice(0, 300) : "Échec catalogue";
    outcome.catalogError = message;
    await recordSyncResult("catalog", false, message, null).catch(() => undefined);
  }

  try {
    outcome.retention = await applyRetention();
    await recordSyncResult("retention", true, null, outcome.retention);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "Échec purge";
    outcome.retentionError = message;
    await recordSyncResult("retention", false, message, null).catch(() => undefined);
  }

  // A 401 here is a signal for the scheduler to alert: the token needs renewing.
  return NextResponse.json({ ok: !outcome.insightsError && !outcome.catalogError, tokenExpired, ...outcome }, { status: tokenExpired ? 401 : 200 });
}
