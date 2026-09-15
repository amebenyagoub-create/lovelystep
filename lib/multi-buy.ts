export const MULTI_BUY_MIN_PRODUCTS = 2;
export const MULTI_BUY_DISCOUNT_PERCENT = 5;

type PriceableItem = {
  productId: number;
  quantity: number;
  unitPriceCents: number;
};

function discountedUnitPriceCents(unitPriceCents: number) {
  return Math.round(unitPriceCents * (100 - MULTI_BUY_DISCOUNT_PERCENT) / 100);
}

export function priceMultiBuyItems<T extends PriceableItem>(items: readonly T[]): T[] {
  const qualifies = new Set(items.filter((item) => item.quantity > 0).map((item) => item.productId)).size >= MULTI_BUY_MIN_PRODUCTS;

  return items.map((item) => ({
    ...item,
    unitPriceCents: qualifies ? discountedUnitPriceCents(item.unitPriceCents) : item.unitPriceCents,
  }));
}

export function multiBuySubtotal(items: readonly PriceableItem[]) {
  return priceMultiBuyItems(items).reduce((total, item) => total + item.unitPriceCents * item.quantity, 0);
}
