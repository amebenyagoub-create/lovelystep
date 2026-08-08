import { env } from "cloudflare:workers";
import { PRODUCT_BY_ID } from "../../../lib/products";

type OrderPayload = {
  customer?: {
    name?: unknown;
    phone?: unknown;
    address?: unknown;
    city?: unknown;
    postalCode?: unknown;
    notes?: unknown;
  };
  website?: unknown;
  items?: Array<{
    productId?: unknown;
    size?: unknown;
    quantity?: unknown;
  }>;
};

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function makeReference() {
  const date = new Date();
  const stamp = `${String(date.getUTCFullYear()).slice(-2)}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
  return `LS-${stamp}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as OrderPayload;

    if (clean(payload.website, 200)) {
      return Response.json({ error: "Unable to place this order." }, { status: 400 });
    }

    const name = clean(payload.customer?.name, 80);
    const phone = clean(payload.customer?.phone, 24);
    const address = clean(payload.customer?.address, 140);
    const city = clean(payload.customer?.city, 80);
    const postalCode = clean(payload.customer?.postalCode, 16);
    const notes = clean(payload.customer?.notes, 300);

    if (!name || !address || !city || phone.replace(/\D/g, "").length < 7) {
      return Response.json(
        { error: "Please provide a valid name, phone number and delivery address." },
        { status: 400 },
      );
    }

    if (!Array.isArray(payload.items) || payload.items.length === 0 || payload.items.length > 20) {
      return Response.json({ error: "Your bag is empty or too large." }, { status: 400 });
    }

    const items = [] as Array<{
      productId: string;
      name: string;
      size: string;
      quantity: number;
      unitPriceCents: number;
      lineTotalCents: number;
    }>;

    for (const rawItem of payload.items) {
      const productId = clean(rawItem.productId, 64);
      const size = clean(rawItem.size, 24);
      const quantity =
        typeof rawItem.quantity === "number" && Number.isInteger(rawItem.quantity)
          ? rawItem.quantity
          : 0;
      const product = PRODUCT_BY_ID.get(productId);

      if (!product || !product.sizes.includes(size) || quantity < 1 || quantity > 10) {
        return Response.json(
          { error: "One of the items in your bag is no longer available." },
          { status: 400 },
        );
      }

      const unitPriceCents = Math.round(product.price * 100);
      items.push({
        productId,
        name: product.name,
        size,
        quantity,
        unitPriceCents,
        lineTotalCents: unitPriceCents * quantity,
      });
    }

    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
    const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
    const deliveryCents = subtotalCents >= 6000 ? 0 : 490;
    const totalCents = subtotalCents + deliveryCents;
    const id = crypto.randomUUID();
    const reference = makeReference();

    if (!env.DB) {
      throw new Error("Order storage is unavailable.");
    }

    await env.DB.prepare(
      `INSERT INTO orders (
        id, reference, customer_name, phone, address, city, postal_code, notes,
        items_json, item_count, subtotal_cents, delivery_cents, total_cents, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        reference,
        name,
        phone,
        address,
        city,
        postalCode,
        notes,
        JSON.stringify(items),
        itemCount,
        subtotalCents,
        deliveryCents,
        totalCents,
        "pending_confirmation",
      )
      .run();

    return Response.json(
      { reference, totalCents, estimatedDelivery: "3–5 business days" },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    const publicMessage = message.includes("no such table")
      ? "Orders are temporarily unavailable. Please try again shortly."
      : "We couldn’t place your order. Please try again.";
    return Response.json({ error: publicMessage }, { status: 500 });
  }
}
