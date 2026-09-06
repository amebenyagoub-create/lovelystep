// Runs the Meta Insights sync from the command line and records FX rates.
//
// Why this exists: the admin "Synchroniser les insights" button reports success through a
// notice banner and swallows nothing, but it gives no visibility when the sync legitimately
// returns zero rows. This script does exactly what the button and the cron do, and prints the
// row count per level plus the full error, so a silent run can be told apart from a failed one.
//
// Run:
//   node --env-file=.env.local --conditions react-server --experimental-strip-types \
//        --import ./scripts/ts-resolve-hook.mjs scripts/meta-bootstrap.mjs
//
// Options (all optional):
//   --days=7                 trailing window re-fetched, matching syncRecentInsights
//   --fx-rate=250            DZD per one unit of --currency; omit to skip the FX step
//   --currency=USD           currency the ad account bills in
//   --fx-since=YYYY-MM-DD    first day to cover (default: --days ago)
//   --fx-until=YYYY-MM-DD    last day to cover (default: today)
//   --skip-sync              only write FX rates
//
// NOTE: .env.local points at the production database. That is deliberate here — this is the
// same write the cron performs. Insight upserts are idempotent and FX upserts are keyed on
// (rate_date, currency), so re-running corrects rather than duplicates.

import { syncRecentInsights } from "../lib/meta/ads-insights.ts";
import { listSyncState, recordSyncResult, upsertFxRate } from "../lib/db-postgres.ts";

const args = new Map(
  process.argv.slice(2)
    .filter((arg) => arg.startsWith("--"))
    .map((arg) => {
      const [key, value] = arg.slice(2).split("=");
      return [key, value ?? "true"];
    }),
);

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDate = (date) => date.toISOString().slice(0, 10);
const days = Number(args.get("days") ?? 7);
const currency = String(args.get("currency") ?? "USD").toUpperCase();
const fxRate = args.has("fx-rate") ? Number(args.get("fx-rate")) : null;
const fxUntil = args.get("fx-until") ?? isoDate(new Date());
const fxSince = args.get("fx-since") ?? isoDate(new Date(Date.now() - days * DAY_MS));

let failed = false;

console.log("=== sync state before ===");
try {
  const state = await listSyncState();
  if (!state.length) console.log("  (empty) — no sync has ever been recorded");
  for (const row of state) {
    console.log(`  ${row.syncKey}: lastRun=${row.lastRunAt ?? "never"} lastSuccess=${row.lastSuccessAt ?? "never"} error=${row.lastError ?? "none"}`);
  }
} catch (error) {
  failed = true;
  console.error("  could not read sync state:", error);
}

if (!args.has("skip-sync")) {
  console.log(`\n=== syncing insights (trailing ${days} days) ===`);
  try {
    const results = await syncRecentInsights(days);
    // Record it like the cron and the admin button do. Without this a successful run here left
    // the stored lastError from an earlier server-side failure in place, so the dashboard kept
    // showing "insights may be stale" over data that had just been refreshed.
    await recordSyncResult("insights", true, null, results).catch(() => undefined);
    let total = 0;
    for (const result of results) {
      total += result.rows;
      console.log(`  ${result.level.padEnd(8)} ${String(result.rows).padStart(5)} rows  ${result.from} → ${result.to}`);
    }
    console.log(`  total: ${total} rows`);
    if (total === 0) {
      console.log("  NOTE: the call succeeded but Meta returned no rows for this window.");
      console.log("        Check META_AD_ACCOUNT_ID matches the account that actually spent.");
    }
  } catch (error) {
    failed = true;
    await recordSyncResult("insights", false, String(error?.message ?? error).slice(0, 300), null).catch(() => undefined);
    console.error("  SYNC FAILED:", error?.message ?? error);
    if (error?.stack) console.error(error.stack);
  }
}

if (fxRate != null) {
  console.log(`\n=== FX rates: 1 ${currency} = ${fxRate} DZD, ${fxSince} → ${fxUntil} ===`);
  if (!Number.isFinite(fxRate) || fxRate <= 0 || fxRate > 100_000) {
    failed = true;
    console.error("  invalid --fx-rate");
  } else {
    try {
      let written = 0;
      for (let cursor = Date.parse(`${fxSince}T00:00:00Z`); cursor <= Date.parse(`${fxUntil}T00:00:00Z`); cursor += DAY_MS) {
        await upsertFxRate(isoDate(new Date(cursor)), currency, fxRate, "manual");
        written += 1;
      }
      console.log(`  wrote ${written} daily rate(s)`);
    } catch (error) {
      failed = true;
      console.error("  FX WRITE FAILED:", error?.message ?? error);
    }
  }
}

console.log(failed ? "\nFinished with errors." : "\nDone.");
process.exit(failed ? 1 : 0);
