import type { Order, OrderStatus } from "./types";

export type AdminOrderStatusFilter = OrderStatus | "all";

type SearchableOrder = Pick<Order,
  "status" | "orderNumber" | "customerName" | "firstName" | "lastName" | "phone" |
  "city" | "wilayaName" | "commune" | "deliveryHubName" | "deliveryTracking" | "deliveryExternalId"
> & { items: Pick<Order["items"][number], "name" | "size" | "color">[] };

const searchable = (value: unknown) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("fr")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

export function filterAdminOrders<T extends SearchableOrder>(orders: T[], status: AdminOrderStatusFilter, search: string): T[] {
  const query = searchable(search);
  const compactQuery = query.replaceAll(" ", "");
  return orders.filter((order) => {
    if (status !== "all" && order.status !== status) return false;
    if (!query) return true;
    const text = searchable([
      order.orderNumber, order.customerName, order.firstName, order.lastName, order.phone,
      order.city, order.wilayaName, order.commune, order.deliveryHubName,
      order.deliveryTracking, order.deliveryExternalId,
      ...order.items.flatMap((item) => [item.name, item.size, item.color]),
    ].join(" "));
    return text.includes(query) || text.replaceAll(" ", "").includes(compactQuery);
  });
}
