// Phase 4 verification: Insights parsing, idempotent upserts, catalog payload shape.
// Parsing/payload checks run offline. Upsert checks need TEST_DATABASE_URL (temporary schema).
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const checks = [];
const check = (label, fn) => { fn(); checks.push({ label, ok: true }); };

// --- actions / action_values parsing -------------------------------------------
// Mirrors actionValue() in lib/meta/ads-insights.ts. Meta reorders and omits entries freely,
// so anything that reads these by index eventually reports the wrong metric.
const actionValue = (entries, ...types) => {
  if (!Array.isArray(entries)) return 0;
  for (const type of types) {
    const found = entries.find((entry) => entry.action_type === type);
    if (found) return Number(found.value ?? 0) || 0;
  }
  return 0;
};

const actions = [
  { action_type: "landing_page_view", value: "120" },
  { action_type: "add_to_cart", value: "34" },
  { action_type: "purchase", value: "7" },
  { action_type: "initiate_checkout", value: "12" },
];

check("actions are read by action_type, not position", () => {
  assert.equal(actionValue(actions, "purchase"), 7);
  assert.equal(actionValue(actions, "add_to_cart"), 34);
  // Reordering must not change any result.
  const shuffled = [...actions].reverse();
  assert.equal(actionValue(shuffled, "purchase"), 7);
  assert.equal(actionValue(shuffled, "landing_page_view"), 120);
});

check("a missing action_type yields 0, never a neighbouring value", () => {
  assert.equal(actionValue(actions, "lead"), 0);
  assert.equal(actionValue([], "purchase"), 0);
  assert.equal(actionValue(undefined, "purchase"), 0);
});

check("pixel-prefixed action types are accepted as fallbacks", () => {
  const pixelOnly = [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "5" }];
  assert.equal(actionValue(pixelOnly, "purchase", "offsite_conversion.fb_pixel_purchase"), 5);
});

// --- money handling -------------------------------------------------------------
const toMinor = (value) => {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
};

check("spend converts to exact integer minor units", () => {
  assert.equal(toMinor("123.45"), 12345);
  assert.equal(toMinor("0.1"), 10);
  assert.equal(toMinor(undefined), 0);
  assert.ok(Number.isInteger(toMinor("19.99")));
});

check("floating point cents do not drift", () => {
  // 0.1 + 0.2 in floats is the classic failure; minor units must stay exact.
  assert.equal(toMinor("0.1") + toMinor("0.2"), 30);
});

check("cost per purchase guards division by zero", () => {
  const costPer = (spendMinor, purchases) => purchases > 0 ? Math.round(spendMinor / purchases) : null;
  assert.equal(costPer(10000, 4), 2500);
  assert.equal(costPer(10000, 0), null, "zero purchases must not yield Infinity");
});

// --- catalog payload -------------------------------------------------------------
const priceString = (cents, currency) => `${(cents / 100).toFixed(2)} ${currency || "DZD"}`;
check("catalog price uses 'amount CUR' with two decimals", () => {
  assert.equal(priceString(349000, "DZD"), "3490.00 DZD");
  assert.match(priceString(349000, "DZD"), /^\d+\.\d{2} [A-Z]{3}$/);
});

const availability = (status, stock) => status === "archived" ? "discontinued" : (stock > 0 ? "in stock" : "out of stock");
check("availability uses Meta's exact enum values", () => {
  const allowed = new Set(["in stock", "out of stock", "available for order", "discontinued"]);
  for (const value of [availability("published", 5), availability("published", 0), availability("archived", 5)]) {
    assert.ok(allowed.has(value), `"${value}" is not a valid Meta availability value`);
  }
  assert.equal(availability("published", 0), "out of stock");
});

// Structural check on the real sources: the catalog `id` and the Pixel `content_ids` must both
// come from contentId(). If either side starts using product.id or a raw slug, events stop
// matching catalog products and attribution silently breaks.
const catalogSource = await readFile(new URL("../lib/meta/catalog.ts", import.meta.url), "utf8");
const storefrontSource = await readFile(new URL("../app/storefront.tsx", import.meta.url), "utf8");
const detailSource = await readFile(new URL("../app/produits/[slug]/product-detail.tsx", import.meta.url), "utf8");
const purchaseSource = await readFile(new URL("../lib/meta/purchase.ts", import.meta.url), "utf8");
const productRouteSource = await readFile(new URL("../app/api/admin/products/route.ts", import.meta.url), "utf8");
const pagePostSource = await readFile(new URL("../lib/meta/page-posts.ts", import.meta.url), "utf8");
const schemaSource = await readFile(new URL("../lib/postgres-schema.sql", import.meta.url), "utf8");

