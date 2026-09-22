export const CHECKOUT_DRAFT_KEY = "lovelystep_checkout_draft";
export const ABANDONED_REMINDER_DELAY_MINUTES = 45;

export function isValidCheckoutDraftToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{20,80}$/.test(value);
}

export function isLikelyAlgerianMobile(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  const local = digits.startsWith("213") ? digits.slice(3) : digits.startsWith("0") ? digits.slice(1) : digits;
  return /^[567]\d{8}$/.test(local);
}
