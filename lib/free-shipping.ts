export const DEFAULT_FREE_SHIPPING_THRESHOLD_CENTS = 1_200_000;

export function parseFreeShippingThresholdDzd(value: string | undefined) {
  if (!value?.trim()) return DEFAULT_FREE_SHIPPING_THRESHOLD_CENTS;
  const amountDzd = Number(value);
  if (!Number.isFinite(amountDzd) || amountDzd <= 0 || amountDzd > Number.MAX_SAFE_INTEGER / 100) {
    return DEFAULT_FREE_SHIPPING_THRESHOLD_CENTS;
  }
  return Math.round(amountDzd * 100);
}

export function hasFreeShipping(subtotalCents: number, thresholdCents: number) {
  return Number.isFinite(subtotalCents)
    && Number.isFinite(thresholdCents)
    && thresholdCents > 0
    && subtotalCents >= thresholdCents;
}

export function shippingAfterPromotion(subtotalCents: number, regularShippingCents: number, thresholdCents: number) {
  if (hasFreeShipping(subtotalCents, thresholdCents)) return 0;
  return Number.isFinite(regularShippingCents) && regularShippingCents > 0 ? Math.round(regularShippingCents) : 0;
}
