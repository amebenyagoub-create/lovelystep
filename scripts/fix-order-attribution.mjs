// One-off manual correction: label Meta-sourced orders that were placed while the ads carried
// no URL parameters.
//
// WHY THIS EXISTS, AND WHY IT IS NARROW
// The dashboard matches orders to campaigns by utm_campaign and never guesses. That rule is
// correct and stays. But orders placed before the ads carried UTM parameters recorded a real
// Facebook click (fbc / fbclid set, referrer facebook) with no campaign name to go with it, so
// they can never match no matter what is fixed later.
//
// This script writes the campaign name onto those specific rows and nothing else. It refuses to
// touch:
//   - an order that already has a utm_campaign (it never overwrites measured data)
//   - an order with no Facebook click evidence (no fbc, no fbclid, no facebook referrer)
//   - anything outside the date window you pass
//
// It is a human judgement recorded in the database, not a measurement. Use it once, for the
// window where the ads genuinely had no parameters, then never again — from the moment the ads
// carry UTMs, matching is automatic and this script should find nothing.
//
// Dry run by default. Nothing is written without --apply.
//
//   npm run orders:fix-attribution -- --campaign=LS_COLD_SEP26 --since=2026-09-05
//   npm run orders:fix-attribution -- --campaign=LS_COLD_SEP26 --since=2026-09-05 --apply
//   npm run orders:fix-attribution -- --campaign=LS_COLD_SEP26 --order=49 --apply

import pg from "pg";

const args = new Map(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
  const [k, v] = a.slice(2).split("="); return [k, v ?? "true"];
}));

const campaign = args.get("campaign");
const since = args.get("since") ?? null;
const orderId = args.get("order") ? Number(args.get("order")) : null;
const apply = args.has("apply");

if (!process.env.DATABASE_URL) { console.error("DATABASE_URL missing. Use the npm script."); process.exit(2); }
if (!campaign) { console.error("--campaign is required, e.g. --campaign=LS_COLD_SEP26"); process.exit(2); }
if (!since && !orderId) { console.error("Pass --since=YYYY-MM-DD or --order=<id> so the change stays bounded."); process.exit(2); }

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "disable" ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

// Facebook click evidence, and an empty campaign. Both conditions are required.
const conditions = [
  "(a.utm_campaign IS NULL OR a.utm_campaign = '')",
  "(a.fbc IS NOT NULL OR a.fbclid IS NOT NULL OR a.referrer ILIKE '%facebook%' OR a.referrer ILIKE '%instagram%')",
];
const params = [];
if (orderId) { params.push(orderId); conditions.push(`o.id = $${params.length}`); }
if (since) { params.push(since); conditions.push(`o.created_at >= $${params.length}::date`); }

try {
  await client.connect();
  const { rows } = await client.query(
    `SELECT o.id, o.order_number, o.created_at, a.fbc, a.fbclid, a.referrer, a.landing_page
     FROM orders o JOIN meta_attribution a ON a.order_id = o.id
     WHERE ${conditions.join(" AND ")} ORDER BY o.created_at`, params);

  if (!rows.length) {
    console.log("Nothing to correct: no Meta-sourced order with an empty utm_campaign in that window.");
    console.log("If the ads now carry URL parameters, that is the expected result.");
  } else {
    console.log(`${rows.length} order(s) qualify:\n`);
    for (const row of rows) {
      console.log(`  ${row.order_number} (id ${row.id})  ${new Date(row.created_at).toISOString()}`);
      console.log(`      evidence: fbc=${row.fbc ? "yes" : "no"} fbclid=${row.fbclid ? "yes" : "no"} referrer=${row.referrer ?? "(none)"}`);
      console.log(`      landing : ${row.landing_page ?? "(none)"}   -> would set utm_campaign = ${campaign}`);
    }
    if (!apply) {
      console.log("\nDRY RUN — nothing written. Re-run with --apply to save.");
    } else {
      const ids = rows.map((row) => row.id);
      const result = await client.query(
        `UPDATE meta_attribution SET utm_campaign = $1
         WHERE order_id = ANY($2::int[]) AND (utm_campaign IS NULL OR utm_campaign = '')`,
        [campaign, ids]);
      console.log(`\nApplied. ${result.rowCount} attribution row(s) updated.`);
      console.log("Reload the campaign manager: the order should now attach to the campaign.");
    }
  }
} catch (error) {
  console.error("Failed:", error?.message ?? error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
