import type { PublicProduct } from "./types";

type StockProduct = Pick<PublicProduct, "sizes" | "variants">;

export function totalProductStock(product: StockProduct): number {
  const stockEntries = product.variants.length ? product.variants : product.sizes;
  return stockEntries.reduce(
    (total, entry) => total + Math.max(0, Math.floor(Number(entry.stock) || 0)),
    0,
  );
}

export function isProductOutOfStock(product: StockProduct): boolean {
  return totalProductStock(product) === 0;
}
