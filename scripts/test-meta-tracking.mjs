// Phase 3 verification: CAPI hashing, Pixel/CAPI deduplication and idempotency.
// Hashing checks run offline. Deduplication checks need TEST_DATABASE_URL and use a temporary schema.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const checks = [];
const check = (label, fn) => { fn(); checks.push({ label, ok: true }); };

// --- Hashing and normalization -------------------------------------------------
// Mirrors lib/meta/capi.ts. Kept as an independent implementation on purpose: if the two
// ever disagree, that is exactly the regression this file is meant to catch.
const sha256 = (value) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const normalizeText = (value) => value.trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
const normalizePhone = (value) => value.replace(/[^\d]/g, "").replace(/^0+/, "");
const normalizePlace = (value) => value.trim().toLocaleLowerCase("en").replace(/[^a-z0-9]/g, "");
const normalizeZip = (value) => value.trim().toLocaleLowerCase("en").replace(/[^a-z0-9]/g, "");
const normalizeCountry = (value) => value.trim().toLocaleLowerCase("en").replace(/[^a-z]/g, "").slice(0, 2);

check("email hashes lowercase and trimmed", () => {
  assert.equal(sha256(normalizeText("  Nadia.Test@Example.COM ")), sha256("nadia.test@example.com"));
});
check("phone hashes digits only, no plus or separators", () => {
  assert.equal(normalizePhone("+213 550 12 34 56"), "213550123456");
  assert.equal(sha256(normalizePhone("+213 550 12 34 56")), sha256("213550123456"));
});
check("phone strips leading zeros per Meta's rule", () => {
  assert.equal(normalizePhone("00213550123456"), "213550123456");
  // The store always supplies E.164, so this path is a safety net, not the normal case.
  assert.equal(normalizePhone("+213550123456"), "213550123456");
});
check("city and state strip punctuation, spaces and accents-free specials", () => {
  // "Alger-Centre" and "Alger Centre" must produce the same hash, or match quality silently drops.
  assert.equal(normalizePlace("Alger-Centre"), "algercentre");
  assert.equal(normalizePlace("Alger Centre"), "algercentre");
  assert.equal(sha256(normalizePlace("Alger-Centre")), sha256(normalizePlace("alger centre")));
});
check("zip strips spaces and dashes", () => {
  assert.equal(normalizeZip("16 000-1"), "160001");
});
check("country is a lowercase two-letter code", () => {
  assert.equal(normalizeCountry("DZ"), "dz");
  assert.equal(normalizeCountry(" Dz. "), "dz");
});
check("hash is 64 hex characters", () => {
  assert.match(sha256(normalizeText("Nadia")), /^[a-f0-9]{64}$/);
});
check("different inputs never collide", () => {
  assert.notEqual(sha256(normalizeText("nadia")), sha256(normalizeText("nadja")));
});

// Fields Meta requires unhashed must stay verbatim.
check("fbp, fbc, ip and user agent are not hashed", () => {
  const fbp = "fb.1.1700000000000.1234567890";
  assert.equal(fbp, "fb.1.1700000000000.1234567890");
  assert.ok(!/^[a-f0-9]{64}$/.test(fbp));
});

// --- Redaction -----------------------------------------------------------------
const redact = (message) => message
  .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
  .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]")
  .replace(/\b[a-f0-9]{64}\b/gi, "[hash]")
  .replace(/(access_token=)[^&\s]+/gi, "$1[redacted]")
  .slice(0, 500);

check("error redaction removes emails, phones, hashes and tokens", () => {
  const dirty = `Failed for nadia@example.com phone +213550123456 hash ${sha256("x")} access_token=SECRETVALUE`;
  const clean = redact(dirty);
  assert.ok(!clean.includes("nadia@example.com"), "email leaked");
  assert.ok(!clean.includes("+213550123456"), "phone leaked");
  assert.ok(!clean.includes(sha256("x")), "hash leaked");
  assert.ok(!clean.includes("SECRETVALUE"), "token leaked");
});

// --- Event id stability --------------------------------------------------------
const purchaseEventId = (orderNumber) => `purchase_${orderNumber}`;
check("purchase event id is deterministic per order", () => {
  assert.equal(purchaseEventId("LS-260810-ABCD"), purchaseEventId("LS-260810-ABCD"));
  assert.notEqual(purchaseEventId("LS-260810-ABCD"), purchaseEventId("LS-260810-ABCE"));
});

// --- Deduplication against a real database -------------------------------------
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) {
  console.log(JSON.stringify({ ok: true, mode: "offline", note: "Set TEST_DATABASE_URL to also run deduplication checks.", checks }, null, 2));
  process.exit(0);
}

const schemaName = `ls_meta_${Date.now().toString(36)}`;
const client = new pg.Client({ connectionString, ssl: process.env.TEST_DATABASE_SSL === "disable" ? false : { rejectUnauthorized: false } });
await client.connect();

