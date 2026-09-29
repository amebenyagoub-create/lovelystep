import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const manifest = read("app/manifest.ts");
const worker = read("public/sw.js");
const orders = read("app/api/orders/route.ts");
const cron = read("app/api/cron/sheet-sync/route.ts");
const schema = read("lib/postgres-schema.sql");
const dashboard = read("app/admin/admin-dashboard.tsx");

assert.match(manifest, /start_url: "\/admin"/);
assert.match(manifest, /display: "standalone"/);
assert.match(worker, /addEventListener\("push"/);
assert.match(worker, /notificationclick/);
assert.match(schema, /admin_push_subscriptions/);
assert.match(schema, /admin_push_sent_at/);
assert.match(orders, /processAdminOrderPushNotifications/);
assert.match(cron, /processAdminOrderPushNotifications/);
assert.match(dashboard, /AdminPwaManager/);
console.log("Admin PWA and order push wiring: OK");
