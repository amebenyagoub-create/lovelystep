import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    reference: text("reference").notNull().unique(),
    customerName: text("customer_name").notNull(),
    phone: text("phone").notNull(),
    address: text("address").notNull(),
    city: text("city").notNull(),
    postalCode: text("postal_code").notNull().default(""),
    notes: text("notes").notNull().default(""),
    itemsJson: text("items_json").notNull(),
    itemCount: integer("item_count").notNull(),
    subtotalCents: integer("subtotal_cents").notNull(),
    deliveryCents: integer("delivery_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    status: text("status").notNull().default("pending_confirmation"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_orders_status_created_at").on(table.status, table.createdAt),
    index("idx_orders_phone_created_at").on(table.phone, table.createdAt),
  ],
);