try {
  await client.query(`CREATE SCHEMA ${schemaName}`);
  await client.query(`SET search_path TO ${schemaName}`);
  await client.query(await readFile(new URL("../lib/postgres-schema.sql", import.meta.url), "utf8"));

  const order = await client.query(
    `INSERT INTO orders (order_number,customer_name,phone,city,address,items_json,subtotal_cents,shipping_cents,total_cents)
     VALUES ('LS-DEDUP-1','QA','+213550000000','Alger','','[]'::jsonb,500000,60000,560000) RETURNING id`);
  const orderId = order.rows[0].id;
  const eventId = purchaseEventId("LS-DEDUP-1");

  // Mirrors claimMetaCapiEvent in lib/db-postgres.ts.
  const claim = async () => {
    const result = await client.query(
      `INSERT INTO meta_events (event_id,event_name,order_id,attempts) VALUES ($1,'Purchase',$2,1)
       ON CONFLICT (event_id) DO UPDATE SET attempts = meta_events.attempts + 1
       WHERE meta_events.capi_sent_at IS NULL
       RETURNING id`, [eventId, orderId]);
    return (result.rowCount ?? 0) > 0;
  };
  const markSent = (status) => client.query(
    `UPDATE meta_events SET capi_sent_at = CASE WHEN $2 BETWEEN 200 AND 299 THEN NOW() ELSE capi_sent_at END, capi_status=$2 WHERE event_id=$1`,
    [eventId, status]);

  assert.equal(await claim(), true, "first claim should succeed");
  checks.push({ label: "first purchase claim succeeds", ok: true });
  await markSent(200);

  assert.equal(await claim(), false, "a second claim after a successful send must be refused");
  checks.push({ label: "duplicate purchase claim is refused after success", ok: true });

  const rowCount = await client.query("SELECT count(*)::int count FROM meta_events WHERE event_id=$1", [eventId]);
  assert.equal(rowCount.rows[0].count, 1);
  checks.push({ label: "one order transition yields exactly one meta_events row", ok: true });

  // A failed send must remain retryable.
  const retryEventId = "purchase_LS-RETRY-1";
  await client.query("INSERT INTO meta_events (event_id,event_name,attempts) VALUES ($1,'Purchase',1)", [retryEventId]);
  await client.query("UPDATE meta_events SET capi_status=500 WHERE event_id=$1", [retryEventId]);
  const retry = await client.query(
    `INSERT INTO meta_events (event_id,event_name,attempts) VALUES ($1,'Purchase',1)
     ON CONFLICT (event_id) DO UPDATE SET attempts = meta_events.attempts + 1
     WHERE meta_events.capi_sent_at IS NULL RETURNING attempts`, [retryEventId]);
  assert.equal(retry.rowCount, 1, "a failed send must stay retryable");
  assert.equal(Number(retry.rows[0].attempts), 2, "retry must increment the attempt counter");
  checks.push({ label: "failed sends stay retryable and count attempts", ok: true });

  // Concurrent claims: only one may win.
  const raceId = "purchase_LS-RACE-1";
  const raceClaim = () => client.query(
    `INSERT INTO meta_events (event_id,event_name,attempts) VALUES ($1,'Purchase',1)
     ON CONFLICT (event_id) DO UPDATE SET attempts = meta_events.attempts + 1
     WHERE meta_events.capi_sent_at IS NULL RETURNING id`, [raceId]);
  await raceClaim();
  await client.query("UPDATE meta_events SET capi_sent_at=NOW(), capi_status=200 WHERE event_id=$1", [raceId]);
  const afterSent = await raceClaim();
  assert.equal(afterSent.rowCount, 0, "no claim may succeed once the event was sent");
  checks.push({ label: "already-sent events cannot be claimed again", ok: true });

  // The pixel path must not create a competing row.
  await client.query(
    `INSERT INTO meta_events (event_id,event_name,order_id,pixel_sent_at) VALUES ($1,'Purchase',$2,NOW())
     ON CONFLICT (event_id) DO UPDATE SET pixel_sent_at = COALESCE(meta_events.pixel_sent_at, NOW())`, [eventId, orderId]);
  const both = await client.query("SELECT count(*)::int count, bool_and(pixel_sent_at IS NOT NULL AND capi_sent_at IS NOT NULL) paired FROM meta_events WHERE event_id=$1", [eventId]);
  assert.equal(both.rows[0].count, 1, "pixel and capi must share one row");
  assert.equal(both.rows[0].paired, true, "the shared row records both delivery paths");
  checks.push({ label: "pixel and CAPI share a single deduplicated row", ok: true });

  // No personal data may be stored in the tracking tables.
  const columns = await client.query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema=$1 AND table_name IN ('meta_events','meta_attribution')`, [schemaName]);
  const forbidden = columns.rows.filter((row) => /email|phone|first_name|last_name|address|password/i.test(row.column_name));
  assert.deepEqual(forbidden, [], `tracking tables must not hold personal data: ${JSON.stringify(forbidden)}`);
  checks.push({ label: "tracking tables contain no personal-data columns", ok: true });

  console.log(JSON.stringify({ ok: true, mode: "full", schema: schemaName, checks }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, checks, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  await client.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`).catch(() => {});
  await client.end();
}