check("catalog builds its item id from contentId()", () => {
  assert.match(catalogSource, /id:\s*contentId\(/, "catalog item id must come from contentId()");
});
check("every content_ids producer uses contentId()", () => {
  for (const [name, source] of [["storefront", storefrontSource], ["product detail", detailSource], ["purchase CAPI", purchaseSource]]) {
    const matches = source.match(/content_ids:\s*\[?[^\]\n]*/g) ?? [];
    assert.ok(matches.length > 0, `${name} should emit content_ids`);
    for (const match of matches) {
      assert.ok(match.includes("contentId("), `${name} emits content_ids without contentId(): ${match.trim()}`);
    }
  }
});

const itemHash = (item) => crypto.createHash("sha256").update(JSON.stringify(item)).digest("hex").slice(0, 32);
check("unchanged products hash identically, changed ones do not", () => {
  const item = { id: "a", title: "T", price: "10.00 DZD" };
  assert.equal(itemHash(item), itemHash({ ...item }));
  assert.notEqual(itemHash(item), itemHash({ ...item, price: "11.00 DZD" }));
});

check("product saves schedule Meta automation after the response", () => {
  assert.match(productRouteSource, /after\(\(\) => runProductMetaAutomation/, "product route must schedule post-save Meta work");
  assert.match(productRouteSource, /after\(\(\) => runDeletedProductMetaAutomation/, "hard deletion must also remove the catalogue item");
});

check("Facebook product posts use a Page token and the photos endpoint", () => {
  assert.match(pagePostSource, /META_PAGE_ACCESS_TOKEN/, "Page publishing needs its dedicated Page token");
  assert.match(pagePostSource, /`\$\{pageId\}\/photos`/, "product announcement should publish the main image");
  assert.doesNotMatch(pagePostSource, /pages_manage_ads/, "ads management is not a Page publishing permission");
});

check("Facebook post deduplication has a database primary key", () => {
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS meta_product_page_posts[\s\S]*product_id BIGINT PRIMARY KEY/, "one ledger row per product is required");
});

// --- database: idempotent upserts -------------------------------------------------
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) {
  console.log(JSON.stringify({ ok: true, mode: "offline", note: "Set TEST_DATABASE_URL to also run upsert checks.", checks }, null, 2));
  process.exit(0);
}

const schemaName = `ls_ads_${Date.now().toString(36)}`;
const client = new pg.Client({ connectionString, ssl: process.env.TEST_DATABASE_SSL === "disable" ? false : { rejectUnauthorized: false } });
await client.connect();

try {
  await client.query(`CREATE SCHEMA ${schemaName}`);
  await client.query(`SET search_path TO ${schemaName}`);
  await client.query(await readFile(new URL("../lib/postgres-schema.sql", import.meta.url), "utf8"));

  const insert = (spend, purchases) => client.query(
    `INSERT INTO meta_ads_insights_daily (date,level,entity_id,entity_name,account_id,currency,spend_minor,purchases)
     VALUES ('2026-08-01','campaign','123','Campagne QA','act_1','DZD',$1,$2)
     ON CONFLICT (date,level,entity_id) DO UPDATE SET spend_minor=EXCLUDED.spend_minor, purchases=EXCLUDED.purchases, synced_at=NOW()`,
    [spend, purchases]);

  await insert(50000, 3);
  await insert(50000, 3);
  const afterRepeat = await client.query("SELECT count(*)::int count FROM meta_ads_insights_daily");
  assert.equal(afterRepeat.rows[0].count, 1, "re-syncing the same day must not duplicate rows");
  checks.push({ label: "re-syncing a day upserts instead of duplicating", ok: true });

  // Attribution changes after the fact: a refreshed value must overwrite the old one.
  await insert(50000, 5);
  const refreshed = await client.query("SELECT spend_minor,purchases FROM meta_ads_insights_daily");
  assert.equal(Number(refreshed.rows[0].purchases), 5, "a refreshed day must overwrite stale attribution");
  checks.push({ label: "refreshed attribution overwrites the earlier value", ok: true });

  // Distinct levels for the same id are separate rows, not collisions.
  await client.query(
    `INSERT INTO meta_ads_insights_daily (date,level,entity_id,account_id,currency,spend_minor)
     VALUES ('2026-08-01','ad','123','act_1','DZD',1000)`);
  const levels = await client.query("SELECT count(*)::int count FROM meta_ads_insights_daily WHERE entity_id='123'");
  assert.equal(levels.rows[0].count, 2, "same id at different levels must not collide");
  checks.push({ label: "campaign and ad levels are stored separately", ok: true });

  const badLevel = await client.query(
    `INSERT INTO meta_ads_insights_daily (date,level,entity_id,account_id,currency) VALUES ('2026-08-02','frobnicate','9','act_1','DZD')
     ON CONFLICT DO NOTHING`).then(() => false).catch(() => true);
  assert.equal(badLevel, true, "an unknown level must be rejected by the schema");
  checks.push({ label: "unknown insight levels are rejected", ok: true });

  // Sync state must record failures, not just successes.
  await client.query(
    `INSERT INTO meta_sync_state (sync_key,last_run_at,last_success_at,last_error) VALUES ('insights',NOW(),NOW(),NULL)
     ON CONFLICT (sync_key) DO UPDATE SET last_run_at=NOW()`);
  await client.query(
    `INSERT INTO meta_sync_state (sync_key,last_run_at,last_success_at,last_error) VALUES ('insights',NOW(),NULL,'token expired')
     ON CONFLICT (sync_key) DO UPDATE SET last_run_at=NOW(), last_error=EXCLUDED.last_error,
       last_success_at=COALESCE(EXCLUDED.last_success_at, meta_sync_state.last_success_at)`);
  const state = await client.query("SELECT last_success_at, last_error FROM meta_sync_state WHERE sync_key='insights'");
  assert.ok(state.rows[0].last_success_at !== null, "a later failure must not erase the last success timestamp");
  assert.equal(state.rows[0].last_error, "token expired");
  checks.push({ label: "a failed run records the error and keeps the last success time", ok: true });

  console.log(JSON.stringify({ ok: true, mode: "full", schema: schemaName, checks }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, checks, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  await client.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`).catch(() => {});
  await client.end();
}
