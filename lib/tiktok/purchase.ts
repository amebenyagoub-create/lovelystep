import "server-only";

import type { Order } from "../types";
import { contentId, purchaseEventId } from "../meta/events";
import type { MetaRequestContext } from "../meta/request";
import { sendTikTokEvent } from "./events-api";
import type { TikTokRequestContext } from "./request";

export async function sendTikTokPurchase(order: Order, context: MetaRequestContext, tiktok: TikTokRequestContext): Promise<void> {
  try {
    if (!context.consentGranted) return;
    await sendTikTokEvent({
      eventName: "Purchase",
      eventId: purchaseEventId(order.orderNumber),
      url: tiktok.url,
      referrer: tiktok.referrer,
      user: {
        phone: order.phone,
        externalId: order.customerId ? String(order.customerId) : undefined,
        ttp: tiktok.ttp,
        ttclid: tiktok.ttclid,
        ip: tiktok.ip,
        userAgent: tiktok.userAgent,
      },
      customData: {
        content_ids: order.items.map((item) => contentId(item.slug)),
        content_type: "product",
        contents: order.items.map((item) => ({ id: contentId(item.slug), quantity: item.quantity, item_price: item.unitPriceCents / 100 })),
        value: order.subtotalCents / 100,
        currency: "DZD",
        num_items: order.items.reduce((sum, item) => sum + item.quantity, 0),
        order_id: order.orderNumber,
      },
    }, tiktok.consentGranted);
  } catch {
    // An advertising call must never affect an order already committed to the database.
  }
}
