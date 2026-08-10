export type CartItem = {
  productId: number;
  slug: string;
  name: string;
  image: string;
  size: string;
  sizeLabel?: string;
  color?: string;
  quantity: number;
  unitPriceCents: number;
};

export function parseStoredCart(raw: string | null): CartItem[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const productId = Number(row.productId);
      const quantity = Number(row.quantity);
      const unitPriceCents = Number(row.unitPriceCents);
      const slug = String(row.slug ?? "").slice(0, 80);
      const name = String(row.name ?? "").slice(0, 140);
      const image = String(row.image ?? "").slice(0, 300);
      const size = String(row.size ?? "").slice(0, 60);
      const sizeLabel = String(row.sizeLabel ?? "").slice(0, 60) || undefined;
      const color = String(row.color ?? "").slice(0, 80) || undefined;
      if (!Number.isInteger(productId) || productId < 1 || !Number.isInteger(quantity) || quantity < 1 || quantity > 10 || !Number.isInteger(unitPriceCents) || unitPriceCents < 0 || !slug || !name || !size || !image.startsWith("/")) return [];
      return [{ productId, slug, name, image, size, sizeLabel, color, quantity, unitPriceCents }];
    }).slice(0, 50);
  } catch {
    return [];
  }
}
