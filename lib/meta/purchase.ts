import "server-only";

import { claimMetaCapiEvent, markMetaCapiResult, recordMetaAttribution } from "../db-postgres";
import type { Order } from "../types";
import { sendServerEvent } from "./capi";
import { contentId, purchaseEventId } from "./events";
import type { MetaRequestContext } from "./request";

/**
 * Sends the Purchase conversion for an order.
 *
 * Per the approved decision, the Meta Purchase conversion fires when the order is PLACED.
 * This is an advertising optimisation signal only: recognised revenue still follows the
 * delivered/paid rule in the financial model and is computed from the orders table, not from here.
 *
 * Never throws. Tracking failures must not surface to checkout.
 */
export async function sendPurchaseEvent(order: Order, context: MetaRequestContext): Promise<void> {
  try {
    if (!context.consentGranted) return;
    const eventId = purchaseEventId(order.orderNumber);
    // Atomic claim: if a retry or duplicate submit already sent this event, stop here.
    const claimed = await claimMetaCapiEvent(eventId, "Purchase", order.id);
    if (!claimed) return;

    await recordMetaAttribution({
      orderId: order.id,
      fbc: context.fbc ?? null,
      fbp: context.fbp ?? null,
      landingPage: context.eventSourceUrl ?? null,
    }).catch(() => undefined);

    const result = await sendServerEvent({
      eventName: "Purchase",
      eventId,
      eventSourceUrl: context.eventSourceUrl,
      actionSource: "website",
      userData: {
        phone: order.phone,
        firstName: order.firstName,
        lastName: order.lastName,
        city: order.commune,
        state: order.wilayaName,
        country: "DZ",
        externalId: order.customerId ? String(order.customerId) : undefined,
        fbp: context.fbp,
        fbc: context.fbc,
        clientIpAddress: context.clientIpAddress,
        clientUserAgent: context.clientUserAgent,
      },
      customData: {
        content_ids: order.items.map((item) => contentId(item.slug)),
        content_type: "product",
        contents: order.items.map((item) => ({ id: contentId(item.slug), quantity: item.quantity, item_price: item.unitPriceCents / 100 })),
        value: order.totalCents / 100,
        currency: "DZD",
        num_items: order.items.reduce((sum, item) => sum + item.quantity, 0),
        order_id: order.orderNumber,
      },
    }, context.consentGranted);

    await markMetaCapiResult(eventId, result.status, result.error ?? null).catch(() => undefined);
  } catch {
    // Swallowed on purpose: an order is already committed by this point.
  }
}
