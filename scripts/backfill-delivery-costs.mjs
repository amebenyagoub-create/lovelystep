// Applies carrier and return costs to orders placed before the costs existed.
//
// Same two rules as syncOrderDeliveryCost in lib/db-postgres.ts, kept deliberately identical:
//   - the carrier is paid only once a parcel was actually dispatched (reached "shipped"),
//     so a cancelled order that never left costs nothing;
//   - the return leg is charged only on a refused or returned parcel, never on a delivered one.
//
// Rows an admin entered by hand (source 'manual') are left untouched.
//
// Dry run by default. Nothing is written without --apply.
//   npm run delivery:backfill
//   npm run delivery:backfill -- --apply

import pg from "pg";

const apply = process.argv.includes("--apply");
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL missing. Use the npm script."); process.exit(2); }

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "disable" ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

const COMPUTED = `
  SELECT o.id, o.order_number, o.status, o.delivery_type, o.wilaya_code,
    CASE WHEN (EXISTS(SELECT 1 FROM order_status_history h WHERE h.order_id=o.id AND h.status='shipped')
               OR o.status IN ('shipped','delivered','refused','returned'))
      THEN (CASE WHEN o.delivery_type='office' THEN r.carrier_office_cents ELSE r.carrier_home_cents END)
      ELSE 0 END AS carrier_cost,
    CASE WHEN o.status IN ('refused','returned') THEN r.return_cost_cents ELSE 0 END AS return_cost
  FROM orders o
  JOIN delivery_rates r ON r.wilaya_code = o.wilaya_code
  LEFT JOIN order_delivery_costs c ON c.order_id = o.id
  WHERE c.source IS DISTINCT FROM 'manual'
`;

try {
  await client.connect();

  const configured = await client.query(
    "SELECT count(*)::int AS n FROM delivery_rates WHERE carrier_home_cents > 0 OR carrier_office_cents > 0");
  if (configured.rows[0].n === 0) {
    console.log("No carrier costs are configured yet.");
    console.log("Fill them in first: Admin -> Livraison -> the 'Coût domicile' / 'Coût bureau' columns.");
    process.exit(0);
  }
  console.log(`${configured.rows[0].n} wilaya(s) have carrier costs configured.\n`);

  const { rows } = await client.query(COMPUTED + " ORDER BY o.created_at DESC");
  if (!rows.length) { console.log("No orders to cost."); process.exit(0); }

  const totals = rows.reduce((acc, r) => ({ carrier: acc.carrier + Number(r.carrier_cost), ret: acc.ret + Number(r.return_cost) }), { carrier: 0, ret: 0 });
  console.log(`${rows.length} order(s) would be costed:`);
  for (const row of rows.slice(0, 15)) {
    console.log(`  ${row.order_number}  ${String(row.status).padEnd(11)} w${row.wilaya_code} ${String(row.delivery_type).padEnd(6)}  carrier ${Number(row.carrier_cost) / 100} DZD  return ${Number(row.return_cost) / 100} DZD`);
  }
  if (rows.length > 15) console.log(`  … and ${rows.length - 15} more`);
  console.log(`\n  total carrier ${totals.carrier / 100} DZD · total returns ${totals.ret / 100} DZD`);

  if (!apply) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to save.");
  } else {
    const result = await client.query(
      `INSERT INTO order_delivery_costs (order_id, carrier_cost_cents, return_cost_cents, source)
       SELECT id, carrier_cost, return_cost, 'auto' FROM (${COMPUTED}) AS computed
       ON CONFLICT (order_id) DO UPDATE SET carrier_cost_cents=EXCLUDED.carrier_cost_cents,
         return_cost_cents=EXCLUDED.return_cost_cents, updated_at=NOW()
       WHERE order_delivery_costs.source <> 'manual'`);
    console.log(`\nApplied. ${result.rowCount} order(s) costed.`);
    console.log("Reload the campaign manager — unit economics should now compute.");
  }
} catch (error) {
  console.error("Failed:", error?.message ?? error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
