// Phase 2 verification: financial foundation tables and money math.
// Requires TEST_DATABASE_URL pointing at a database you are willing to write to.
// Creates a temporary schema, runs the real lib/postgres-schema.sql inside it, then drops it.
import { readFile } from "node:fs/promises";
import pg from "pg";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required. Point it at a disposable database.");

const schemaName = `ls_test_${Date.now().toString(36)}`;
const client = new pg.Client({ connectionString, ssl: process.env.TEST_DATABASE_SSL === "disable" ? false : { rejectUnauthorized: false } });
await client.connect();

const checks = [];
function check(label, condition) {
  checks.push({ label, ok: Boolean(condition) });
  if (!condition) throw new Error(`FAILED: ${label}`);
}

try {
  await client.query(`CREATE SCHEMA ${schemaName}`);
  await client.query(`SET search_path TO ${schemaName}`);
  await client.query(await readFile(new URL("../lib/postgres-schema.sql", import.meta.url), "utf8"));

  const admin = await client.query("INSERT INTO admins (email,password_hash) VALUES ('qa@lovelystep.local','x') RETURNING id");
  const adminId = admin.rows[0].id;
  const product = await client.query("INSERT INTO products (slug,name,price_cents,cost_cents,status) VALUES ('qa-product','QA',250000,100000,'published') RETURNING id");
  const productId = product.rows[0].id;
  const order = await client.query(
    `INSERT INTO orders (order_number,customer_name,phone,city,address,items_json,subtotal_cents,shipping_cents,total_cents)
     VALUES ('LS-QA-1','QA Client','+213550000000','Alger','',$1::jsonb,500000,60000,560000) RETURNING id`,
    [JSON.stringify([{ productId: Number(productId), slug: "qa-product", name: "QA", image: "", size: "80", quantity: 2, unitPriceCents: 250000, unitCostCents: 100000 }])],
  );
  const orderId = order.rows[0].id;

  // Status history preserves timestamps, agent and reason codes.
  await client.query("INSERT INTO order_status_history (order_id,status,changed_by_admin_id,reason_code,note) VALUES ($1,'new',NULL,NULL,NULL)", [orderId]);
  await client.query("INSERT INTO order_status_history (order_id,status,changed_by_admin_id,reason_code,note) VALUES ($1,'confirmed',$2,'phone_ok','Confirmé par téléphone')", [orderId, adminId]);
  await client.query("INSERT INTO order_status_history (order_id,status,changed_by_admin_id,reason_code) VALUES ($1,'delivered',$2,'cash_collected')", [orderId, adminId]);
  const history = await client.query("SELECT status,changed_by_admin_id,reason_code FROM order_status_history WHERE order_id=$1 ORDER BY id", [orderId]);
  check("status history keeps ordered transitions", history.rows.map((row) => row.status).join(",") === "new,confirmed,delivered");
  check("status history records the responsible agent", Number(history.rows[1].changed_by_admin_id) === Number(adminId));
  check("status history records reason codes", history.rows[2].reason_code === "cash_collected");

  // Effective-dated costs: closing the open period must not rewrite history.
  await client.query("INSERT INTO product_costs (product_id,cost_cents,effective_from) VALUES ($1,100000,NOW()-INTERVAL '10 days')", [productId]);
  await client.query("UPDATE product_costs SET effective_to=NOW() WHERE product_id=$1 AND effective_to IS NULL", [productId]);
  await client.query("INSERT INTO product_costs (product_id,cost_cents,effective_from) VALUES ($1,130000,NOW())", [productId]);
  const costs = await client.query("SELECT cost_cents,effective_to FROM product_costs WHERE product_id=$1 ORDER BY effective_from", [productId]);
  check("two cost periods exist", costs.rows.length === 2);
  check("historical cost period is closed, not overwritten", Number(costs.rows[0].cost_cents) === 100000 && costs.rows[0].effective_to !== null);
  check("current cost period is open", Number(costs.rows[1].cost_cents) === 130000 && costs.rows[1].effective_to === null);
  const orderItems = await client.query("SELECT items_json FROM orders WHERE id=$1", [orderId]);
  check("order keeps its own cost snapshot after a cost change", orderItems.rows[0].items_json[0].unitCostCents === 100000);

  // Partial refunds accumulate and never exceed the order total.
  await client.query("INSERT INTO order_refunds (order_id,amount_cents,reason,created_by_admin_id) VALUES ($1,100000,'article abîmé',$2)", [orderId, adminId]);
  await client.query("INSERT INTO order_refunds (order_id,amount_cents,reason,created_by_admin_id) VALUES ($1,60000,'geste commercial',$2)", [orderId, adminId]);
  const refunded = await client.query("SELECT COALESCE(SUM(amount_cents),0)::bigint total FROM order_refunds WHERE order_id=$1", [orderId]);
  check("partial refunds sum exactly", Number(refunded.rows[0].total) === 160000);
  let rejectedNegative = false;
  try { await client.query("INSERT INTO order_refunds (order_id,amount_cents) VALUES ($1,0)", [orderId]); } catch { rejectedNegative = true; }
  check("zero or negative refunds are rejected by the schema", rejectedNegative);

  // Actual delivery costs are separate from the shipping charged to the customer.
  await client.query("INSERT INTO order_delivery_costs (order_id,carrier_cost_cents,return_cost_cents,source) VALUES ($1,45000,0,'manual')", [orderId]);
  await client.query(
    `INSERT INTO order_delivery_costs (order_id,carrier_cost_cents,return_cost_cents,source) VALUES ($1,45000,25000,'manual')
     ON CONFLICT (order_id) DO UPDATE SET carrier_cost_cents=EXCLUDED.carrier_cost_cents,return_cost_cents=EXCLUDED.return_cost_cents,updated_at=NOW()`, [orderId]);
  const deliveryCost = await client.query("SELECT carrier_cost_cents,return_cost_cents FROM order_delivery_costs WHERE order_id=$1", [orderId]);
  check("delivery cost upsert does not duplicate rows", deliveryCost.rows.length === 1);
  check("delivery cost upsert updates the return fee", Number(deliveryCost.rows[0].return_cost_cents) === 25000);

  const shippingRevenue = 60000;
  const shippingDifference = shippingRevenue - Number(deliveryCost.rows[0].carrier_cost_cents) - Number(deliveryCost.rows[0].return_cost_cents);
  check("shipping fee difference is computed in integer cents", shippingDifference === -10000 && Number.isInteger(shippingDifference));

  // Expenses: effective dating drives which period an expense belongs to.
  await client.query("INSERT INTO expenses (category,amount_cents,recurrence,cost_type,effective_from,effective_to,allocation_method) VALUES ('Loyer',2000000,'recurring','fixed',CURRENT_DATE-30,NULL,'revenue_weighted')");
  await client.query("INSERT INTO expenses (category,amount_cents,recurrence,cost_type,effective_from,effective_to,allocation_method) VALUES ('Campagne test',500000,'one_time','variable',CURRENT_DATE-200,CURRENT_DATE-190,'even_split')");
  const active = await client.query("SELECT count(*)::int count FROM expenses WHERE effective_from<=CURRENT_DATE AND (effective_to IS NULL OR effective_to>=CURRENT_DATE)");
  check("only in-period expenses are selected", active.rows[0].count === 1);
  let rejectedAllocation = false;
  try { await client.query("INSERT INTO expenses (category,amount_cents,recurrence,cost_type,effective_from,allocation_method) VALUES ('X',1,'one_time','fixed',CURRENT_DATE,'guess')"); } catch { rejectedAllocation = true; }
  check("unknown allocation methods are rejected", rejectedAllocation);

  // Missing cost data must be distinguishable from a real zero.
  const uncosted = await client.query("INSERT INTO products (slug,name,price_cents,status) VALUES ('qa-no-cost','QA sans coût',180000,'published') RETURNING id");
  const missing = await client.query("SELECT count(*)::int count FROM products p WHERE NOT EXISTS (SELECT 1 FROM product_costs c WHERE c.product_id=p.id)");
  check("products without a cost record are detectable", missing.rows[0].count === 1 && uncosted.rows[0].id);

  // Cascade behaviour: deleting an order must not orphan financial rows.
  await client.query("DELETE FROM orders WHERE id=$1", [orderId]);
  const orphans = await client.query("SELECT (SELECT count(*) FROM order_refunds)::int refunds, (SELECT count(*) FROM order_status_history)::int history, (SELECT count(*) FROM order_delivery_costs)::int costs");
  check("order-scoped financial rows cascade on delete", orphans.rows[0].refunds === 0 && orphans.rows[0].history === 0 && orphans.rows[0].costs === 0);

  // Backfill migration: mirrors runMigrationOnce("2026-08-order-status-history-backfill") in lib/db-postgres.ts.
  // This is the only part of Phase 2 that rewrites pre-existing production rows, so it is exercised here.
  const legacy = await client.query(
    `INSERT INTO orders (order_number,customer_name,phone,city,address,items_json,subtotal_cents,shipping_cents,total_cents,status,created_at)
     VALUES ('LS-QA-LEGACY','Ancien Client','+213550000001','Oran','','[]'::jsonb,300000,50000,350000,'delivered',NOW()-INTERVAL '20 days') RETURNING id`);
  const legacyId = legacy.rows[0].id;
  await client.query("INSERT INTO audit_logs (admin_id,action,entity_type,entity_id,details_json,created_at) VALUES ($1,'order.status','order',$2,'{\"status\":\"confirmed\"}'::jsonb,NOW()-INTERVAL '19 days')", [adminId, String(legacyId)]);
  await client.query("INSERT INTO audit_logs (admin_id,action,entity_type,entity_id,details_json,created_at) VALUES ($1,'order.status','order',$2,'{\"status\":\"delivered\"}'::jsonb,NOW()-INTERVAL '18 days')", [adminId, String(legacyId)]);
  await client.query("INSERT INTO audit_logs (admin_id,action,entity_type,entity_id,details_json,created_at) VALUES ($1,'product.update','product','999','{}'::jsonb,NOW())", [adminId]);

  // The deleted order above left its audit_logs rows behind (entity_id is untyped text, no foreign key).
  // A backfill without the EXISTS guard would raise a foreign key violation here and break application boot.
  await client.query("INSERT INTO audit_logs (admin_id,action,entity_type,entity_id,details_json) VALUES ($1,'order.status','order',$2,'{\"status\":\"confirmed\"}'::jsonb)", [adminId, String(orderId)]);
  await client.query("INSERT INTO audit_logs (admin_id,action,entity_type,entity_id,details_json) VALUES ($1,'order.status','order','not-a-number','{\"status\":\"confirmed\"}'::jsonb)", [adminId]);

  await client.query("INSERT INTO order_status_history (order_id,status,created_at) SELECT id,'new',created_at FROM orders");
  await client.query(`INSERT INTO order_status_history (order_id,status,changed_by_admin_id,created_at)
    SELECT entity_id::bigint, details_json->>'status', admin_id, created_at FROM audit_logs
    WHERE action='order.status' AND entity_type='order' AND entity_id ~ '^[0-9]+$' AND details_json->>'status' IS NOT NULL
      AND EXISTS (SELECT 1 FROM orders o WHERE o.id = entity_id::bigint)
    ORDER BY created_at ASC`);

  const backfilled = await client.query("SELECT status FROM order_status_history WHERE order_id=$1 ORDER BY created_at ASC", [legacyId]);
  check("backfill seeds an opening 'new' row per existing order", backfilled.rows[0]?.status === "new");
  check("backfill replays audit_logs transitions in order", backfilled.rows.map((row) => row.status).join(",") === "new,confirmed,delivered");
  check("backfill ignores non-order audit actions", backfilled.rows.length === 3);
  const backfillOpening = await client.query("SELECT h.created_at = o.created_at match FROM order_status_history h JOIN orders o ON o.id=h.order_id WHERE h.order_id=$1 AND h.status='new'", [legacyId]);
  check("backfill preserves exact timestamps without precision loss", backfillOpening.rows[0].match === true);
  const total = await client.query("SELECT count(*)::int count FROM order_status_history");
  check("backfill skips audit rows whose order was deleted", total.rows[0].count === 3);
  check("backfill skips non-numeric entity ids", total.rows[0].count === 3);

  console.log(JSON.stringify({ ok: true, schema: schemaName, checks }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, checks, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  await client.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`).catch(() => {});
  await client.end();
}
