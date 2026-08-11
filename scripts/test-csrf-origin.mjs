// CSRF origin check, including the reverse-proxy case that broke every admin POST in production.
//
// No database and no network: validCsrf is pure, and the pool in db-postgres never connects at
// import time. Run via: npm run test:csrf
import assert from "node:assert/strict";
import { validCsrf } from "../lib/auth.ts";
import { validSameOrigin } from "../lib/customer-auth.ts";

const checks = [];
const check = (label, fn) => { fn(); checks.push(label); };

const CSRF = "s".repeat(32);
const session = { adminId: 1, email: "admin@example.com", csrfToken: CSRF };

/**
 * `url` is what Next hands the route handler, which is built from the server's bind hostname —
 * not from the public domain. The headers are what the proxy actually forwards.
 */
function post(url, headers = {}) {
  return new Request(url, { method: "POST", headers: { "x-csrf-token": CSRF, ...headers } });
}

check("same-origin request in local development is accepted", () => {
  assert.equal(validCsrf(post("http://localhost:3000/api/admin/meta/test-connection", {
    origin: "http://localhost:3000", host: "localhost:3000",
  }), session), true);
});

// The regression: TLS terminates at the proxy, so Next sees http://localhost while the browser
// sends the public https origin. Before the fix this returned false and the admin saw
// "Requête refusée." on every button.
check("request behind a TLS-terminating proxy is accepted", () => {
  assert.equal(validCsrf(post("http://localhost:3000/api/admin/meta/test-connection", {
    origin: "https://lovelystep.up.railway.app",
    host: "lovelystep.up.railway.app",
    "x-forwarded-host": "lovelystep.up.railway.app",
    "x-forwarded-proto": "https",
  }), session), true);
});

check("a proxy chain sends a list, and only the first hop counts", () => {
  assert.equal(validCsrf(post("http://localhost:3000/api/admin/products", {
    origin: "https://lovelystep.up.railway.app",
    "x-forwarded-host": "lovelystep.up.railway.app, internal.railway",
    "x-forwarded-proto": "https, http",
  }), session), true);
});

check("a foreign origin is still refused behind the same proxy", () => {
  assert.equal(validCsrf(post("http://localhost:3000/api/admin/products", {
    origin: "https://evil.example",
    host: "lovelystep.up.railway.app",
    "x-forwarded-host": "lovelystep.up.railway.app",
    "x-forwarded-proto": "https",
  }), session), false);
});

// Downgrading https to http is a different origin, so a stripped-TLS replay must not pass.
check("the same host over the wrong scheme is refused", () => {
  assert.equal(validCsrf(post("http://localhost:3000/api/admin/products", {
    origin: "http://lovelystep.up.railway.app",
    "x-forwarded-host": "lovelystep.up.railway.app",
    "x-forwarded-proto": "https",
  }), session), false);
});

check("a request with no Origin header at all is accepted", () => {
  assert.equal(validCsrf(post("http://localhost:3000/api/admin/products", {
    host: "lovelystep.up.railway.app", "x-forwarded-proto": "https",
  }), session), true);
});

// The token is the actual defence; the origin check is defence in depth. Neither may be skipped.
check("a wrong token is refused even from the correct origin", () => {
  assert.equal(validCsrf(new Request("http://localhost:3000/api/admin/products", {
    method: "POST",
    headers: { "x-csrf-token": "x".repeat(32), origin: "https://lovelystep.up.railway.app", "x-forwarded-host": "lovelystep.up.railway.app", "x-forwarded-proto": "https" },
  }), session), false);
});

check("a missing token is refused", () => {
  assert.equal(validCsrf(new Request("http://localhost:3000/api/admin/products", {
    method: "POST", headers: { origin: "https://lovelystep.up.railway.app" },
  }), session), false);
});

check("a token of a different length is refused without throwing", () => {
  assert.equal(validCsrf(new Request("http://localhost:3000/api/admin/products", {
    method: "POST", headers: { "x-csrf-token": "short" },
  }), session), false);
});

// validSameOrigin guards customer register / login / logout and had the identical bug: it has
// no token to fall back on, so the origin check is the whole defence and must not over-refuse.
check("customer routes accept a legitimate request behind the proxy", () => {
  assert.equal(validSameOrigin(new Request("http://localhost:3000/api/account/login", {
    method: "POST",
    headers: { origin: "https://lovelystep.up.railway.app", "x-forwarded-host": "lovelystep.up.railway.app", "x-forwarded-proto": "https" },
  })), true);
});

check("customer routes still refuse a foreign origin", () => {
  assert.equal(validSameOrigin(new Request("http://localhost:3000/api/account/login", {
    method: "POST",
    headers: { origin: "https://evil.example", "x-forwarded-host": "lovelystep.up.railway.app", "x-forwarded-proto": "https" },
  })), false);
});

console.log(JSON.stringify({ ok: true, checks: checks.length, labels: checks }, null, 2));
