// Shows what attribution was actually captured for recent orders, and why an order is or is not
// matched to a Meta campaign.
//
// The dashboard matches an order to a campaign by normalising `meta_attribution.utm_campaign`
// (strip accents, lowercase, drop everything non-alphanumeric) and comparing it to the campaign
// name from Meta insights. An empty or missing utm_campaign can never match, and adding URL
// parameters to the ads today does NOT rewrite orders that were already placed.
//
// Read-only. Writes nothing.
//
// Run: npm run orders:attribution            (last 14 days)
//      npm run orders:attribution -- --days=30

import pg from "pg";

const args = new Map(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
  const [k, v] = a.slice(2).split("="); return [k, v ?? "true"];
}));
const days = Number(args.get("days") ?? 14);

if (!process.env.DATABASE_URL) { console.error("DATABASE_URL missing. Use: npm run orders:attribution"); process.exit(2); }

const normalize = (value) => (value ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "disable" ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

try {
  await client.connect();
  const { rows } = await client.query(
    `SELECT o.id, o.order_number, o.status, o.created_at,
            a.utm_source, a.utm_medium, a.utm_campaign, a.utm_content, a.utm_term,
            a.fbclid, a.fbc, a.fbp, a.landing_page, a.referrer
     FROM orders o LEFT JOIN meta_attribution a ON a.order_id = o.id
     WHERE o.created_at > NOW() - ($1::int * INTERVAL '1 day')
     ORDER BY o.created_at DESC LIMIT 50`, [days]);

  if (!rows.length) { console.log(`No orders in the last ${days} day(s).`); }
  for (const row of rows) {
    const key = normalize(row.utm_campaign);
    console.log(`\n--- order ${row.order_number} (id ${row.id}) · ${row.status} · ${new Date(row.created_at).toISOString()}`);
    if (!row.utm_source && !row.landing_page && !row.fbclid) {
      console.log("    NO attribution row at all — nothing was captured for this visitor.");
    }
    console.log(`    utm_campaign : ${row.utm_campaign ?? "(none)"}${key ? `   -> matches key "${key}"` : "   -> CANNOT MATCH (empty)"}`);
    console.log(`    utm_source   : ${row.utm_source ?? "(none)"}    utm_medium: ${row.utm_medium ?? "(none)"}`);
    console.log(`    utm_content  : ${row.utm_content ?? "(none)"}    utm_term  : ${row.utm_term ?? "(none)"}`);
    console.log(`    fbclid       : ${row.fbclid ? "present" : "(none)"}    fbc: ${row.fbc ? "present" : "(none)"}    fbp: ${row.fbp ? "present" : "(none)"}`);
    console.log(`    landing page : ${row.landing_page ?? "(none)"}`);
    console.log(`    referrer     : ${row.referrer ?? "(none)"}`);
  }
  console.log("\nAn order matches a campaign only when its utm_campaign key equals the normalised");
  console.log("Meta campaign name. LS_COLD_SEP26 normalises to: " + normalize("LS_COLD_SEP26"));
} catch (error) {
  console.error("Query failed:", error?.message ?? error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
