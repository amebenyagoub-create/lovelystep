export type WhatsAppOrderIntent = "confirm" | "cancel" | "unknown";
export type WhatsAppLanguage = "fr" | "en" | "ar";
export type WhatsAppOrderAction =
  | "start"
  | "confirm"
  | "reject"
  | "cancel"
  | "reason_price"
  | "reason_size"
  | "reason_color"
  | "reason_delivery"
  | "reason_later"
  | "reason_duplicate"
  | "reason_changed_mind";

const ORDER_NUMBER_PATTERN = /\bLS-\d{6}-[A-F0-9]{8}\b/i;

function latinText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractOrderNumber(value: string): string | null {
  return value.match(ORDER_NUMBER_PATTERN)?.[0].toUpperCase() ?? null;
}

export function normalizeWhatsAppPhone(value: string): string | null {
  const digits = value.replace(/\D/g, "").replace(/^00/, "");
  const local = digits.startsWith("213") ? digits.slice(3) : digits.startsWith("0") ? digits.slice(1) : digits;
  return /^[567]\d{8}$/.test(local) ? `+213${local}` : null;
}

export function detectWhatsAppLanguage(value: string): WhatsAppLanguage {
  if (/[\u0600-\u06ff]/.test(value)) return "ar";
  const normalized = latinText(value);
  if (/\b(confirm|cancel|order|yes|no|please)\b/.test(normalized)) return "en";
  return "fr";
}

export function classifyOrderIntent(value: string): WhatsAppOrderIntent {
  const normalized = latinText(value);
  const compactArabic = value.replace(/[\s\u064b-\u065f]/g, "");

  // Cancellation is checked first so phrases such as "ne confirmez pas" cannot
  // accidentally confirm an order.
  if (
    /\b(annul(?:e|er|ez|ation)?|cancel(?:led|er)?|refus(?:e|er)?|non|no|stop|ma\s+nhebch|manhebch)\b/.test(normalized)
    || /(إلغاء|الغاء|ألغي|الغي|لااريد|مانحبش|لا)/.test(compactArabic)
  ) return "cancel";

  if (
    /\b(confirm(?:e|er|ez|ed|ation)?|oui|yes|ok|okay|d\s+accord|nconfirmi|sah)\b/.test(normalized)
    || /(تأكيد|اكد|أكد|نعم|موافق|نأكد)/.test(compactArabic)
  ) return "confirm";

  return "unknown";
}

export function parseWhatsAppOrderAction(value: string): { action: WhatsAppOrderAction; orderNumber: string | null } {
  const orderNumber = extractOrderNumber(value);
  const normalized = value.trim().toLowerCase();
  const buttonActions: Array<[string, WhatsAppOrderAction]> = [
    ["reason_changed_mind:", "reason_changed_mind"],
    ["reason_duplicate:", "reason_duplicate"],
    ["reason_delivery:", "reason_delivery"],
    ["reason_later:", "reason_later"],
    ["reason_color:", "reason_color"],
    ["reason_price:", "reason_price"],
    ["reason_size:", "reason_size"],
    ["confirm_order:", "confirm"],
    ["reject_order:", "reject"],
    ["cancel_order:", "cancel"],
    ["start_order:", "start"],
  ];
  const buttonAction = buttonActions.find(([prefix]) => normalized.includes(prefix));
  if (buttonAction) return { action: buttonAction[1], orderNumber };

  const intent = classifyOrderIntent(value);
  return { action: intent === "confirm" ? "confirm" : intent === "cancel" ? "cancel" : "start", orderNumber };
}
