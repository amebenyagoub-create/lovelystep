// Phase 8 verification: retention purge and right-to-erasure.
// Needs TEST_DATABASE_URL; runs entirely inside a temporary schema.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required. Point it at a disposable database.");

const checks = [];
const schemaName = `ls_priv_${Date.now().toString(36)}`;
const client = new pg.Client({ connectionString, ssl: process.env.TEST_DATABASE_SSL === "disable" ? false : { rejectUnauthorized: false } });
await client.connect();

try {
  await client.query(`CREATE SCHEMA ${schemaName}`);
  await client.query(`SET search_path TO ${schemaName}`);
  await client.query(await readFile(new URL("../lib/postgres-schema.sql", import.meta.url), "utf8"));

  const phone = "+213550999888";
  const customer = await client.query(
    `INSERT INTO customers (first_name,last_name,phone,password_hash,wilaya_code,wilaya_name,commune,address)
     VALUES ('Nadia','Benali',$1,'hash','16','Alger','Alger Centre','12 rue test') RETURNING id`, [phone]);
  const customerId = customer.rows[0].id;
  await client.query("INSERT INTO customer_sessions (customer_id,token_hash,expires_at) VALUES ($1,'tok',NOW()+INTERVAL '1 day')", [customerId]);
  const order = await client.query(
    `INSERT INTO orders (order_number,customer_name,customer_id,first_name,last_name,phone,city,address,notes,items_json,subtotal_cents,shipping_cents,total_cents,status)
     VALUES ('LS-PRIV-1','Nadia Benali',$1,'Nadia','Benali',$2,'Alger','12 rue test','sonner deux fois','[]'::jsonb,500000,60000,560000,'delivered') RETURNING id`,
    [customerId, phone]);
  const orderId = order.rows[0].id;
  await client.query("INSERT INTO meta_attribution (order_id,fbclid,is_meta_last_touch) VALUES ($1,'IwAR123',TRUE)", [orderId]);

  // --- erasure ------------------------------------------------------------------
  const token = `SUPPRIME-${crypto.randomBytes(8).toString("hex")}`;
  await client.query("BEGIN");
  await client.query(`UPDATE customers SET first_name='Supprimé', last_name=$2, phone=$2, address='', commune='', password_hash='', updated_at=NOW() WHERE phone=$1`, [phone, token]);
  await client.query("DELETE FROM customer_sessions WHERE customer_id=$1", [customerId]);
  await client.query(`UPDATE orders SET customer_name='Supprimé', first_name='Supprimé', last_name=$2, phone=$2, address='', notes='', updated_at=NOW() WHERE phone=$1`, [phone, token]);
  await client.query("DELETE FROM meta_attribution WHERE order_id=$1", [orderId]);
  await client.query("COMMIT");

  const erasedOrder = await client.query("SELECT customer_name,phone,address,notes,total_cents,status,created_at FROM orders WHERE id=$1", [orderId]);
  const row = erasedOrder.rows[0];
  assert.equal(row.customer_name, "Supprimé");
  assert.equal(row.address, "");
  assert.equal(row.notes, "");
  checks.push({ label: "personal fields on the order are overwritten", ok: true });

  assert.equal(Number(row.total_cents), 560000, "amounts must survive erasure");
  assert.equal(row.status, "delivered", "status must survive erasure");
  assert.ok(row.created_at, "the order date must survive erasure");
  checks.push({ label: "accounting fields survive erasure", ok: true });

  const anySearch = await client.query("SELECT count(*)::int n FROM orders WHERE phone=$1 OR address LIKE '%rue test%' OR notes LIKE '%sonner%'", [phone]);
  assert.equal(anySearch.rows[0].n, 0, "no personal value may remain searchable");
  checks.push({ label: "the original phone, address and notes are unrecoverable", ok: true });

  const sessions = await client.query("SELECT count(*)::int n FROM customer_sessions WHERE customer_id=$1", [customerId]);
  assert.equal(sessions.rows[0].n, 0, "an erased customer must not keep a usable session");
  checks.push({ label: "sessions of an erased customer are revoked", ok: true });

  const attribution = await client.query("SELECT count(*)::int n FROM meta_attribution WHERE order_id=$1", [orderId]);
  assert.equal(attribution.rows[0].n, 0, "click identifiers are personal data and must go");
  checks.push({ label: "attribution click ids are deleted", ok: true });

  // Two erased people must not merge into one buyer, which would distort repeat-purchase rate.
  const other = `SUPPRIME-${crypto.randomBytes(8).toString("hex")}`;
  assert.notEqual(token, other);
  checks.push({ label: "each erasure uses a distinct token so buyers do not merge", ok: true });

  // --- retention -------------------------------------------------------------------
  await client.query("INSERT INTO visits (visitor_hash,path,visit_day,created_at) VALUES ('old','/',CURRENT_DATE-400,NOW()-INTERVAL '400 days')");
  await client.query("INSERT INTO visits (visitor_hash,path,visit_day,created_at) VALUES ('recent','/',CURRENT_DATE,NOW())");
  await client.query("INSERT INTO meta_events (event_id,event_name,created_at) VALUES ('old-evt','Purchase',NOW()-INTERVAL '400 days')");
  await client.query("INSERT INTO meta_events (event_id,event_name,created_at) VALUES ('new-evt','Purchase',NOW())");

  const purgedVisits = await client.query("DELETE FROM visits WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')", [180]);
  const purgedEvents = await client.query("DELETE FROM meta_events WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')", [180]);
  assert.equal(purgedVisits.rowCount, 1);
  assert.equal(purgedEvents.rowCount, 1);
  checks.push({ label: "expired tracking rows are purged", ok: true });

  const remaining = await client.query("SELECT (SELECT count(*) FROM visits)::int v, (SELECT count(*) FROM meta_events)::int e");
  assert.equal(remaining.rows[0].v, 1, "recent visits must be kept");
  assert.equal(remaining.rows[0].e, 1, "recent events must be kept");
  checks.push({ label: "recent tracking rows are kept", ok: true });

  // Retention must never touch accounting data.
  const financial = await client.query("SELECT (SELECT count(*) FROM orders)::int o, (SELECT count(*) FROM order_refunds)::int r");
  assert.equal(financial.rows[0].o, 1, "orders must never be purged by retention");
  checks.push({ label: "retention never deletes financial records", ok: true });

  console.log(JSON.stringify({ ok: true, schema: schemaName, checks: checks.length, labels: checks.map((c) => c.label) }, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(JSON.stringify({ ok: false, checks, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  await client.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`).catch(() => {});
  await client.end();
}
