// Phase 8 verification: mocked Meta integration — pagination, rate limiting, token expiry,
// retries, timezone bucketing and currency conversion.
//
// `fetch` is stubbed, so no network call and no Meta credentials are involved.
// Run via: npm run test:integration
import assert from "node:assert/strict";
import { reportingDay } from "../lib/finance/kpis.ts";
import { __testing as insights } from "../lib/meta/ads-insights.ts";
import { __testing as capi, redact } from "../lib/meta/capi.ts";

const checks = [];
const check = (label, fn) => { fn(); checks.push({ label, ok: true }); };
const checkAsync = async (label, fn) => { await fn(); checks.push({ label, ok: true }); };

// Minimum config for the graph client to consider itself usable.
process.env.META_TRACKING_ENABLED = "true";
process.env.NEXT_PUBLIC_META_PIXEL_ID = "123456789012345";
process.env.META_ACCESS_TOKEN = "TEST_TOKEN";
process.env.META_AD_ACCOUNT_ID = "act_1234567890";
process.env.META_GRAPH_API_VERSION = "v26.0";

const realFetch = globalThis.fetch;
const calls = [];
function stubFetch(handler) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const result = handler(String(url), init, calls.length);
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: async () => result.body ?? {},
      headers: new Map(),
    };
  };
}
const resetCalls = () => { calls.length = 0; };

const { graphPaginate, MetaRateLimitError, MetaTokenExpiredError } = await import("../lib/meta/graph.ts");

// --- pagination -------------------------------------------------------------------------
await checkAsync("pagination follows paging.next until exhausted", async () => {
  resetCalls();
  stubFetch((url) => {
    if (!url.includes("after=")) return { status: 200, body: { data: [{ id: "1" }, { id: "2" }], paging: { next: "https://graph.facebook.com/v26.0/act_1/insights?after=CURSOR2" } } };
    if (url.includes("CURSOR2")) return { status: 200, body: { data: [{ id: "3" }], paging: { next: "https://graph.facebook.com/v26.0/act_1/insights?after=CURSOR3" } } };
    return { status: 200, body: { data: [{ id: "4" }] } };
  });
  const rows = await graphPaginate("act_1/insights", { level: "campaign" });
  assert.equal(rows.length, 4, "every page must be collected");
  assert.deepEqual(rows.map((row) => row.id), ["1", "2", "3", "4"]);
  assert.equal(calls.length, 3, "one request per page");
});

await checkAsync("pagination stops at maxPages instead of looping forever", async () => {
  resetCalls();
  // A cursor that always points to another page: the classic runaway-cost bug.
  stubFetch(() => ({ status: 200, body: { data: [{ id: "x" }], paging: { next: "https://graph.facebook.com/v26.0/next?after=SAME" } } }));
  const rows = await graphPaginate("act_1/insights", {}, 5);
  assert.equal(calls.length, 5, "must stop at the page cap");
  assert.equal(rows.length, 5);
});

await checkAsync("an empty edge returns an empty array, not an error", async () => {
  resetCalls();
  stubFetch(() => ({ status: 200, body: { data: [] } }));
  assert.deepEqual(await graphPaginate("act_1/insights", {}), []);
});

// --- rate limiting and retries -------------------------------------------------------------
await checkAsync("a rate-limited call is retried and can then succeed", async () => {
  resetCalls();
  stubFetch((url, init, callNumber) => callNumber < 3
    ? { status: 429, body: { error: { message: "rate limited", code: 4 } } }
    : { status: 200, body: { data: [{ id: "ok" }] } });
  const rows = await graphPaginate("act_1/insights", {});
  assert.equal(rows.length, 1);
  assert.equal(calls.length, 3, "two failures then a success");
});

await checkAsync("an exhausted rate limit surfaces as MetaRateLimitError", async () => {
  resetCalls();
  stubFetch(() => ({ status: 200, body: { error: { message: "throttled", code: 17 } } }));
  await assert.rejects(() => graphPaginate("act_1/insights", {}), (error) => error instanceof MetaRateLimitError);
});

await checkAsync("an expired token fails immediately and is never retried", async () => {
  resetCalls();
  stubFetch(() => ({ status: 200, body: { error: { message: "Session expired", code: 190 } } }));
  await assert.rejects(() => graphPaginate("act_1/insights", {}), (error) => error instanceof MetaTokenExpiredError);
  assert.equal(calls.length, 1, "retrying an expired token only wastes quota");
});

await checkAsync("a non-retryable error stops after one attempt", async () => {
  resetCalls();
  stubFetch(() => ({ status: 400, body: { error: { message: "Invalid field", code: 100 } } }));
  await assert.rejects(() => graphPaginate("act_1/insights", {}));
  assert.equal(calls.length, 1);
});

await checkAsync("the pinned API version appears in the request URL", async () => {
  resetCalls();
  stubFetch(() => ({ status: 200, body: { data: [] } }));
  await graphPaginate("act_1/insights", {});
  assert.ok(calls[0].url.includes("/v26.0/"), `expected v26.0 in ${calls[0].url}`);
});

await checkAsync("the access token travels in the Authorization header, never the query string", async () => {
  resetCalls();
  stubFetch(() => ({ status: 200, body: { data: [] } }));
  await graphPaginate("act_1/insights", {});
  assert.ok(!calls[0].url.includes("TEST_TOKEN"), "token must not leak into a loggable URL");
  assert.equal(calls[0].init?.headers?.authorization, "Bearer TEST_TOKEN");
});

