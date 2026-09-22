import "server-only";

import { claimAbandonedCheckoutsForReminder, finishAbandonedCheckoutReminder, purgeExpiredAbandonedCheckouts } from "./db-postgres";
import { errorMessage } from "./log";
import type { AbandonedCheckout } from "./types";

type ReminderConfig = { phoneNumberId: string; accessToken: string; template: string; language: string; apiVersion: string };

function reminderConfig(): ReminderConfig | null {
  const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID ?? "").trim();
  const accessToken = (process.env.WHATSAPP_ACCESS_TOKEN ?? "").trim();
  const template = (process.env.WHATSAPP_ABANDONED_CART_TEMPLATE ?? "").trim();
  if (!phoneNumberId || !accessToken || !template) return null;
  const requestedVersion = (process.env.WHATSAPP_GRAPH_API_VERSION ?? "v26.0").trim();
  return {
    phoneNumberId,
    accessToken,
    template,
    language: (process.env.WHATSAPP_ABANDONED_CART_TEMPLATE_LANG ?? "fr").trim() || "fr",
    apiVersion: /^v\d+\.\d+$/.test(requestedVersion) ? requestedVersion : "v26.0",
  };
}

export function abandonedCartReminderConfigured(): boolean {
  return reminderConfig() !== null;
}

function productSummary(draft: AbandonedCheckout): string {
  return draft.items.map((item) => {
    const options = [item.size, item.color].filter(Boolean).join(" / ");
    return `${item.quantity}× ${item.name}${options ? ` (${options})` : ""}`;
  }).join(", ").slice(0, 180);
}

async function sendReminder(draft: AbandonedCheckout, config: ReminderConfig): Promise<void> {
  const response = await fetch(`https://graph.facebook.com/${config.apiVersion}/${encodeURIComponent(config.phoneNumberId)}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: draft.phone.replace(/^\+/, ""),
      type: "template",
      template: {
        name: config.template,
        language: { code: config.language },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: draft.customerName || "client" },
            { type: "text", text: productSummary(draft) },
            { type: "text", text: String(Math.round(draft.subtotalCents / 100)) },
          ],
        }],
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.ok) return;
  const payload = await response.json().catch(() => null) as { error?: { message?: string; code?: number } } | null;
  const detail = payload?.error?.message || `HTTP ${response.status}`;
  throw new Error(`WhatsApp ${payload?.error?.code ? `${payload.error.code}: ` : ""}${detail}`);
}

/** Called by the existing Railway cron. Each claimed cart gets exactly one send attempt. */
export async function processAbandonedCheckoutReminders(limit = 25): Promise<{ configured: boolean; claimed: number; sent: number; failed: number }> {
  await purgeExpiredAbandonedCheckouts();
  const config = reminderConfig();
  if (!config) return { configured: false, claimed: 0, sent: 0, failed: 0 };
  const drafts = await claimAbandonedCheckoutsForReminder(limit);
  let sent = 0;
  let failed = 0;
  for (const draft of drafts) {
    try {
      await sendReminder(draft, config);
      await finishAbandonedCheckoutReminder(draft.id, true);
      sent += 1;
    } catch (error) {
      await finishAbandonedCheckoutReminder(draft.id, false, errorMessage(error, "Échec WhatsApp"));
      failed += 1;
    }
  }
  return { configured: true, claimed: drafts.length, sent, failed };
}
