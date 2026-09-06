// Answers one question: how many people actually reached the site, versus how many Meta and
// the Pixel could see?
//
// The `visits` table is written by /api/analytics/visit, which storefront.tsx and
// product-detail.tsx call with NO consent check — unlike trackMeta right beside it. So this
// table counts everyone who loaded a page, including the visitors who never touched the cookie
// banner and are therefore invisible to Meta. It is the only honest denominator you have.
//
// Read-only. Runs no migration and writes nothing.
//
// Run:
//   npm run traffic:audit                 (today, Africa/Algiers)
//   npm run traffic:audit -- --day=2026-09-06
//   npm run traffic:audit -- --days=7

import pg from "pg";

const args = new Map(
  process.argv.slice(2).filter((arg) => arg.startsWith("--")).map((arg) => {
    const [key, value] = arg.slice(2).split("=");
    return [key, value ?? "true"];
  }),
);

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing. Run through: npm run traffic:audit");
  process.exit(2);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "disable" ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

const days = Number(args.get("days") ?? 1);
const day = args.get("day") ?? null;
const where = day ? "visit_day = $1::date" : `visit_day > CURRENT_DATE - $1::int`;
const params = day ? [day] : [days];

try {
  await client.connect();

  const totals = await client.query(
    `SELECT count(DISTINCT visitor_hash)::int AS visitors, count(*)::int AS page_visits
     FROM visits WHERE ${where}`, params);
  const byPath = await client.query(
    `SELECT path, count(DISTINCT visitor_hash)::int AS visitors, count(*)::int AS page_visits
     FROM visits WHERE ${where} GROUP BY path ORDER BY visitors DESC LIMIT 25`, params);
  const byDay = await client.query(
    `SELECT visit_day::text AS day, count(DISTINCT visitor_hash)::int AS visitors
     FROM visits WHERE ${where} GROUP BY visit_day ORDER BY visit_day DESC`, params);

  const scope = day ? `day ${day}` : `last ${days} day(s) including today`;
  console.log(`=== Real site traffic, ${scope} ===`);
  console.log(`  unique visitors : ${totals.rows[0].visitors}`);
  console.log(`  page visits     : ${totals.rows[0].page_visits}`);
  console.log("\n=== By day ===");
  for (const row of byDay.rows) console.log(`  ${row.day}  ${String(row.visitors).padStart(6)} visitors`);
  console.log("\n=== By page ===");
  for (const row of byPath.rows) console.log(`  ${String(row.visitors).padStart(6)} visitors  ${String(row.page_visits).padStart(6)} visits  ${row.path}`);
  console.log("\nCompare 'unique visitors' with Meta's link clicks for the same day.");
  console.log("Gap = people who tapped the ad but never finished loading the page.");
  console.log("This count does NOT depend on cookie consent, so it is the true arrival number.");
} catch (error) {
  console.error("Query failed:", error?.message ?? error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
