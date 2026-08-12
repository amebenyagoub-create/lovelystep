import "server-only";

import { whatsappConfig } from "./config";

type WhatsAppButton = { id: string; title: string };
type WhatsAppListRow = { id: string; title: string; description?: string };

async function sendWhatsAppPayload(to: string, payload: Record<string, unknown>, replyToMessageId?: string): Promise<string> {
  const config = whatsappConfig();
  if (!config.accessToken || !config.phoneNumberId || !/^v\d+\.\d+$/.test(config.graphApiVersion)) {
    throw new Error("WHATSAPP_MESSAGING_NOT_CONFIGURED");
  }

  const response = await fetch(`https://graph.facebook.com/${config.graphApiVersion}/${config.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to.replace(/\D/g, ""),
      ...(replyToMessageId ? { context: { message_id: replyToMessageId } } : {}),
      ...payload,
    }),
    cache: "no-store",
  });

  const responseBody = await response.json().catch(() => ({})) as { messages?: Array<{ id?: string }> };
  if (!response.ok) throw new Error(`WHATSAPP_SEND_FAILED_${response.status}`);
  return String(responseBody.messages?.[0]?.id ?? "");
}

export function sendWhatsAppText(to: string, body: string, replyToMessageId?: string): Promise<string> {
  return sendWhatsAppPayload(to, { type: "text", text: { preview_url: false, body: body.slice(0, 4096) } }, replyToMessageId);
}

export function sendWhatsAppButtons(input: { to: string; body: string; buttons: WhatsAppButton[]; imageUrl?: string | null; footer?: string; replyToMessageId?: string }): Promise<string> {
  if (input.buttons.length < 1 || input.buttons.length > 3) throw new Error("WHATSAPP_BUTTON_COUNT_INVALID");
  return sendWhatsAppPayload(input.to, {
    type: "interactive",
    interactive: {
      type: "button",
      ...(input.imageUrl ? { header: { type: "image", image: { link: input.imageUrl } } } : {}),
      body: { text: input.body.slice(0, 1024) },
      ...(input.footer ? { footer: { text: input.footer.slice(0, 60) } } : {}),
      action: { buttons: input.buttons.map((button) => ({ type: "reply", reply: { id: button.id.slice(0, 256), title: button.title.slice(0, 20) } })) },
    },
  }, input.replyToMessageId);
}

export function sendWhatsAppList(input: { to: string; body: string; buttonLabel: string; rows: WhatsAppListRow[]; footer?: string; replyToMessageId?: string }): Promise<string> {
  if (input.rows.length < 1 || input.rows.length > 10) throw new Error("WHATSAPP_LIST_COUNT_INVALID");
  return sendWhatsAppPayload(input.to, {
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: input.body.slice(0, 1024) },
      ...(input.footer ? { footer: { text: input.footer.slice(0, 60) } } : {}),
      action: {
        button: input.buttonLabel.slice(0, 20),
        sections: [{ title: "Motif", rows: input.rows.map((row) => ({ id: row.id.slice(0, 200), title: row.title.slice(0, 24), ...(row.description ? { description: row.description.slice(0, 72) } : {}) })) }],
      },
    },
  }, input.replyToMessageId);
}
