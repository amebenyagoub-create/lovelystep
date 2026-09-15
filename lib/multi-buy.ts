export const MULTI_BUY_MIN_PRODUCTS = 2;
export const MULTI_BUY_PRICE_CENTS = 1_250_000;

type PriceableItem = {
  productId: number;
  quantity: number;
  unitPriceCents: number;
};

export function priceMultiBuyItems<T extends PriceableItem>(items: readonly T[]): T[] {
  const positiveItems = items.filter((item) => item.quantity > 0);
  const regularTotal = positiveItems.reduce((total, item) => total + item.unitPriceCents * item.quantity, 0);
  const qualifies = positiveItems.reduce((total, item) => total + item.quantity, 0) === MULTI_BUY_MIN_PRODUCTS
    && new Set(positiveItems.map((item) => item.productId)).size === MULTI_BUY_MIN_PRODUCTS
    && regularTotal > MULTI_BUY_PRICE_CENTS;

  if (!qualifies) return items.map((item) => ({ ...item }));

  const firstPrice = Math.round(MULTI_BUY_PRICE_CENTS * positiveItems[0].unitPriceCents / regularTotal);

  return items.map((item) => ({
    ...item,
    unitPriceCents: item === positiveItems[0] ? firstPrice : item === positiveItems[1] ? MULTI_BUY_PRICE_CENTS - firstPrice : item.unitPriceCents,
  }));
}

export function multiBuySubtotal(items: readonly PriceableItem[]) {
  return priceMultiBuyItems(items).reduce((total, item) => total + item.unitPriceCents * item.quantity, 0);
}
