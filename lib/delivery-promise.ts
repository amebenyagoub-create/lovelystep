import type { StoreLocale } from "./use-locale";

/**
 * The two promises a shopper looks for immediately above the buy button: how
 * long delivery takes, and how long they have to exchange a size.
 *
 * Both are deliberately EMPTY. They are commercial commitments, and a wrong
 * number here is worse than no number: it is printed next to the price, the
 * customer holds you to it, and the courier does not. Fill in the real values
 * once — this file is the only place they live — and the lines appear on every
 * product page in all three languages. While empty, the generic reassurance
 * text is shown instead.
 *
 * Example, when you are ready:
 *   delay:    { fr: "Livraison en 2 à 5 jours ouvrables", en: "Delivered in 2-5 working days", ar: "التوصيل خلال 2 إلى 5 أيام عمل" }
 *   exchange: { fr: "Échange de taille sous 7 jours", en: "Size exchange within 7 days", ar: "استبدال المقاس خلال 7 أيام" }
 */
export const DELIVERY_PROMISE: { delay: Record<StoreLocale, string>; exchange: Record<StoreLocale, string> } = {
  delay: { fr: "", en: "", ar: "" },
  exchange: { fr: "", en: "", ar: "" },
};

export function deliveryPromise(locale: StoreLocale): { delay: string; exchange: string } {
  return { delay: DELIVERY_PROMISE.delay[locale].trim(), exchange: DELIVERY_PROMISE.exchange[locale].trim() };
}
