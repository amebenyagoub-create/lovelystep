export const MULTI_BUY_MIN_QUANTITY = 2;
export const MULTI_BUY_DISCOUNT_PERCENT = 5;

type PriceableItem = {
  productId: number;
  quantity: number;
  unitPriceCents: number;
};

export function multiBuyUnitPriceCents(unitPriceCents: number, productQuantity: number) {
  if (productQuantity < MULTI_BUY_MIN_QUANTITY) return unitPriceCents;
  return Math.round(unitPriceCents * (100 - MULTI_BUY_DISCOUNT_PERCENT) / 100);
}

export function priceMultiBuyItems<T extends PriceableItem>(items: readonly T[]): T[] {
  const quantities = new Map<number, number>();
  for (const item of items) quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);

  return items.map((item) => ({
    ...item,
    unitPriceCents: multiBuyUnitPriceCents(item.unitPriceCents, quantities.get(item.productId) ?? item.quantity),
  }));
}

export function multiBuySubtotal(items: readonly PriceableItem[]) {
  return priceMultiBuyItems(items).reduce((total, item) => total + item.unitPriceCents * item.quantity, 0);
}

export function multiBuyProductTotal(unitPriceCents: number, quantity: number) {
  return multiBuyUnitPriceCents(unitPriceCents, quantity) * quantity;
}
