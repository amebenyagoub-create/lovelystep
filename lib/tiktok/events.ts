import type { MetaCustomData } from "../meta/events";

const clean = <T extends Record<string, unknown>>(value: T): Partial<T> => Object.fromEntries(
  Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""),
) as Partial<T>;

export function tiktokProperties(data: MetaCustomData = {}): Record<string, unknown> {
  return clean({
    contents: data.contents?.map((item) => clean({ content_id: item.id, quantity: item.quantity, price: item.item_price })),
    content_ids: data.content_ids,
    content_type: data.content_type,
    description: data.content_name,
    value: data.value,
    currency: data.currency,
    quantity: data.num_items,
    order_id: data.order_id,
  });
}

