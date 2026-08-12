import type { WhatsAppLanguage } from "./intent";

const confirmationCopy: Record<WhatsAppLanguage, (orderNumber: string) => string> = {
  fr: (orderNumber) => `DÉMARRER CONFIRMATION ${orderNumber}`,
  en: (orderNumber) => `START CONFIRMATION ${orderNumber}`,
  ar: (orderNumber) => `بدء تأكيد الطلب ${orderNumber}`,
};

export function buildWhatsAppConfirmationUrl(businessNumber: string, orderNumber: string, language: WhatsAppLanguage): string | null {
  const digits = businessNumber.replace(/\D/g, "").replace(/^00/, "");
  if (!/^\d{8,15}$/.test(digits)) return null;
  const query = new URLSearchParams({ text: confirmationCopy[language](orderNumber) });
  return `https://wa.me/${digits}?${query.toString()}`;
}
