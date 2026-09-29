import "server-only";

import webpush from "web-push";
import {
  claimOrdersForAdminPush,
  deleteAdminPushSubscription,
  finishAdminOrderPush,
  listAdminPushSubscriptions,
  type AdminPushSubscription,
} from "./db-postgres";
import type { Order } from "./types";
import { log } from "./log";

type PushPayload = { title: string; body: string; url: string; tag: string };

export function adminPushConfig(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = (process.env.WEB_PUSH_VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = (process.env.WEB_PUSH_VAPID_PRIVATE_KEY ?? "").trim();
  const subject = (process.env.WEB_PUSH_CONTACT ?? "mailto:admin@lovelystep.com").trim();
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

function configureWebPush() {
  const config = adminPushConfig();
  if (!config) throw new Error("WEB_PUSH_NOT_CONFIGURED");
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
}

function pushShape(subscription: AdminPushSubscription): webpush.PushSubscription {
  return { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } };
}

function statusCode(error: unknown): number {
  return typeof error === "object" && error !== null && "statusCode" in error ? Number((error as { statusCode?: unknown }).statusCode) : 0;
}

export async function sendAdminPush(subscription: AdminPushSubscription, payload: PushPayload): Promise<void> {
  configureWebPush();
  await webpush.sendNotification(pushShape(subscription), JSON.stringify(payload), { TTL: 60 * 60, urgency: "high" });
}

function orderPayload(order: Order): PushPayload {
  const quantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const article = quantity > 1 ? `${quantity} articles` : (order.items[0]?.name || "1 article");
  const total = new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(order.totalCents / 100);
  const query = new URLSearchParams({ tab: "orders", q: order.orderNumber }).toString();
  return {
    title: `Nouvelle commande ${order.orderNumber}`,
    body: `${order.customerName} · ${article} · ${total} DA · ${order.wilayaName}`,
    url: `/admin?${query}`,
    tag: `order-${order.id}`,
  };
}

/** Immediate after an order, and retried by the existing Railway cron. */
export async function processAdminOrderPushNotifications(limit = 10): Promise<{ sent: number; failed: number; skipped: boolean }> {
  if (!adminPushConfig()) return { sent: 0, failed: 0, skipped: true };
  let subscriptions = await listAdminPushSubscriptions();
  if (!subscriptions.length) return { sent: 0, failed: 0, skipped: true };
  const orders = await claimOrdersForAdminPush(limit);
  let sent = 0;
  let failed = 0;

  for (const order of orders) {
    let delivered = false;
    let lastError = "Aucun téléphone n'a accepté la notification.";
    for (const subscription of subscriptions) {
      try {
        await sendAdminPush(subscription, orderPayload(order));
        delivered = true;
      } catch (error) {
        const code = statusCode(error);
        lastError = error instanceof Error ? error.message : "Échec Web Push";
        if (code === 404 || code === 410) {
          await deleteAdminPushSubscription(subscription.endpoint);
          subscriptions = subscriptions.filter((value) => value.endpoint !== subscription.endpoint);
        }
      }
    }
    await finishAdminOrderPush(order.id, delivered, lastError);
    if (delivered) sent += 1;
    else {
      failed += 1;
      log.warn("admin_order_push_failed", { orderId: order.id, message: lastError });
    }
  }
  return { sent, failed, skipped: false };
}
