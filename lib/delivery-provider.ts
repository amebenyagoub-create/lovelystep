import "server-only";

import { getDeliveryIntegration, updateDeliverySync } from "./db";
import type { Order } from "./types";

export async function dispatchDeliveryOrder(order: Order): Promise<void> {
  const integration = getDeliveryIntegration();
  if (!integration.enabled) return;
  updateDeliverySync(order.id, { status: "pending" });
  try {
    const base = new URL(integration.baseUrl);
    if (base.protocol !== "https:") throw new Error("L’URL du transporteur doit utiliser HTTPS.");
    const endpoint = new URL(integration.createShipmentPath.replace(/^\/+/, ""), `${base.toString().replace(/\/?$/, "/")}`);
    if (endpoint.origin !== base.origin) throw new Error("L’endpoint du transporteur est invalide.");
    const token = process.env[integration.apiTokenEnv];
    if (!token) throw new Error(`La variable ${integration.apiTokenEnv} est absente du serveur.`);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        reference: order.orderNumber,
        customer: { firstName: order.firstName, lastName: order.lastName, phone: order.phone },
        destination: { wilayaCode: order.wilayaCode, wilaya: order.wilayaName, commune: order.commune, address: order.address, type: order.deliveryType },
        amountToCollect: order.totalCents / 100,
        currency: "DZD",
        items: order.items.map((item) => ({ sku: String(item.productId), name: item.name, size: item.size, color: item.color, quantity: item.quantity })),
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(String(payload.message || payload.error || `Erreur transporteur ${response.status}`));
    const externalId = String(payload.id || payload.trackingId || payload.tracking_number || payload.reference || "").slice(0, 160) || null;
    updateDeliverySync(order.id, { status: "sent", externalId });
  } catch (error) {
    updateDeliverySync(order.id, { status: "failed", error: error instanceof Error ? error.message.slice(0, 500) : "Erreur inconnue" });
  }
}