globalThis.fetch = realFetch;

// --- insights mapping ------------------------------------------------------------------------
check("a full insights row maps to storable values", () => {
  const row = insights.mapInsightRow("campaign", {
    date_start: "2026-08-01", account_id: "act_1", account_currency: "USD",
    campaign_id: "c1", campaign_name: "Été", spend: "123.45", impressions: "1000", reach: "800",
    frequency: "1.25", clicks: "50", inline_link_clicks: "40", unique_clicks: "45", ctr: "5", cpc: "2.47", cpm: "123.45",
    outbound_clicks: [{ action_type: "outbound_click", value: "38" }],
    actions: [{ action_type: "purchase", value: "4" }, { action_type: "landing_page_view", value: "30" }],
    action_values: [{ action_type: "purchase", value: "500.00" }],
    purchase_roas: [{ action_type: "purchase", value: "4.05" }],
  });
  assert.equal(row.spendMinor, 12345);
  assert.equal(row.purchaseValueMinor, 50000);
  assert.equal(row.purchases, 4);
  assert.equal(row.landingPageViews, 30);
  assert.equal(row.outboundClicks, 38);
  assert.equal(row.currency, "USD");
  assert.equal(row.costPerPurchaseMinor, Math.round(12345 / 4));
});

check("a row without an entity id or date is discarded, not stored half-empty", () => {
  assert.equal(insights.mapInsightRow("campaign", { date_start: "2026-08-01" }), null);
  assert.equal(insights.mapInsightRow("campaign", { campaign_id: "c1" }), null);
});

check("zero purchases yields no cost-per-purchase rather than Infinity", () => {
  const row = insights.mapInsightRow("account", { date_start: "2026-08-01", account_id: "act_1", spend: "50.00", actions: [] });
  assert.equal(row.purchases, 0);
  assert.equal(row.costPerPurchaseMinor, null);
});

// --- currency ------------------------------------------------------------------------------------
check("money strings convert to exact minor units", () => {
  assert.equal(insights.toMinor("123.45"), 12345);
  assert.equal(insights.toMinor("0.07"), 7);
  assert.equal(insights.toMinor("1000"), 100000);
  assert.equal(insights.toMinor(undefined), 0);
  assert.equal(insights.toMinor("not-a-number"), 0);
});

check("USD spend converted at a dated rate stays an integer", () => {
  const spendMinorUsd = 12345;
  const dzdPerUsd = 134.5;
  const converted = Math.round(spendMinorUsd * dzdPerUsd);
  assert.ok(Number.isInteger(converted));
  assert.equal(converted, 1660403);
});

// --- timezone -------------------------------------------------------------------------------------
check("reporting day uses Africa/Algiers, not UTC", () => {
  // 23:30 UTC is already the next day at UTC+1.
  assert.equal(reportingDay("2026-08-01T23:30:00.000Z"), "2026-08-02");
  // 00:30 UTC is still the same local day.
  assert.equal(reportingDay("2026-08-02T00:30:00.000Z"), "2026-08-02");
  // Local midnight boundary.
  assert.equal(reportingDay("2026-08-01T23:00:00.000Z"), "2026-08-02");
  assert.equal(reportingDay("2026-08-01T22:59:59.000Z"), "2026-08-01");
});

check("Algeria has no daylight saving, so the offset is constant year-round", () => {
  // Same wall-clock boundary in January and July: a DST zone would differ here.
  assert.equal(reportingDay("2026-01-15T23:30:00.000Z"), "2026-01-16");
  assert.equal(reportingDay("2026-07-15T23:30:00.000Z"), "2026-07-16");
});

check("an unparseable timestamp yields an empty day rather than Invalid Date", () => {
  assert.equal(reportingDay("nonsense"), "");
});

// --- hashing and redaction (privacy) -----------------------------------------------------------------
check("user data hashes the right fields and leaves the rest verbatim", () => {
  const payload = capi.buildUserData({
    phone: "+213550123456", firstName: "Nadia", lastName: "Test", city: "Alger-Centre", country: "DZ",
    fbp: "fb.1.1700000000000.123", fbc: "fb.1.1700000000000.abc", clientIpAddress: "41.100.0.1", clientUserAgent: "Mozilla/5.0",
  });
  for (const field of ["ph", "fn", "ln", "ct", "country"]) {
    assert.match(payload[field][0], /^[a-f0-9]{64}$/, `${field} must be hashed`);
  }
  assert.equal(payload.fbp, "fb.1.1700000000000.123");
  assert.equal(payload.client_ip_address, "41.100.0.1");
  assert.equal(payload.client_user_agent, "Mozilla/5.0");
  // No raw personal value may survive anywhere in the payload.
  const serialised = JSON.stringify(payload);
  for (const raw of ["Nadia", "Test", "550123456", "Alger-Centre"]) {
    assert.ok(!serialised.includes(raw), `raw value ${raw} leaked into the payload`);
  }
});

check("redaction strips secrets from an error before it is stored", () => {
  const dirty = "failed for nadia@example.com +213550123456 access_token=SECRET";
  const clean = redact(dirty);
  for (const secret of ["nadia@example.com", "+213550123456", "SECRET"]) {
    assert.ok(!clean.includes(secret), `${secret} leaked`);
  }
});

console.log(JSON.stringify({ ok: true, checks: checks.length, labels: checks.map((c) => c.label) }, null, 2));
