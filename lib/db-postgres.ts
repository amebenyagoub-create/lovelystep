import "server-only";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { algeriaWilayas } from "./algeria";
import type { Customer, DeliveryIntegration, DeliveryRate, DeliveryType, Expense, ExpenseAllocationMethod, ExpenseCostType, ExpenseRecurrence, ImportJob, Order, OrderAttribution, OrderDeliveryCost, OrderItem, OrderRefund, OrderStatus, OrderStatusHistoryEntry, Product, ProductCost, ProductSize, ProductStatus, ProductTestimonial, ProductTranslation, ProductVariant, StoreSettings } from "./types";
import { normalizeWhatsAppPhone, type WhatsAppOrderAction } from "./whatsapp/intent";

type Row = QueryResultRow & Record<string, unknown>;
const connectionString = process.env.DATABASE_URL ?? "postgresql://invalid:invalid@127.0.0.1:1/invalid";

const globalPg = globalThis as typeof globalThis & { lovelyStepPool?: Pool; lovelyStepReady?: Promise<void> };
export const pool = globalPg.lovelyStepPool ?? new Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === "disable" ? false : { rejectUnauthorized: false },
  max: Number(process.env.DATABASE_POOL_SIZE ?? 5),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 12_000,
});
if (process.env.NODE_ENV !== "production") globalPg.lovelyStepPool = pool;

async function runMigrationOnce(name: string, fn: (client: PoolClient) => Promise<void>): Promise<void> {
  const applied = await pool.query("SELECT 1 FROM schema_migrations WHERE name=$1", [name]);
  if (applied.rows[0]) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await fn(client);
    await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function initialize(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL est obligatoire. Configurez la connexion PostgreSQL Supabase.");
  // A build must never migrate a database. `next build` prerenders routes, so any page that
  // reads the database would otherwise run the schema DDL and the backfill migrations against
  // whatever DATABASE_URL happens to be configured on the machine doing the build.
  // Set ALLOW_BUILD_TIME_MIGRATION=true only for a deliberate migration step.
  if (process.env.NEXT_PHASE === "phase-production-build" && process.env.ALLOW_BUILD_TIME_MIGRATION !== "true") {
    throw new Error("Accès base de données pendant le build : migration ignorée. Rendez la page dynamique ou définissez ALLOW_BUILD_TIME_MIGRATION=true.");
  }
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "postgres-schema.sql"), "utf8");
  await pool.query(schema);
  for (const wilaya of algeriaWilayas) {
    await pool.query(`INSERT INTO delivery_rates (wilaya_code,wilaya_name_fr,wilaya_name_ar)
      VALUES ($1,$2,$3) ON CONFLICT (wilaya_code) DO NOTHING`, [wilaya.code, wilaya.nameFr, wilaya.nameAr]);
  }
  await runMigrationOnce("2026-08-order-status-history-backfill", async (client) => {
    await client.query("INSERT INTO order_status_history (order_id,status,created_at) SELECT id,'new',created_at FROM orders");
    // audit_logs.entity_id is untyped text with no foreign key, so rows outlive their order: the EXISTS guard keeps the backfill from failing on deleted orders.
    await client.query(`INSERT INTO order_status_history (order_id,status,changed_by_admin_id,created_at)
      SELECT entity_id::bigint, details_json->>'status', admin_id, created_at FROM audit_logs
      WHERE action='order.status' AND entity_type='order' AND entity_id ~ '^[0-9]+$' AND details_json->>'status' IS NOT NULL
        AND EXISTS (SELECT 1 FROM orders o WHERE o.id = entity_id::bigint)
      ORDER BY created_at ASC`);
  });
}

export function ensureDatabase(): Promise<void> {
  globalPg.lovelyStepReady ??= initialize();
  return globalPg.lovelyStepReady;
}

async function rows<T extends Row = Row>(text: string, values: unknown[] = []): Promise<T[]> {
  await ensureDatabase();
  return (await pool.query<T>(text, values)).rows;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "object") return value as T;
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
function timestamp(value: unknown): string { return value instanceof Date ? value.toISOString() : String(value ?? ""); }

function mapProduct(row: Row): Product {
  return {
    id: Number(row.id), slug: String(row.slug), name: String(row.name), shortDescription: String(row.short_description ?? ""), description: String(row.description ?? ""),
    priceCents: Number(row.price_cents), costCents: Number(row.cost_cents ?? 0), compareAtCents: row.compare_at_cents == null ? null : Number(row.compare_at_cents),
    currency: String(row.currency ?? "DZD"), status: String(row.status) as ProductStatus, category: String(row.category), badge: row.badge == null ? null : String(row.badge),
    color: String(row.color ?? ""), colors: parseJson<string[]>(row.colors_json, []), materials: String(row.materials ?? ""), care: String(row.care ?? ""),
    sourceUrl: row.source_url == null ? null : String(row.source_url), images: parseJson<string[]>(row.images_json, []), colorImages: parseJson<Record<string, string>>(row.color_images_json, {}),
    sizes: parseJson<ProductSize[]>(row.sizes_json, []), variants: parseJson<ProductVariant[]>(row.variants_json, []), features: parseJson<string[]>(row.features_json, []),
    testimonials: parseJson<ProductTestimonial[]>(row.testimonials_json, []), translations: parseJson<{ en?: ProductTranslation; ar?: ProductTranslation }>(row.translations_json, {}),
    sizeGuideImage: row.size_guide_image == null ? null : String(row.size_guide_image), seoTitle: row.seo_title == null ? null : String(row.seo_title),
    seoDescription: row.seo_description == null ? null : String(row.seo_description), createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at),
  };
}

export async function listProducts(includeUnpublished = false): Promise<Product[]> {
  const result = await rows(includeUnpublished ? "SELECT * FROM products ORDER BY updated_at DESC" : "SELECT * FROM products WHERE status='published' ORDER BY updated_at DESC");
  return result.map(mapProduct);
}
export async function getProductBySlug(slug: string, includeUnpublished = false): Promise<Product | null> {
  const result = await rows("SELECT * FROM products WHERE slug=$1 AND ($2::boolean OR status='published') LIMIT 1", [slug, includeUnpublished]);
  return result[0] ? mapProduct(result[0]) : null;
}
export async function getProductById(id: number, client?: PoolClient): Promise<Product | null> {
  await ensureDatabase();
  const result = await (client ?? pool).query("SELECT * FROM products WHERE id=$1 LIMIT 1", [id]);
  return result.rows[0] ? mapProduct(result.rows[0]) : null;
}
export async function deleteProduct(id: number): Promise<Product | null> {
  const product = await getProductById(id);
  if (!product) return null;
  const reserved = await rows<{ items_json: unknown } & Row>("SELECT items_json FROM orders WHERE stock_reserved=TRUE");
  if (reserved.some((row) => parseJson<OrderItem[]>(row.items_json, []).some((item) => item.productId === id))) throw new Error("PRODUCT_HAS_RESERVED_ORDERS");
  await pool.query("DELETE FROM products WHERE id=$1", [id]);
  return product;
}

export async function saveProduct(input: Partial<Product> & Pick<Product, "name" | "slug" | "priceCents">): Promise<Product> {
  const current = input.id ? await getProductById(input.id) : null;
  if (input.id && !current) throw new Error("PRODUCT_NOT_FOUND");
  const values = [input.slug,input.name,input.shortDescription ?? current?.shortDescription ?? "",input.description ?? current?.description ?? "",input.priceCents,input.costCents ?? current?.costCents ?? 0,
    input.compareAtCents ?? null,input.currency ?? "DZD",input.status ?? current?.status ?? "draft",input.category ?? current?.category ?? "Ensembles",input.badge ?? null,input.color ?? current?.color ?? "",
    JSON.stringify(input.colors ?? current?.colors ?? []),input.materials ?? current?.materials ?? "",input.care ?? current?.care ?? "",input.sourceUrl ?? current?.sourceUrl ?? null,
    JSON.stringify(input.images ?? current?.images ?? []),JSON.stringify(input.colorImages ?? current?.colorImages ?? {}),JSON.stringify(input.sizes ?? current?.sizes ?? []),JSON.stringify(input.variants ?? current?.variants ?? []),
    JSON.stringify(input.features ?? current?.features ?? []),JSON.stringify(input.testimonials ?? current?.testimonials ?? []),JSON.stringify(input.translations ?? current?.translations ?? {}),
    input.sizeGuideImage ?? current?.sizeGuideImage ?? null,input.seoTitle ?? input.name,input.seoDescription ?? input.shortDescription ?? current?.seoDescription ?? ""];
  const columns = "slug,name,short_description,description,price_cents,cost_cents,compare_at_cents,currency,status,category,badge,color,colors_json,materials,care,source_url,images_json,color_images_json,sizes_json,variants_json,features_json,testimonials_json,translations_json,size_guide_image,seo_title,seo_description";
  const casts = values.map((_, index) => [12,16,17,18,19,20,21,22].includes(index) ? `$${index + 1}::jsonb` : `$${index + 1}`).join(",");
  let result;
  if (current) {
    const assignments = columns.split(",").map((column, index) => `${column}=${[12,16,17,18,19,20,21,22].includes(index) ? `$${index + 1}::jsonb` : `$${index + 1}`}`).join(",");
    result = await pool.query(`UPDATE products SET ${assignments},updated_at=NOW() WHERE id=$27 RETURNING *`, [...values, current.id]);
  } else {
    result = await pool.query(`INSERT INTO products (${columns}) VALUES (${casts}) RETURNING *`, values);
  }
  return mapProduct(result.rows[0]);
}
export async function updateProductSourceData(id: number, data: unknown): Promise<void> {
  await ensureDatabase();
  await pool.query("UPDATE products SET source_data_json=$1::jsonb,updated_at=NOW() WHERE id=$2", [JSON.stringify(data), id]);
}
export async function updateProductSizeGuide(id:number,image:string,images:string[]):Promise<void>{await ensureDatabase();await pool.query("UPDATE products SET size_guide_image=$1,images_json=$2::jsonb,updated_at=NOW() WHERE id=$3",[image,JSON.stringify(images),id]);}

function mapOrder(row: Row): Order {
  const customerName = String(row.customer_name); const nameParts = customerName.trim().split(/\s+/);
  return { id:Number(row.id),orderNumber:String(row.order_number),customerId:row.customer_id==null?null:Number(row.customer_id),firstName:String(row.first_name??"")||nameParts[0]||"",lastName:String(row.last_name??"")||nameParts.slice(1).join(" "),customerName,
    phone:String(row.phone),city:String(row.city),wilayaCode:String(row.wilaya_code??""),wilayaName:String(row.wilaya_name??row.city??""),commune:String(row.commune??row.city??""),address:String(row.address??""),
    deliveryType:(row.delivery_type==="office"?"office":"home") as DeliveryType,deliveryExternalId:row.delivery_external_id==null?null:String(row.delivery_external_id),deliverySyncStatus:String(row.delivery_sync_status??"not_configured") as Order["deliverySyncStatus"],
    deliverySyncError:row.delivery_sync_error==null?null:String(row.delivery_sync_error),notes:String(row.notes??""),status:String(row.status) as OrderStatus,items:parseJson<OrderItem[]>(row.items_json,[]),
    subtotalCents:Number(row.subtotal_cents),shippingCents:Number(row.shipping_cents),totalCents:Number(row.total_cents),statusHistory:[],refunds:[],deliveryCost:null,attribution:null,createdAt:timestamp(row.created_at),updatedAt:timestamp(row.updated_at) };
}
function mapAttribution(row: Row): OrderAttribution { return { orderId:Number(row.order_id),isMetaLastTouch:Boolean(row.is_meta_last_touch),isMetaFirstTouch:Boolean(row.is_meta_first_touch),
  utmSource:row.utm_source==null?null:String(row.utm_source),utmMedium:row.utm_medium==null?null:String(row.utm_medium),utmCampaign:row.utm_campaign==null?null:String(row.utm_campaign),
  utmContent:row.utm_content==null?null:String(row.utm_content),firstUtmCampaign:row.first_utm_campaign==null?null:String(row.first_utm_campaign),
  landingPage:row.landing_page==null?null:String(row.landing_page),referrer:row.referrer==null?null:String(row.referrer),
  firstTouchAt:timestamp(row.first_touch_at),lastTouchAt:timestamp(row.last_touch_at) }; }
function mapStatusHistory(row: Row): OrderStatusHistoryEntry { return { id:Number(row.id),orderId:Number(row.order_id),status:String(row.status) as OrderStatus,changedByAdminId:row.changed_by_admin_id==null?null:Number(row.changed_by_admin_id),reasonCode:row.reason_code==null?null:String(row.reason_code),note:row.note==null?null:String(row.note),createdAt:timestamp(row.created_at) }; }
function mapRefund(row: Row): OrderRefund { return { id:Number(row.id),orderId:Number(row.order_id),amountCents:Number(row.amount_cents),reason:String(row.reason??""),createdByAdminId:row.created_by_admin_id==null?null:Number(row.created_by_admin_id),createdAt:timestamp(row.created_at) }; }
function mapDeliveryCost(row: Row): OrderDeliveryCost { return { orderId:Number(row.order_id),carrierCostCents:Number(row.carrier_cost_cents),returnCostCents:Number(row.return_cost_cents),source:String(row.source??"manual"),updatedAt:timestamp(row.updated_at) }; }
async function enrichOrders(orders: Order[]): Promise<Order[]> {
  if (!orders.length) return orders;
  const ids = orders.map((order) => order.id);
  const [history, refunds, deliveryCosts, attributions] = await Promise.all([
    rows("SELECT * FROM order_status_history WHERE order_id = ANY($1::bigint[]) ORDER BY created_at ASC", [ids]),
    rows("SELECT * FROM order_refunds WHERE order_id = ANY($1::bigint[]) ORDER BY created_at ASC", [ids]),
    rows("SELECT * FROM order_delivery_costs WHERE order_id = ANY($1::bigint[])", [ids]),
    rows("SELECT * FROM meta_attribution WHERE order_id = ANY($1::bigint[])", [ids]),
  ]);
  const historyByOrder = new Map<number, OrderStatusHistoryEntry[]>();
  for (const row of history) { const entry = mapStatusHistory(row); const list = historyByOrder.get(entry.orderId) ?? []; list.push(entry); historyByOrder.set(entry.orderId, list); }
  const refundsByOrder = new Map<number, OrderRefund[]>();
  for (const row of refunds) { const entry = mapRefund(row); const list = refundsByOrder.get(entry.orderId) ?? []; list.push(entry); refundsByOrder.set(entry.orderId, list); }
  const deliveryCostByOrder = new Map(deliveryCosts.map((row) => { const entry = mapDeliveryCost(row); return [entry.orderId, entry] as const; }));
  const attributionByOrder = new Map(attributions.map((row) => { const entry = mapAttribution(row); return [entry.orderId, entry] as const; }));
  for (const order of orders) {
    order.statusHistory = historyByOrder.get(order.id) ?? [];
    order.refunds = refundsByOrder.get(order.id) ?? [];
    order.deliveryCost = deliveryCostByOrder.get(order.id) ?? null;
    order.attribution = attributionByOrder.get(order.id) ?? null;
  }
  return orders;
}
export async function listOrders(): Promise<Order[]> { return enrichOrders((await rows("SELECT * FROM orders ORDER BY created_at DESC LIMIT 250")).map(mapOrder)); }
export class StockUnavailableError extends Error { constructor(){ super("STOCK_UNAVAILABLE"); } }
function aggregateVariantSizes(variants: ProductVariant[]): ProductSize[] { const sizes=new Map<string,ProductSize>(); for(const variant of variants){const current=sizes.get(variant.size);const stock=Math.max(0,Math.floor(Number(variant.stock)||0));if(current)current.stock+=stock;else sizes.set(variant.size,{label:variant.size,stock,age:variant.age,weight:variant.weight,height:variant.height});} return [...sizes.values()]; }
async function changeStock(client: PoolClient, items: OrderItem[], direction: -1|1): Promise<void> {
  for(const item of items){const quantity=Number(item.quantity);if(!Number.isInteger(quantity)||quantity<1||quantity>10)throw new StockUnavailableError();const result=await client.query("SELECT * FROM products WHERE id=$1 FOR UPDATE",[item.productId]);const product=result.rows[0]?mapProduct(result.rows[0]):null;if(!product||(direction===-1&&product.status!=="published"))throw new StockUnavailableError();
    if(product.variants.length){let index=product.variants.findIndex((v)=>v.size===item.size&&v.color===(item.color??""));if(index<0&&direction===1){product.variants.push({color:item.color??"",size:item.size,stock:0});index=product.variants.length-1;}if(index<0)throw new StockUnavailableError();const stock=Math.max(0,Math.floor(Number(product.variants[index].stock)||0));if(direction===-1&&stock<quantity)throw new StockUnavailableError();product.variants[index]={...product.variants[index],stock:stock+direction*quantity};await client.query("UPDATE products SET variants_json=$1::jsonb,sizes_json=$2::jsonb,updated_at=NOW() WHERE id=$3",[JSON.stringify(product.variants),JSON.stringify(aggregateVariantSizes(product.variants)),product.id]);
    }else{let index=product.sizes.findIndex((s)=>s.label===item.size);if(index<0&&direction===1){product.sizes.push({label:item.size,stock:0});index=product.sizes.length-1;}if(index<0)throw new StockUnavailableError();const stock=Math.max(0,Math.floor(Number(product.sizes[index].stock)||0));if(direction===-1&&stock<quantity)throw new StockUnavailableError();product.sizes[index]={...product.sizes[index],stock:stock+direction*quantity};await client.query("UPDATE products SET sizes_json=$1::jsonb,updated_at=NOW() WHERE id=$2",[JSON.stringify(product.sizes),product.id]);}}
}
type CreateOrderInput={customerId:number|null;firstName:string;lastName:string;customerName:string;phone:string;city:string;wilayaCode:string;wilayaName:string;commune:string;address:string;deliveryType:DeliveryType;notes:string;items:OrderItem[];subtotalCents:number;shippingCents:number;totalCents:number};
export async function createOrder(input:CreateOrderInput):Promise<Order>{await ensureDatabase();const client=await pool.connect();try{await client.query("BEGIN");await changeStock(client,input.items,-1);const number=`LS-${new Date().toISOString().slice(2,10).replaceAll("-","")}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;const result=await client.query(`INSERT INTO orders (order_number,customer_id,first_name,last_name,customer_name,phone,city,wilaya_code,wilaya_name,commune,address,delivery_type,notes,status,items_json,subtotal_cents,shipping_cents,total_cents,stock_reserved) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'new',$14::jsonb,$15,$16,$17,TRUE) RETURNING *`,[number,input.customerId,input.firstName,input.lastName,input.customerName,input.phone,input.city,input.wilayaCode,input.wilayaName,input.commune,input.address,input.deliveryType,input.notes,JSON.stringify(input.items),input.subtotalCents,input.shippingCents,input.totalCents]);await client.query("COMMIT");return mapOrder(result.rows[0]);}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}
export async function updateDeliverySync(id:number,patch:{status:Order["deliverySyncStatus"];externalId?:string|null;error?:string|null}):Promise<void>{await ensureDatabase();await pool.query("UPDATE orders SET delivery_sync_status=$1,delivery_external_id=$2,delivery_sync_error=$3,updated_at=NOW() WHERE id=$4",[patch.status,patch.externalId??null,patch.error??null,id]);}
export type DeliveryDispatchClaim={status:"claimed";order:Order}|{status:"not_found"}|{status:"not_confirmed"}|{status:"pending"}|{status:"already_sent"};
export async function claimOrderForDelivery(id:number):Promise<DeliveryDispatchClaim>{await ensureDatabase();const claimed=await pool.query("UPDATE orders SET delivery_sync_status='pending',delivery_sync_error=NULL,updated_at=NOW() WHERE id=$1 AND status IN ('confirmed','preparing') AND delivery_external_id IS NULL AND delivery_sync_status IN ('not_configured','failed') RETURNING *",[id]);if(claimed.rows[0])return{status:"claimed",order:mapOrder(claimed.rows[0])};const existing=await rows("SELECT status,delivery_sync_status,delivery_external_id FROM orders WHERE id=$1",[id]);if(!existing[0])return{status:"not_found"};if(existing[0].delivery_external_id||existing[0].delivery_sync_status==="sent")return{status:"already_sent"};if(existing[0].delivery_sync_status==="pending")return{status:"pending"};return{status:"not_confirmed"};}
const releasing=new Set<OrderStatus>(["refused","returned","cancelled"]);
export async function updateOrderStatus(id:number,status:OrderStatus,adminId:number|null=null,reasonCode:string|null=null,note:string|null=null):Promise<"updated"|"not_found"|"stock_unavailable">{await ensureDatabase();const client=await pool.connect();try{await client.query("BEGIN");const result=await client.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE",[id]);if(!result.rows[0]){await client.query("ROLLBACK");return "not_found";}const order=mapOrder(result.rows[0]);const reserved=Boolean(result.rows[0].stock_reserved);const shouldReserve=!releasing.has(status);if(reserved&&!shouldReserve)await changeStock(client,order.items,1);if(!reserved&&shouldReserve)await changeStock(client,order.items,-1);await client.query("UPDATE orders SET status=$1,stock_reserved=$2,updated_at=NOW() WHERE id=$3",[status,shouldReserve,id]);if(order.status!==status)await client.query("INSERT INTO order_status_history (order_id,status,changed_by_admin_id,reason_code,note) VALUES ($1,$2,$3,$4,$5)",[id,status,adminId,reasonCode,note]);await client.query("COMMIT");return "updated";}catch(error){await client.query("ROLLBACK");if(error instanceof StockUnavailableError)return "stock_unavailable";throw error;}finally{client.release();}}

export type DeleteOrderResult = { status: "deleted"; order: Order } | { status: "not_found" } | { status: "delivery_in_progress" };
export async function deleteOrder(id: number): Promise<DeleteOrderResult> {
  await ensureDatabase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [id]);
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return { status: "not_found" };
    }
    const row = result.rows[0];
    const order = mapOrder(row);
    if (order.deliveryExternalId || order.deliverySyncStatus === "sent" || order.deliverySyncStatus === "pending") {
      await client.query("ROLLBACK");
      return { status: "delivery_in_progress" };
    }
    if (row.stock_reserved) await changeStock(client, order.items, 1);
    await client.query("DELETE FROM orders WHERE id=$1", [id]);
    await client.query("COMMIT");
    return { status: "deleted", order };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

type WhatsAppOrderResultStatus =
  | "present_confirmation"
  | "present_reasons"
  | "price_solution"
  | "needs_human"
  | "deferred"
  | "confirmed"
  | "cancelled"
  | "already_confirmed"
  | "already_cancelled"
  | "closed";

export type WhatsAppOrderActionResult =
  | { status: "duplicate" }
  | { status: "retry_later" }
  | { status: "order_not_found" | "phone_mismatch" | "ambiguous_order"; action: WhatsAppOrderAction }
  | { status: WhatsAppOrderResultStatus; action: WhatsAppOrderAction; order: Order };

type WhatsAppOrderActionInput = { messageId: string; senderPhone: string; orderNumber: string | null; action: WhatsAppOrderAction };

function whatsappResultWithOrder(status: string, action: WhatsAppOrderAction, row: Row): WhatsAppOrderActionResult {
  return { status: status as WhatsAppOrderResultStatus, action, order: mapOrder(row) };
}

export async function processWhatsAppOrderAction(input: WhatsAppOrderActionInput): Promise<WhatsAppOrderActionResult> {
  await ensureDatabase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(`INSERT INTO whatsapp_webhook_events
      (message_id,sender_phone,action,order_number,result,outbound_claimed_at)
      VALUES ($1,$2,$3,$4,'processing',NOW()) ON CONFLICT(message_id) DO NOTHING RETURNING message_id`,
    [input.messageId, input.senderPhone, input.action, input.orderNumber]);

    if (!inserted.rows[0]) {
      const claimed = await client.query(`UPDATE whatsapp_webhook_events SET outbound_claimed_at=NOW()
        WHERE message_id=$1 AND outbound_sent_at IS NULL
          AND (outbound_claimed_at IS NULL OR outbound_claimed_at < NOW()-INTERVAL '2 minutes')
        RETURNING *`, [input.messageId]);
      const event = claimed.rows[0];
      if (!event) {
        const existing = await client.query("SELECT outbound_sent_at FROM whatsapp_webhook_events WHERE message_id=$1", [input.messageId]);
        await client.query("COMMIT");
        return { status: existing.rows[0]?.outbound_sent_at ? "duplicate" : "retry_later" };
      }
      if (event.result === "processing") {
        await client.query("COMMIT");
        return { status: "retry_later" };
      }
      if (["order_not_found", "phone_mismatch", "ambiguous_order"].includes(String(event.result))) {
        await client.query("COMMIT");
        return { status: String(event.result) as "order_not_found" | "phone_mismatch" | "ambiguous_order", action: String(event.action) as WhatsAppOrderAction };
      }
      const existingOrder = await client.query("SELECT * FROM orders WHERE id=$1", [event.order_id]);
      await client.query("COMMIT");
      return existingOrder.rows[0]
        ? whatsappResultWithOrder(String(event.result), String(event.action) as WhatsAppOrderAction, existingOrder.rows[0])
        : { status: "order_not_found", action: String(event.action) as WhatsAppOrderAction };
    }

    const senderPhone = normalizeWhatsAppPhone(input.senderPhone);
    let orderRows: Row[] = [];
    if (senderPhone && input.orderNumber) {
      orderRows = (await client.query("SELECT * FROM orders WHERE UPPER(order_number)=UPPER($1) FOR UPDATE", [input.orderNumber])).rows;
    } else if (senderPhone) {
      orderRows = (await client.query(`SELECT * FROM orders WHERE phone=$1
        AND status IN ('new','to_confirm','confirmed') AND created_at>=NOW()-INTERVAL '14 days'
        ORDER BY created_at DESC LIMIT 2 FOR UPDATE`, [senderPhone])).rows;
    }

    let earlyStatus: "order_not_found" | "phone_mismatch" | "ambiguous_order" | null = null;
    if (!senderPhone || orderRows.length === 0) earlyStatus = "order_not_found";
    else if (!input.orderNumber && orderRows.length > 1) earlyStatus = "ambiguous_order";
    else if (normalizeWhatsAppPhone(String(orderRows[0].phone)) !== senderPhone) earlyStatus = "phone_mismatch";
    if (earlyStatus) {
      await client.query("UPDATE whatsapp_webhook_events SET result=$1 WHERE message_id=$2", [earlyStatus, input.messageId]);
      await client.query("COMMIT");
      return { status: earlyStatus, action: input.action };
    }

    const row = orderRows[0];
    const order = mapOrder(row);
    const cancelledStatuses: OrderStatus[] = ["cancelled", "refused", "returned"];
    const progressedStatuses: OrderStatus[] = ["confirmed", "preparing", "shipped", "delivered"];
    let result: WhatsAppOrderResultStatus;

    const transition = async (nextStatus: OrderStatus, reasonCode: string, note: string) => {
      if (order.status === nextStatus) return;
      if (nextStatus === "cancelled" && Boolean(row.stock_reserved)) await changeStock(client, order.items, 1);
      await client.query("UPDATE orders SET status=$1,stock_reserved=$2,updated_at=NOW() WHERE id=$3", [nextStatus, nextStatus === "cancelled" ? false : Boolean(row.stock_reserved), order.id]);
      await client.query("INSERT INTO order_status_history (order_id,status,reason_code,note) VALUES ($1,$2,$3,$4)", [order.id, nextStatus, reasonCode, note]);
    };

    if (input.action === "confirm") {
      if (cancelledStatuses.includes(order.status)) result = "closed";
      else if (progressedStatuses.includes(order.status)) result = "already_confirmed";
      else { await transition("confirmed", "whatsapp_customer_confirmed", "Confirmation gratuite initiée par le client sur WhatsApp"); result = "confirmed"; }
    } else if (input.action === "cancel" || input.action === "reason_changed_mind") {
      if (cancelledStatuses.includes(order.status)) result = "already_cancelled";
      else if (["preparing", "shipped", "delivered"].includes(order.status)) result = "closed";
      else { await transition("cancelled", "whatsapp_customer_cancelled", "Annulation demandée par le client sur WhatsApp"); result = "cancelled"; }
    } else if (input.action === "reject") {
      if (cancelledStatuses.includes(order.status)) result = "already_cancelled";
      else if (progressedStatuses.includes(order.status)) result = "already_confirmed";
      else { await transition("to_confirm", "whatsapp_rejected", "Le client demande une modification ou une annulation"); result = "present_reasons"; }
    } else if (input.action === "reason_price") {
      if (cancelledStatuses.includes(order.status)) result = "already_cancelled";
      else if (progressedStatuses.includes(order.status)) result = "already_confirmed";
      else { await transition("to_confirm", "whatsapp_reason_price", "Le client hésite à cause du prix"); result = "price_solution"; }
    } else if (input.action === "reason_later") {
      if (cancelledStatuses.includes(order.status)) result = "already_cancelled";
      else if (progressedStatuses.includes(order.status)) result = "already_confirmed";
      else { await transition("to_confirm", "whatsapp_reason_later", "Le client souhaite décider plus tard, sans rappel payant"); result = "deferred"; }
    } else if (["reason_size", "reason_color", "reason_delivery", "reason_duplicate"].includes(input.action)) {
      if (cancelledStatuses.includes(order.status)) result = "already_cancelled";
      else if (progressedStatuses.includes(order.status)) result = "already_confirmed";
      else { await transition("to_confirm", `whatsapp_${input.action}`, "Intervention humaine demandée depuis WhatsApp"); result = "needs_human"; }
    } else if (cancelledStatuses.includes(order.status)) result = "already_cancelled";
    else if (progressedStatuses.includes(order.status)) result = "already_confirmed";
    else result = "present_confirmation";

    const refreshed = await client.query("SELECT * FROM orders WHERE id=$1", [order.id]);
    await client.query(`UPDATE whatsapp_webhook_events SET order_id=$1,order_number=$2,result=$3 WHERE message_id=$4`, [order.id, order.orderNumber, result, input.messageId]);
    await client.query("COMMIT");
    return whatsappResultWithOrder(result, input.action, refreshed.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markWhatsAppEventSent(messageId: string, providerMessageId: string): Promise<void> {
  await ensureDatabase();
  await pool.query("UPDATE whatsapp_webhook_events SET outbound_sent_at=NOW(),provider_message_id=$1 WHERE message_id=$2", [providerMessageId || null, messageId]);
}

export async function releaseWhatsAppEventDelivery(messageId: string): Promise<void> {
  await ensureDatabase();
  await pool.query("UPDATE whatsapp_webhook_events SET outbound_claimed_at=NULL WHERE message_id=$1 AND outbound_sent_at IS NULL", [messageId]);
}

export async function allowOrderAttempt(ip:string):Promise<boolean>{await ensureDatabase();await pool.query("DELETE FROM order_attempts WHERE created_at < NOW()-INTERVAL '2 hours'");const result=await pool.query("SELECT count(*)::int count FROM order_attempts WHERE ip=$1 AND created_at>NOW()-INTERVAL '30 minutes'",[ip]);if(Number(result.rows[0].count)>=8)return false;await pool.query("INSERT INTO order_attempts (ip) VALUES ($1)",[ip]);return true;}
export async function createImportJob(sourceUrl:string):Promise<number>{await ensureDatabase();const result=await pool.query("INSERT INTO import_jobs (source_url,status) VALUES ($1,'queued') RETURNING id",[sourceUrl]);return Number(result.rows[0].id);}
export async function updateImportJob(id:number,patch:{status:ImportJob["status"];error?:string|null;extracted?:unknown;productId?:number|null}):Promise<void>{await ensureDatabase();await pool.query("UPDATE import_jobs SET status=$1,error=$2,extracted_json=$3::jsonb,product_id=$4,updated_at=NOW() WHERE id=$5",[patch.status,patch.error??null,patch.extracted==null?null:JSON.stringify(patch.extracted),patch.productId??null,id]);}
export async function listImportJobs():Promise<ImportJob[]>{return(await rows("SELECT * FROM import_jobs ORDER BY created_at DESC LIMIT 50")).map((row)=>({id:Number(row.id),sourceUrl:String(row.source_url),status:String(row.status) as ImportJob["status"],error:row.error==null?null:String(row.error),productId:row.product_id==null?null:Number(row.product_id),extracted:parseJson<Record<string,unknown>|null>(row.extracted_json,null),createdAt:timestamp(row.created_at),updatedAt:timestamp(row.updated_at)}));}

export const DEFAULT_STORE_SETTINGS:StoreSettings={announcement:{fr:"Paiement à la livraison · Confirmation par téléphone · Échange facile",en:"Cash on delivery · Phone confirmation · Easy exchange",ar:"الدفع عند الاستلام · تأكيد هاتفي · استبدال سهل"},heroEyebrow:{fr:"Nouvelle collection · 1 à 10 ans",en:"New collection · Ages 1–10",ar:"تشكيلة جديدة · من سنة إلى 10 سنوات"},heroTitle:{fr:"Des tenues faites pour leurs",en:"Outfits made for their",ar:"ملابس صُممت من أجل"},heroAccent:{fr:"plus beaux pas.",en:"loveliest steps.",ar:"أجمل خطواتهم."},heroDescription:{fr:"Douces, pratiques et pleines de charme. Commandez simplement et payez seulement à la livraison.",en:"Soft, practical and full of charm. Order simply and pay only when it arrives.",ar:"ناعمة وعملية ومليئة بالجمال. اطلبوا بسهولة وادفعوا فقط عند الاستلام."},primaryCta:{fr:"Découvrir la collection",en:"Shop the collection",ar:"اكتشفوا التشكيلة"},storyTitle:{fr:"Leur confort d’abord. Votre sérénité aussi.",en:"Their comfort first. Your peace of mind too.",ar:"راحتهم أولاً، وراحة بالك أيضاً."},storyDescription:{fr:"Lovely Step choisit des vêtements agréables à porter, faciles à commander et présentés avec toutes les informations utiles pour choisir la bonne taille.",en:"Lovely Step selects comfortable clothes that are easy to order, with clear information to help you choose the right size.",ar:"تختار Lovely Step ملابس مريحة وسهلة الطلب مع كل المعلومات اللازمة لاختيار المقاس المناسب."},heroImage:null,theme:{navy:"#1E416A",coral:"#EE5549",cream:"#FAEEE1",sand:"#DAAE8C",background:"#FFF9F2"}};
function mergeSettings(value:Partial<StoreSettings>|null):StoreSettings{if(!value)return DEFAULT_STORE_SETTINGS;const localized=(key:keyof Pick<StoreSettings,"announcement"|"heroEyebrow"|"heroTitle"|"heroAccent"|"heroDescription"|"primaryCta"|"storyTitle"|"storyDescription">)=>({...DEFAULT_STORE_SETTINGS[key],...(value[key]??{})});return{announcement:localized("announcement"),heroEyebrow:localized("heroEyebrow"),heroTitle:localized("heroTitle"),heroAccent:localized("heroAccent"),heroDescription:localized("heroDescription"),primaryCta:localized("primaryCta"),storyTitle:localized("storyTitle"),storyDescription:localized("storyDescription"),heroImage:value.heroImage??null,theme:{...DEFAULT_STORE_SETTINGS.theme,...(value.theme??{})}};}
export async function getStoreSettings():Promise<StoreSettings>{const result=await rows("SELECT value_json FROM app_settings WHERE setting_key='storefront'");return mergeSettings(result[0]?parseJson<Partial<StoreSettings>>(result[0].value_json,{}):null);}
export async function saveStoreSettings(settings:StoreSettings):Promise<StoreSettings>{await ensureDatabase();await pool.query("INSERT INTO app_settings (setting_key,value_json) VALUES ('storefront',$1::jsonb) ON CONFLICT(setting_key) DO UPDATE SET value_json=EXCLUDED.value_json,updated_at=NOW()",[JSON.stringify(settings)]);return getStoreSettings();}
export async function listDeliveryRates():Promise<DeliveryRate[]>{return(await rows("SELECT * FROM delivery_rates ORDER BY wilaya_code::integer")).map((row)=>({wilayaCode:String(row.wilaya_code),wilayaNameFr:String(row.wilaya_name_fr),wilayaNameAr:String(row.wilaya_name_ar??""),homeCents:Number(row.home_cents),officeCents:Number(row.office_cents),active:Boolean(row.active)}));}
export async function getDeliveryRate(code:string):Promise<DeliveryRate|null>{const result=await rows("SELECT * FROM delivery_rates WHERE wilaya_code=$1",[code.padStart(2,"0")]);const row=result[0];return row?{wilayaCode:String(row.wilaya_code),wilayaNameFr:String(row.wilaya_name_fr),wilayaNameAr:String(row.wilaya_name_ar??""),homeCents:Number(row.home_cents),officeCents:Number(row.office_cents),active:Boolean(row.active)}:null;}
export async function saveDeliveryRates(rates:DeliveryRate[]):Promise<DeliveryRate[]>{await ensureDatabase();const client=await pool.connect();try{await client.query("BEGIN");for(const rate of rates)await client.query("UPDATE delivery_rates SET home_cents=$1,office_cents=$2,active=$3,updated_at=NOW() WHERE wilaya_code=$4",[rate.homeCents,rate.officeCents,rate.active,rate.wilayaCode]);await client.query("COMMIT");}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}return listDeliveryRates();}
export const DEFAULT_DELIVERY_INTEGRATION:DeliveryIntegration={enabled:false,providerName:"",baseUrl:"",createShipmentPath:"/shipments",apiTokenEnv:"DELIVERY_API_TOKEN"};
export async function getDeliveryIntegration():Promise<DeliveryIntegration>{const result=await rows("SELECT value_json FROM app_settings WHERE setting_key='delivery_integration'");return{...DEFAULT_DELIVERY_INTEGRATION,...(result[0]?parseJson<Partial<DeliveryIntegration>>(result[0].value_json,{}):{})};}
export async function saveDeliveryIntegration(value:DeliveryIntegration):Promise<DeliveryIntegration>{await ensureDatabase();await pool.query("INSERT INTO app_settings (setting_key,value_json) VALUES ('delivery_integration',$1::jsonb) ON CONFLICT(setting_key) DO UPDATE SET value_json=EXCLUDED.value_json,updated_at=NOW()",[JSON.stringify(value)]);return getDeliveryIntegration();}

function mapCustomer(row:Row):Customer{return{id:Number(row.id),firstName:String(row.first_name),lastName:String(row.last_name),phone:String(row.phone),wilayaCode:String(row.wilaya_code),wilayaName:String(row.wilaya_name),commune:String(row.commune),address:String(row.address??""),createdAt:timestamp(row.created_at),updatedAt:timestamp(row.updated_at)};}
export async function getCustomerById(id:number):Promise<Customer|null>{const result=await rows("SELECT * FROM customers WHERE id=$1",[id]);return result[0]?mapCustomer(result[0]):null;}
export async function getCustomerCredentialsByPhone(phone:string):Promise<{customer:Customer;passwordHash:string}|null>{const result=await rows("SELECT * FROM customers WHERE phone=$1",[phone]);return result[0]?{customer:mapCustomer(result[0]),passwordHash:String(result[0].password_hash)}:null;}
export async function createCustomer(input:Omit<Customer,"id"|"createdAt"|"updatedAt">&{passwordHash:string}):Promise<Customer>{await ensureDatabase();const result=await pool.query("INSERT INTO customers (first_name,last_name,phone,password_hash,wilaya_code,wilaya_name,commune,address) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[input.firstName,input.lastName,input.phone,input.passwordHash,input.wilayaCode,input.wilayaName,input.commune,input.address]);return mapCustomer(result.rows[0]);}
export async function dashboardStats(){const [orders,products,newOrders,totalOrders,visitors]=await Promise.all([rows("SELECT * FROM orders WHERE status='delivered'"),listProducts(true),rows("SELECT count(*)::int count FROM orders WHERE status IN ('new','to_confirm')"),rows("SELECT count(*)::int count FROM orders"),rows("SELECT count(DISTINCT visitor_hash)::int count FROM visits WHERE created_at>=NOW()-INTERVAL '30 days'")]);const delivered=orders.map(mapOrder);const revenue=delivered.reduce((s,o)=>s+o.totalCents,0);const costs=new Map(products.map((p)=>[p.id,p.costCents]));const cost=delivered.reduce((s,o)=>s+o.items.reduce((x,i)=>x+(i.unitCostCents??costs.get(i.productId)??0)*i.quantity,0),0);const phones=new Map<string,number>();for(const order of delivered){const phone=order.phone.replace(/\D/g,"");if(phone)phones.set(phone,(phones.get(phone)??0)+1);}const repeats=[...phones.values()].filter((n)=>n>1).length;const inventory=products.reduce((s,p)=>s+(p.variants.length?p.variants.reduce((x,v)=>x+Math.max(0,Math.floor(Number(v.stock)||0)),0):p.sizes.reduce((x,v)=>x+Math.max(0,Math.floor(Number(v.stock)||0)),0)),0);return{products:products.length,published:products.filter((p)=>p.status==="published").length,newOrders:Number(newOrders[0].count),orders:Number(totalOrders[0].count),deliveredRevenueCents:revenue,grossProfitCents:revenue-cost,visitors30d:Number(visitors[0].count),repeatBuyerRate:phones.size?Math.round(repeats/phones.size*1000)/10:0,inventoryUnits:inventory};}
export async function recordVisit(hash:string,visitPath:string,productId:number|null):Promise<void>{await ensureDatabase();await pool.query("INSERT INTO visits (visitor_hash,path,product_id,visit_day) VALUES ($1,$2,$3,CURRENT_DATE) ON CONFLICT DO NOTHING",[hash,visitPath,productId]);}
export async function audit(adminId:number|null,action:string,entityType?:string,entityId?:string,details?:unknown):Promise<void>{await ensureDatabase();await pool.query("INSERT INTO audit_logs (admin_id,action,entity_type,entity_id,details_json) VALUES ($1,$2,$3,$4,$5::jsonb)",[adminId,action,entityType??null,entityId??null,details==null?null:JSON.stringify(details)]);}

// Authentication persistence. Password hashing and cookies remain in auth.ts.
export async function hasAdminRecord():Promise<boolean>{return Boolean((await rows("SELECT 1 FROM admins LIMIT 1"))[0]);}
export async function insertAdmin(email:string,passwordHash:string):Promise<number>{await ensureDatabase();const result=await pool.query("INSERT INTO admins (email,password_hash) VALUES ($1,$2) RETURNING id",[email,passwordHash]);return Number(result.rows[0].id);}
export async function isAdminLoginAllowed(email:string,ip:string):Promise<boolean>{const result=await rows("SELECT count(*)::int count FROM login_attempts WHERE LOWER(email)=LOWER($1) AND ip=$2 AND succeeded=FALSE AND created_at>NOW()-INTERVAL '15 minutes'",[email,ip]);return Number(result[0].count)<5;}
export async function insertLoginAttempt(email:string,ip:string,succeeded:boolean):Promise<void>{await ensureDatabase();await pool.query("INSERT INTO login_attempts (email,ip,succeeded) VALUES ($1,$2,$3)",[email,ip,succeeded]);await pool.query("DELETE FROM login_attempts WHERE created_at<NOW()-INTERVAL '2 days'");}
export async function getAdminCredentialRecord(email:string):Promise<{id:number;email:string;passwordHash:string}|null>{const result=await rows("SELECT id,email,password_hash FROM admins WHERE LOWER(email)=LOWER($1)",[email]);return result[0]?{id:Number(result[0].id),email:String(result[0].email),passwordHash:String(result[0].password_hash)}:null;}
export async function insertAdminSession(adminId:number,tokenHash:string,csrfToken:string,expires:Date):Promise<void>{await ensureDatabase();await pool.query("DELETE FROM admin_sessions WHERE expires_at<NOW()");await pool.query("INSERT INTO admin_sessions (admin_id,token_hash,csrf_token,expires_at) VALUES ($1,$2,$3,$4)",[adminId,tokenHash,csrfToken,expires]);await pool.query("UPDATE admins SET last_login_at=NOW() WHERE id=$1",[adminId]);}
export async function deleteAdminSession(tokenHash:string):Promise<void>{await ensureDatabase();await pool.query("DELETE FROM admin_sessions WHERE token_hash=$1",[tokenHash]);}
export async function getAdminSessionRecord(tokenHash:string):Promise<{adminId:number;email:string;csrfToken:string}|null>{const result=await rows("SELECT s.admin_id,a.email,s.csrf_token FROM admin_sessions s JOIN admins a ON a.id=s.admin_id WHERE s.token_hash=$1 AND s.expires_at>NOW()",[tokenHash]);return result[0]?{adminId:Number(result[0].admin_id),email:String(result[0].email),csrfToken:String(result[0].csrf_token)}:null;}
export async function insertCustomerSession(customerId:number,tokenHash:string,expires:Date):Promise<void>{await ensureDatabase();await pool.query("DELETE FROM customer_sessions WHERE expires_at<NOW()");await pool.query("INSERT INTO customer_sessions (customer_id,token_hash,expires_at) VALUES ($1,$2,$3)",[customerId,tokenHash,expires]);}
export async function deleteCustomerSession(tokenHash:string):Promise<void>{await ensureDatabase();await pool.query("DELETE FROM customer_sessions WHERE token_hash=$1",[tokenHash]);}
export async function getCustomerSessionId(tokenHash:string):Promise<number|null>{const result=await rows("SELECT customer_id FROM customer_sessions WHERE token_hash=$1 AND expires_at>NOW()",[tokenHash]);return result[0]?Number(result[0].customer_id):null;}

// Financial foundation: effective-dated product costs, operating expenses, partial refunds, actual delivery costs.
function mapProductCost(row: Row): ProductCost { return { id:Number(row.id),productId:Number(row.product_id),costCents:Number(row.cost_cents),effectiveFrom:timestamp(row.effective_from),effectiveTo:row.effective_to==null?null:timestamp(row.effective_to),createdAt:timestamp(row.created_at) }; }
export async function listProductCosts(productId: number): Promise<ProductCost[]> { return (await rows("SELECT * FROM product_costs WHERE product_id=$1 ORDER BY effective_from DESC", [productId])).map(mapProductCost); }
export async function addProductCost(productId: number, costCents: number, effectiveFrom?: string): Promise<ProductCost> {
  await ensureDatabase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const from = effectiveFrom ? new Date(effectiveFrom) : new Date();
    await client.query("UPDATE product_costs SET effective_to=$1 WHERE product_id=$2 AND effective_to IS NULL", [from, productId]);
    const result = await client.query("INSERT INTO product_costs (product_id,cost_cents,effective_from) VALUES ($1,$2,$3) RETURNING *", [productId, costCents, from]);
    await client.query("UPDATE products SET cost_cents=$1,updated_at=NOW() WHERE id=$2", [costCents, productId]);
    await client.query("COMMIT");
    return mapProductCost(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function mapExpense(row: Row): Expense { return { id:Number(row.id),category:String(row.category),amountCents:Number(row.amount_cents),currency:String(row.currency??"DZD"),recurrence:String(row.recurrence) as ExpenseRecurrence,costType:String(row.cost_type) as ExpenseCostType,effectiveFrom:timestamp(row.effective_from),effectiveTo:row.effective_to==null?null:timestamp(row.effective_to),allocationMethod:String(row.allocation_method) as ExpenseAllocationMethod,notes:String(row.notes??""),source:String(row.source??"manual"),createdAt:timestamp(row.created_at),updatedAt:timestamp(row.updated_at) }; }
export async function listExpenses(): Promise<Expense[]> { return (await rows("SELECT * FROM expenses ORDER BY effective_from DESC")).map(mapExpense); }
type ExpenseInput = { category: string; amountCents: number; currency?: string; recurrence: ExpenseRecurrence; costType: ExpenseCostType; effectiveFrom: string; effectiveTo?: string | null; allocationMethod: ExpenseAllocationMethod; notes?: string; source?: string };
export async function createExpense(input: ExpenseInput): Promise<Expense> {
  await ensureDatabase();
  const result = await pool.query(
    `INSERT INTO expenses (category,amount_cents,currency,recurrence,cost_type,effective_from,effective_to,allocation_method,notes,source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [input.category, input.amountCents, input.currency ?? "DZD", input.recurrence, input.costType, input.effectiveFrom, input.effectiveTo ?? null, input.allocationMethod, input.notes ?? "", input.source ?? "manual"],
  );
  return mapExpense(result.rows[0]);
}
export async function updateExpense(id: number, input: ExpenseInput): Promise<Expense | null> {
  await ensureDatabase();
  const result = await pool.query(
    `UPDATE expenses SET category=$1,amount_cents=$2,currency=$3,recurrence=$4,cost_type=$5,effective_from=$6,effective_to=$7,allocation_method=$8,notes=$9,source=$10,updated_at=NOW() WHERE id=$11 RETURNING *`,
    [input.category, input.amountCents, input.currency ?? "DZD", input.recurrence, input.costType, input.effectiveFrom, input.effectiveTo ?? null, input.allocationMethod, input.notes ?? "", input.source ?? "manual", id],
  );
  return result.rows[0] ? mapExpense(result.rows[0]) : null;
}
export async function deleteExpense(id: number): Promise<boolean> {
  await ensureDatabase();
  const result = await pool.query("DELETE FROM expenses WHERE id=$1", [id]);
  return (result.rowCount ?? 0) > 0;
}

export class RefundExceedsOrderTotalError extends Error { constructor() { super("REFUND_EXCEEDS_ORDER_TOTAL"); } }
export async function createOrderRefund(orderId: number, amountCents: number, reason: string, adminId: number | null): Promise<OrderRefund> {
  await ensureDatabase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const orderResult = await client.query("SELECT total_cents FROM orders WHERE id=$1 FOR UPDATE", [orderId]);
    if (!orderResult.rows[0]) throw new Error("ORDER_NOT_FOUND");
    const existing = await client.query("SELECT COALESCE(SUM(amount_cents),0)::bigint total FROM order_refunds WHERE order_id=$1", [orderId]);
    const alreadyRefunded = Number(existing.rows[0].total);
    if (alreadyRefunded + amountCents > Number(orderResult.rows[0].total_cents)) throw new RefundExceedsOrderTotalError();
    const result = await client.query("INSERT INTO order_refunds (order_id,amount_cents,reason,created_by_admin_id) VALUES ($1,$2,$3,$4) RETURNING *", [orderId, amountCents, reason, adminId]);
    await client.query("COMMIT");
    return mapRefund(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Meta event deduplication ledger.
export type MetaEventRecord = { id:number; eventId:string; eventName:string; orderId:number|null; pixelSentAt:string|null; capiSentAt:string|null; capiStatus:number|null; capiError:string|null; attempts:number; createdAt:string };
function mapMetaEvent(row: Row): MetaEventRecord { return { id:Number(row.id),eventId:String(row.event_id),eventName:String(row.event_name),orderId:row.order_id==null?null:Number(row.order_id),pixelSentAt:row.pixel_sent_at==null?null:timestamp(row.pixel_sent_at),capiSentAt:row.capi_sent_at==null?null:timestamp(row.capi_sent_at),capiStatus:row.capi_status==null?null:Number(row.capi_status),capiError:row.capi_error==null?null:String(row.capi_error),attempts:Number(row.attempts??0),createdAt:timestamp(row.created_at) }; }

/**
 * Atomically claims an event_id for server-side sending.
 * Returns false when the row already exists AND CAPI already succeeded for it, which is what
 * makes repeated webhooks / double submits / retries collapse onto a single conversion.
 */
export async function claimMetaCapiEvent(eventId: string, eventName: string, orderId: number | null): Promise<boolean> {
  await ensureDatabase();
  const result = await pool.query(
    `INSERT INTO meta_events (event_id,event_name,order_id,attempts) VALUES ($1,$2,$3,1)
     ON CONFLICT (event_id) DO UPDATE SET attempts = meta_events.attempts + 1
     WHERE meta_events.capi_sent_at IS NULL
     RETURNING id`,
    [eventId, eventName, orderId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function markMetaCapiResult(eventId: string, status: number, error: string | null): Promise<void> {
  await ensureDatabase();
  await pool.query(
    `UPDATE meta_events SET capi_sent_at = CASE WHEN $2 BETWEEN 200 AND 299 THEN NOW() ELSE capi_sent_at END, capi_status=$2, capi_error=$3 WHERE event_id=$1`,
    [eventId, status, error],
  );
}

export async function markMetaPixelSent(eventId: string, eventName: string, orderId: number | null): Promise<void> {
  await ensureDatabase();
  await pool.query(
    `INSERT INTO meta_events (event_id,event_name,order_id,pixel_sent_at) VALUES ($1,$2,$3,NOW())
     ON CONFLICT (event_id) DO UPDATE SET pixel_sent_at = COALESCE(meta_events.pixel_sent_at, NOW())`,
    [eventId, eventName, orderId],
  );
}

/**
 * Runtime tracking kill switch, stored in app_settings so it survives restarts and is shared
 * across instances. An admin can always turn tracking OFF without a redeploy; they cannot turn
 * it ON when META_TRACKING_ENABLED forbids it.
 */
export async function isTrackingDisabledByAdmin(): Promise<boolean> {
  const result = await rows("SELECT value_json FROM app_settings WHERE setting_key='meta_tracking'");
  const value = result[0] ? parseJson<{ disabled?: boolean }>(result[0].value_json, {}) : {};
  return value.disabled === true;
}
export async function setTrackingDisabledByAdmin(disabled: boolean): Promise<void> {
  await ensureDatabase();
  await pool.query(
    `INSERT INTO app_settings (setting_key,value_json) VALUES ('meta_tracking',$1::jsonb)
     ON CONFLICT(setting_key) DO UPDATE SET value_json=EXCLUDED.value_json, updated_at=NOW()`,
    [JSON.stringify({ disabled })],
  );
}

// --- Privacy: retention and erasure -------------------------------------------------------
export type PurgeResult = { visits: number; metaEvents: number; attribution: number };

/**
 * Deletes expired tracking rows. Financial tables are deliberately untouched: orders,
 * refunds, costs and expenses are accounting records with their own retention rules.
 */
export async function purgeOldTrackingData(policy: { visitsDays: number; metaEventsDays: number; attributionDays: number }): Promise<PurgeResult> {
  await ensureDatabase();
  const visits = await pool.query("DELETE FROM visits WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')", [policy.visitsDays]);
  // Only events tied to no order, or whose order is already gone, are removed: an event still
  // attached to a live order is part of that order's audit trail.
  const events = await pool.query("DELETE FROM meta_events WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')", [policy.metaEventsDays]);
  const attribution = await pool.query("DELETE FROM meta_attribution WHERE last_touch_at < NOW() - ($1::int * INTERVAL '1 day')", [policy.attributionDays]);
  return { visits: visits.rowCount ?? 0, metaEvents: events.rowCount ?? 0, attribution: attribution.rowCount ?? 0 };
}

export type ErasureResult = { customersAnonymised: number; ordersAnonymised: number; attributionDeleted: number; token: string };

/**
 * Right-to-erasure for one phone number.
 *
 * Personal fields are overwritten irreversibly; the order itself is KEPT with its amounts,
 * statuses and dates, because deleting it would corrupt accounting and every historical KPI.
 *
 * The phone is replaced by a unique per-person token rather than a constant, so erased
 * customers do not collapse into a single "buyer" and inflate the repeat-purchase rate.
 */
export async function eraseCustomerData(phone: string): Promise<ErasureResult> {
  await ensureDatabase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const token = `SUPPRIME-${crypto.randomBytes(8).toString("hex")}`;
    const customers = await client.query(
      `UPDATE customers SET first_name='Supprimé', last_name=$2, phone=$2, address='', commune='', password_hash='', updated_at=NOW()
       WHERE phone=$1 RETURNING id`, [phone, token]);
    const customerIds = customers.rows.map((row) => Number(row.id));
    // Sessions must go: they would still authenticate as the erased person.
    if (customerIds.length) await client.query("DELETE FROM customer_sessions WHERE customer_id = ANY($1::bigint[])", [customerIds]);
    const orders = await client.query(
      `UPDATE orders SET customer_name='Supprimé', first_name='Supprimé', last_name=$2, phone=$2, address='', notes='', updated_at=NOW()
       WHERE phone=$1 RETURNING id`, [phone, token]);
    const orderIds = orders.rows.map((row) => Number(row.id));
    // Attribution carries click ids that are personal data under GDPR.
    const attribution = orderIds.length
      ? await client.query("DELETE FROM meta_attribution WHERE order_id = ANY($1::bigint[])", [orderIds])
      : { rowCount: 0 };
    await client.query("COMMIT");
    return { customersAnonymised: customers.rowCount ?? 0, ordersAnonymised: orders.rowCount ?? 0, attributionDeleted: attribution.rowCount ?? 0, token };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Failed CAPI events still eligible for another attempt: the dead-letter queue. */
export async function listFailedMetaEvents(maxAttempts = 6, limit = 50): Promise<MetaEventRecord[]> {
  return (await rows(
    `SELECT * FROM meta_events WHERE capi_sent_at IS NULL AND capi_status IS NOT NULL AND attempts < $1
     ORDER BY created_at DESC LIMIT $2`, [maxAttempts, Math.min(limit, 200)])).map(mapMetaEvent);
}

/** Purchase-event delivery counts for a period, used by the reconciliation report. */
export async function reconciliationEventCounts(since: string, until: string): Promise<{ purchaseEvents: number; pixelOnly: number; capiOnly: number; deduplicated: number; failed: number }> {
  const result = await rows(
    `SELECT
       count(*)::int total,
       count(*) FILTER (WHERE pixel_sent_at IS NOT NULL AND capi_sent_at IS NULL)::int pixel_only,
       count(*) FILTER (WHERE pixel_sent_at IS NULL AND capi_sent_at IS NOT NULL)::int capi_only,
       count(*) FILTER (WHERE pixel_sent_at IS NOT NULL AND capi_sent_at IS NOT NULL)::int deduplicated,
       count(*) FILTER (WHERE capi_status IS NOT NULL AND (capi_status < 200 OR capi_status > 299))::int failed
     FROM meta_events
     WHERE event_name='Purchase' AND created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')`,
    [since, until],
  );
  const row = result[0] ?? {};
  return {
    purchaseEvents: Number(row.total ?? 0),
    pixelOnly: Number(row.pixel_only ?? 0),
    capiOnly: Number(row.capi_only ?? 0),
    deduplicated: Number(row.deduplicated ?? 0),
    failed: Number(row.failed ?? 0),
  };
}

export async function listRecentMetaEvents(limit = 50): Promise<MetaEventRecord[]> {
  return (await rows("SELECT * FROM meta_events ORDER BY created_at DESC LIMIT $1", [Math.min(limit, 200)])).map(mapMetaEvent);
}

export type MetaAttributionInput = {
  orderId?: number|null; visitorHash?: string|null; fbclid?: string|null; fbc?: string|null; fbp?: string|null;
  utmSource?: string|null; utmMedium?: string|null; utmCampaign?: string|null; utmContent?: string|null; utmTerm?: string|null;
  landingPage?: string|null; referrer?: string|null;
  firstFbclid?: string|null; firstUtmSource?: string|null; firstUtmMedium?: string|null; firstUtmCampaign?: string|null;
  firstLandingPage?: string|null; firstReferrer?: string|null;
  isMetaLastTouch?: boolean; isMetaFirstTouch?: boolean;
  firstTouchAt?: string|null; lastTouchAt?: string|null;
};
/** One row per order; a retry updates rather than adding a second attribution record. */
export async function recordMetaAttribution(input: MetaAttributionInput): Promise<void> {
  await ensureDatabase();
  await pool.query(
    `INSERT INTO meta_attribution (order_id,visitor_hash,fbclid,fbc,fbp,utm_source,utm_medium,utm_campaign,utm_content,utm_term,landing_page,referrer,
       first_fbclid,first_utm_source,first_utm_medium,first_utm_campaign,first_landing_page,first_referrer,
       is_meta_last_touch,is_meta_first_touch,first_touch_at,last_touch_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,COALESCE($21::timestamptz,NOW()),COALESCE($22::timestamptz,NOW()))
     ON CONFLICT (order_id) DO UPDATE SET fbc=COALESCE(EXCLUDED.fbc,meta_attribution.fbc), fbp=COALESCE(EXCLUDED.fbp,meta_attribution.fbp),
       fbclid=COALESCE(EXCLUDED.fbclid,meta_attribution.fbclid), utm_source=COALESCE(EXCLUDED.utm_source,meta_attribution.utm_source),
       utm_medium=COALESCE(EXCLUDED.utm_medium,meta_attribution.utm_medium), utm_campaign=COALESCE(EXCLUDED.utm_campaign,meta_attribution.utm_campaign),
       utm_content=COALESCE(EXCLUDED.utm_content,meta_attribution.utm_content), utm_term=COALESCE(EXCLUDED.utm_term,meta_attribution.utm_term),
       is_meta_last_touch=meta_attribution.is_meta_last_touch OR EXCLUDED.is_meta_last_touch,
       is_meta_first_touch=meta_attribution.is_meta_first_touch OR EXCLUDED.is_meta_first_touch`,
    [input.orderId ?? null, input.visitorHash ?? null, input.fbclid ?? null, input.fbc ?? null, input.fbp ?? null,
      input.utmSource ?? null, input.utmMedium ?? null, input.utmCampaign ?? null, input.utmContent ?? null, input.utmTerm ?? null,
      input.landingPage ?? null, input.referrer ?? null,
      input.firstFbclid ?? null, input.firstUtmSource ?? null, input.firstUtmMedium ?? null, input.firstUtmCampaign ?? null,
      input.firstLandingPage ?? null, input.firstReferrer ?? null,
      input.isMetaLastTouch ?? false, input.isMetaFirstTouch ?? false,
      input.firstTouchAt ?? null, input.lastTouchAt ?? null],
  );
}


// Meta Ads insights storage.
export type AdsInsightRow = {
  date: string; level: string; entityId: string; entityName: string; accountId: string;
  campaignId: string|null; campaignName: string|null; adsetId: string|null; adsetName: string|null; adId: string|null; adName: string|null;
  status: string|null; objective: string|null; optimizationGoal: string|null; attributionSetting: string|null; accountTimezone: string|null;
  currency: string; spendMinor: number; purchaseValueMinor: number; cpcMinor: number|null; cpmMinor: number|null; costPerPurchaseMinor: number|null;
  impressions: number; reach: number; frequency: number|null; clicks: number; linkClicks: number; outboundClicks: number; uniqueClicks: number; ctr: number|null;
  landingPageViews: number; leads: number; addsToCart: number; checkouts: number; purchases: number; purchaseRoas: number|null;
  videoViews: number; thruplays: number; videoP25: number; videoP50: number; videoP75: number; videoP100: number;
  actions: unknown; actionValues: unknown;
};

const INSIGHT_COLUMNS = "date,level,entity_id,entity_name,account_id,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,status,objective,optimization_goal,attribution_setting,account_timezone,currency,spend_minor,purchase_value_minor,cpc_minor,cpm_minor,cost_per_purchase_minor,impressions,reach,frequency,clicks,link_clicks,outbound_clicks,unique_clicks,ctr,landing_page_views,leads,adds_to_cart,checkouts,purchases,purchase_roas,video_views,thruplays,video_p25,video_p50,video_p75,video_p100,actions_json,action_values_json";

/** Idempotent upsert on (date, level, entity_id): re-syncing a day corrects it, never duplicates it. */
export async function upsertAdsInsights(rowsToSave: AdsInsightRow[]): Promise<number> {
  if (!rowsToSave.length) return 0;
  await ensureDatabase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let saved = 0;
    for (const row of rowsToSave) {
      const values = [row.date, row.level, row.entityId, row.entityName, row.accountId, row.campaignId, row.campaignName, row.adsetId, row.adsetName, row.adId, row.adName,
        row.status, row.objective, row.optimizationGoal, row.attributionSetting, row.accountTimezone, row.currency,
        row.spendMinor, row.purchaseValueMinor, row.cpcMinor, row.cpmMinor, row.costPerPurchaseMinor,
        row.impressions, row.reach, row.frequency, row.clicks, row.linkClicks, row.outboundClicks, row.uniqueClicks, row.ctr,
        row.landingPageViews, row.leads, row.addsToCart, row.checkouts, row.purchases, row.purchaseRoas,
        row.videoViews, row.thruplays, row.videoP25, row.videoP50, row.videoP75, row.videoP100,
        JSON.stringify(row.actions ?? []), JSON.stringify(row.actionValues ?? [])];
      const placeholders = values.map((_, index) => index >= 42 ? `$${index + 1}::jsonb` : `$${index + 1}`).join(",");
      const updates = INSIGHT_COLUMNS.split(",").filter((column) => !["date", "level", "entity_id"].includes(column)).map((column) => `${column}=EXCLUDED.${column}`).join(",");
      await client.query(`INSERT INTO meta_ads_insights_daily (${INSIGHT_COLUMNS}) VALUES (${placeholders})
        ON CONFLICT (date,level,entity_id) DO UPDATE SET ${updates}, synced_at=NOW()`, values);
      saved += 1;
    }
    await client.query("COMMIT");
    return saved;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listAdsInsights(since: string, until: string, level = "campaign"): Promise<Row[]> {
  return rows("SELECT * FROM meta_ads_insights_daily WHERE level=$1 AND date BETWEEN $2 AND $3 ORDER BY date DESC, spend_minor DESC", [level, since, until]);
}

export type CampaignInsightDailyRecord = {
  date: string;
  entityId: string;
  entityName: string;
  status: string | null;
  objective: string | null;
  currency: string;
  spendMinor: number;
  purchaseValueMinor: number;
  impressions: number;
  reach: number;
  clicks: number;
  linkClicks: number;
  landingPageViews: number;
  addsToCart: number;
  checkouts: number;
  purchases: number;
  syncedAt: string;
};

/** Strongly typed campaign rows used by the deterministic intelligence service. */
export async function listCampaignInsightRows(since: string, until: string): Promise<CampaignInsightDailyRecord[]> {
  return (await rows(
    `SELECT date,entity_id,entity_name,status,objective,currency,spend_minor,purchase_value_minor,
      impressions,reach,clicks,link_clicks,landing_page_views,adds_to_cart,checkouts,purchases,synced_at
     FROM meta_ads_insights_daily WHERE level='campaign' AND date BETWEEN $1 AND $2
     ORDER BY date, spend_minor DESC`,
    [since, until],
  )).map((row) => ({
    date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date).slice(0, 10),
    entityId: String(row.entity_id),
    entityName: String(row.entity_name ?? row.campaign_name ?? ""),
    status: row.status == null ? null : String(row.status),
    objective: row.objective == null ? null : String(row.objective),
    currency: String(row.currency ?? ""),
    spendMinor: Number(row.spend_minor ?? 0),
    purchaseValueMinor: Number(row.purchase_value_minor ?? 0),
    impressions: Number(row.impressions ?? 0),
    reach: Number(row.reach ?? 0),
    clicks: Number(row.clicks ?? 0),
    linkClicks: Number(row.link_clicks ?? 0),
    landingPageViews: Number(row.landing_page_views ?? 0),
    addsToCart: Number(row.adds_to_cart ?? 0),
    checkouts: Number(row.checkouts ?? 0),
    purchases: Number(row.purchases ?? 0),
    syncedAt: timestamp(row.synced_at),
  }));
}

export async function getCampaignThresholdOverrides(): Promise<unknown> {
  const result = await rows("SELECT value_json FROM app_settings WHERE setting_key='campaign_intelligence_thresholds'");
  return result[0]?.value_json ?? null;
}

export async function getCampaignAiCache(fingerprint: string): Promise<{ model: string | null; analysis: unknown; createdAt: string } | null> {
  const result = await rows(
    "SELECT model,analysis_json,created_at FROM campaign_ai_analyses WHERE fingerprint=$1 AND expires_at>NOW()",
    [fingerprint],
  );
  if (!result[0]) return null;
  return {
    model: result[0].model == null ? null : String(result[0].model),
    analysis: result[0].analysis_json,
    createdAt: timestamp(result[0].created_at),
  };
}

export async function saveCampaignAiCache(input: {
  fingerprint: string;
  entityId: string;
  since: string;
  until: string;
  deterministicStatus: "SCALE" | "KEEP" | "WATCH" | "KILL";
  model: string | null;
  analysis: unknown;
  expiresAt: Date;
}): Promise<void> {
  await ensureDatabase();
  await pool.query(
    `INSERT INTO campaign_ai_analyses
      (fingerprint,entity_level,entity_id,period_since,period_until,deterministic_status,model,analysis_json,expires_at)
     VALUES ($1,'campaign',$2,$3,$4,$5,$6,$7::jsonb,$8)
     ON CONFLICT(fingerprint) DO UPDATE SET model=EXCLUDED.model,analysis_json=EXCLUDED.analysis_json,
       deterministic_status=EXCLUDED.deterministic_status,created_at=NOW(),expires_at=EXCLUDED.expires_at`,
    [input.fingerprint, input.entityId, input.since, input.until, input.deterministicStatus, input.model, JSON.stringify(input.analysis), input.expiresAt],
  );
}

// Sync freshness. Stale or failing jobs must be visible, not silent.
export type SyncState = { syncKey:string; lastRunAt:string|null; lastSuccessAt:string|null; lastError:string|null; lastResult:unknown };
export async function recordSyncResult(syncKey: string, success: boolean, error: string | null, result: unknown): Promise<void> {
  await ensureDatabase();
  await pool.query(
    `INSERT INTO meta_sync_state (sync_key,last_run_at,last_success_at,last_error,last_result_json)
     VALUES ($1,NOW(),CASE WHEN $2 THEN NOW() ELSE NULL END,$3,$4::jsonb)
     ON CONFLICT (sync_key) DO UPDATE SET last_run_at=NOW(),
       last_success_at=CASE WHEN $2 THEN NOW() ELSE meta_sync_state.last_success_at END,
       last_error=$3, last_result_json=$4::jsonb, updated_at=NOW()`,
    [syncKey, success, error, JSON.stringify(result ?? null)],
  );
}
export async function listSyncState(): Promise<SyncState[]> {
  return (await rows("SELECT * FROM meta_sync_state ORDER BY sync_key")).map((row) => ({
    syncKey: String(row.sync_key), lastRunAt: row.last_run_at == null ? null : timestamp(row.last_run_at),
    lastSuccessAt: row.last_success_at == null ? null : timestamp(row.last_success_at),
    lastError: row.last_error == null ? null : String(row.last_error), lastResult: row.last_result_json ?? null,
  }));
}

// Catalog item sync state.
export type CatalogItemState = { productId:number; retailerId:string; contentHash:string; lastSyncedAt:string|null; lastMethod:string|null; lastError:string|null };
export async function listCatalogItems(): Promise<CatalogItemState[]> {
  return (await rows("SELECT * FROM meta_catalog_items")).map((row) => ({
    productId: Number(row.product_id), retailerId: String(row.retailer_id), contentHash: String(row.content_hash ?? ""),
    lastSyncedAt: row.last_synced_at == null ? null : timestamp(row.last_synced_at),
    lastMethod: row.last_method == null ? null : String(row.last_method),
    lastError: row.last_error == null ? null : String(row.last_error),
  }));
}
export async function upsertCatalogItemState(productId: number, retailerId: string, contentHash: string, method: string, error: string | null): Promise<void> {
  await ensureDatabase();
  await pool.query(
    `INSERT INTO meta_catalog_items (product_id,retailer_id,content_hash,last_synced_at,last_method,last_error)
     VALUES ($1,$2,$3,CASE WHEN $5::text IS NULL THEN NOW() ELSE NULL END,$4,$5)
     ON CONFLICT (product_id) DO UPDATE SET retailer_id=EXCLUDED.retailer_id, content_hash=EXCLUDED.content_hash,
       last_synced_at=CASE WHEN $5::text IS NULL THEN NOW() ELSE meta_catalog_items.last_synced_at END,
       last_method=EXCLUDED.last_method, last_error=EXCLUDED.last_error`,
    [productId, retailerId, contentHash, method, error],
  );
}

// Facebook Page product-post ledger. Claiming is atomic so concurrent product saves cannot
// create duplicate public posts. A failed attempt stays visible and can be retried explicitly.
export type ProductPagePostState = {
  productId: number;
  pageId: string;
  postId: string | null;
  status: "pending" | "published" | "failed";
  attemptCount: number;
  lastError: string | null;
  postedAt: string | null;
  updatedAt: string;
};

function mapProductPagePost(row: Row): ProductPagePostState {
  return {
    productId: Number(row.product_id),
    pageId: String(row.page_id),
    postId: row.post_id == null ? null : String(row.post_id),
    status: String(row.status) as ProductPagePostState["status"],
    attemptCount: Number(row.attempt_count),
    lastError: row.last_error == null ? null : String(row.last_error),
    postedAt: row.posted_at == null ? null : timestamp(row.posted_at),
    updatedAt: timestamp(row.updated_at),
  };
}

export async function claimProductPagePost(productId: number, pageId: string, retryFailed = false): Promise<ProductPagePostState | null> {
  await ensureDatabase();
  if (!retryFailed) {
    const result = await pool.query(
      `INSERT INTO meta_product_page_posts (product_id,page_id)
       VALUES ($1,$2) ON CONFLICT(product_id) DO NOTHING RETURNING *`,
      [productId, pageId],
    );
    return result.rows[0] ? mapProductPagePost(result.rows[0]) : null;
  }
  const result = await pool.query(
    `INSERT INTO meta_product_page_posts (product_id,page_id)
     VALUES ($1,$2)
     ON CONFLICT(product_id) DO UPDATE SET page_id=EXCLUDED.page_id,status='pending',
       attempt_count=meta_product_page_posts.attempt_count+1,last_error=NULL,updated_at=NOW()
     WHERE meta_product_page_posts.status='failed'
     RETURNING *`,
    [productId, pageId],
  );
  return result.rows[0] ? mapProductPagePost(result.rows[0]) : null;
}

export async function finishProductPagePost(productId: number, postId: string): Promise<void> {
  await ensureDatabase();
  await pool.query(
    `UPDATE meta_product_page_posts SET status='published',post_id=$2,last_error=NULL,
       posted_at=NOW(),updated_at=NOW() WHERE product_id=$1 AND status='pending'`,
    [productId, postId],
  );
}

export async function failProductPagePost(productId: number, error: string): Promise<void> {
  await ensureDatabase();
  await pool.query(
    `UPDATE meta_product_page_posts SET status='failed',last_error=$2,updated_at=NOW()
     WHERE product_id=$1 AND status='pending'`,
    [productId, error.slice(0, 500)],
  );
}

export async function productPagePostSummary(): Promise<{
  published: number;
  failed: number;
  pending: number;
  failures: Array<{ productId: number; error: string }>;
}> {
  const posts = (await rows("SELECT * FROM meta_product_page_posts ORDER BY updated_at DESC")).map(mapProductPagePost);
  return {
    published: posts.filter((post) => post.status === "published").length,
    failed: posts.filter((post) => post.status === "failed").length,
    pending: posts.filter((post) => post.status === "pending").length,
    failures: posts.filter((post) => post.status === "failed" && post.lastError).slice(0, 8)
      .map((post) => ({ productId: post.productId, error: post.lastError ?? "Unknown error" })),
  };
}

export type ProductInstagramPostState = {
  productId: number;
  accountId: string;
  postId: string | null;
  status: "pending" | "published" | "failed";
  attemptCount: number;
  lastError: string | null;
  postedAt: string | null;
  updatedAt: string;
};

function mapProductInstagramPost(row: Row): ProductInstagramPostState {
  return {
    productId: Number(row.product_id),
    accountId: String(row.account_id),
    postId: row.post_id == null ? null : String(row.post_id),
    status: String(row.status) as ProductInstagramPostState["status"],
    attemptCount: Number(row.attempt_count),
    lastError: row.last_error == null ? null : String(row.last_error),
    postedAt: row.posted_at == null ? null : timestamp(row.posted_at),
    updatedAt: timestamp(row.updated_at),
  };
}

export async function claimProductInstagramPost(productId: number, accountId: string, retryFailed = false): Promise<ProductInstagramPostState | null> {
  await ensureDatabase();
  if (!retryFailed) {
    const result = await pool.query(
      `INSERT INTO meta_product_instagram_posts (product_id,account_id)
       VALUES ($1,$2) ON CONFLICT(product_id) DO NOTHING RETURNING *`,
      [productId, accountId],
    );
    return result.rows[0] ? mapProductInstagramPost(result.rows[0]) : null;
  }
  const result = await pool.query(
    `INSERT INTO meta_product_instagram_posts (product_id,account_id)
     VALUES ($1,$2)
     ON CONFLICT(product_id) DO UPDATE SET account_id=EXCLUDED.account_id,status='pending',
       attempt_count=meta_product_instagram_posts.attempt_count+1,last_error=NULL,updated_at=NOW()
     WHERE meta_product_instagram_posts.status='failed'
     RETURNING *`,
    [productId, accountId],
  );
  return result.rows[0] ? mapProductInstagramPost(result.rows[0]) : null;
}

export async function finishProductInstagramPost(productId: number, postId: string): Promise<void> {
  await ensureDatabase();
  await pool.query(
    `UPDATE meta_product_instagram_posts SET status='published',post_id=$2,last_error=NULL,
       posted_at=NOW(),updated_at=NOW() WHERE product_id=$1 AND status='pending'`,
    [productId, postId],
  );
}

export async function failProductInstagramPost(productId: number, error: string): Promise<void> {
  await ensureDatabase();
  await pool.query(
    `UPDATE meta_product_instagram_posts SET status='failed',last_error=$2,updated_at=NOW()
     WHERE product_id=$1 AND status='pending'`,
    [productId, error.slice(0, 500)],
  );
}

export async function productInstagramPostSummary(): Promise<{
  published: number;
  failed: number;
  pending: number;
  failures: Array<{ productId: number; error: string }>;
}> {
  const posts = (await rows("SELECT * FROM meta_product_instagram_posts ORDER BY updated_at DESC")).map(mapProductInstagramPost);
  return {
    published: posts.filter((post) => post.status === "published").length,
    failed: posts.filter((post) => post.status === "failed").length,
    pending: posts.filter((post) => post.status === "pending").length,
    failures: posts.filter((post) => post.status === "failed" && post.lastError).slice(0, 8)
      .map((post) => ({ productId: post.productId, error: post.lastError ?? "Unknown error" })),
  };
}

// Dated exchange rates for ad-spend conversion.
export type FxRate = { rateDate: string; currency: string; dzdPerUnit: number; source: string };
export async function listFxRates(currencies: string[]): Promise<FxRate[]> {
  if (!currencies.length) return [];
  return (await rows("SELECT rate_date,currency,dzd_per_unit,source FROM fx_rates WHERE currency = ANY($1::text[])", [currencies]))
    .map((row) => ({
      rateDate: row.rate_date instanceof Date ? row.rate_date.toISOString().slice(0, 10) : String(row.rate_date).slice(0, 10),
      currency: String(row.currency),
      dzdPerUnit: Number(row.dzd_per_unit),
      source: String(row.source ?? "manual"),
    }));
}
export async function upsertFxRate(rateDate: string, currency: string, dzdPerUnit: number, source = "manual"): Promise<void> {
  await ensureDatabase();
  await pool.query(
    `INSERT INTO fx_rates (rate_date,currency,dzd_per_unit,source) VALUES ($1,$2,$3,$4)
     ON CONFLICT (rate_date,currency) DO UPDATE SET dzd_per_unit=EXCLUDED.dzd_per_unit, source=EXCLUDED.source`,
    [rateDate, currency.toUpperCase(), dzdPerUnit, source],
  );
}

/** Daily ad spend per currency for a period, used as the input to FX conversion. */
export async function listDailySpend(since: string, until: string): Promise<Array<{ date: string; currency: string; spendMinor: number }>> {
  return (await rows(
    `SELECT date, currency, SUM(spend_minor)::bigint spend_minor FROM meta_ads_insights_daily
     WHERE level='account' AND date BETWEEN $1 AND $2 GROUP BY date, currency ORDER BY date`,
    [since, until],
  )).map((row) => ({
    date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date).slice(0, 10),
    currency: String(row.currency ?? ""),
    spendMinor: Number(row.spend_minor ?? 0),
  }));
}

/**
 * Currency of the most recent recorded spend, i.e. the currency the ad account is billed in.
 * Returns "" when no spend has been synced yet: unknown is reported as unknown, never guessed.
 */
export async function latestSpendCurrency(): Promise<string> {
  const result = await rows(
    `SELECT currency FROM meta_ads_insights_daily
     WHERE level='account' AND currency <> '' ORDER BY date DESC LIMIT 1`,
  );
  return String(result[0]?.currency ?? "");
}

/** Meta's own attributed purchase value for a period, in the ad account currency. */
export async function metaAttributedTotals(since: string, until: string): Promise<{ currency: string; purchaseValueMinor: number; purchases: number } | null> {
  const result = await rows(
    `SELECT currency, SUM(purchase_value_minor)::bigint value, SUM(purchases)::bigint purchases
     FROM meta_ads_insights_daily WHERE level='account' AND date BETWEEN $1 AND $2 GROUP BY currency`,
    [since, until],
  );
  if (!result[0]) return null;
  return { currency: String(result[0].currency ?? ""), purchaseValueMinor: Number(result[0].value ?? 0), purchases: Number(result[0].purchases ?? 0) };
}

/** Recognised orders inside a period, plus everything before it (for new-vs-returning buyers). */
export async function listOrdersForPeriod(since: string, until: string): Promise<{ period: Order[]; prior: Order[] }> {
  const [periodRows, priorRows] = await Promise.all([
    rows("SELECT * FROM orders WHERE created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day') ORDER BY created_at", [since, until]),
    rows("SELECT * FROM orders WHERE created_at < $1::date ORDER BY created_at", [since]),
  ]);
  const [period, prior] = await Promise.all([
    enrichOrders(periodRows.map(mapOrder)),
    enrichOrders(priorRows.map(mapOrder)),
  ]);
  return { period, prior };
}

export async function upsertOrderDeliveryCost(orderId: number, carrierCostCents: number, returnCostCents: number, source: string): Promise<OrderDeliveryCost> {
  await ensureDatabase();
  const result = await pool.query(
    `INSERT INTO order_delivery_costs (order_id,carrier_cost_cents,return_cost_cents,source) VALUES ($1,$2,$3,$4)
     ON CONFLICT (order_id) DO UPDATE SET carrier_cost_cents=EXCLUDED.carrier_cost_cents,return_cost_cents=EXCLUDED.return_cost_cents,source=EXCLUDED.source,updated_at=NOW() RETURNING *`,
    [orderId, carrierCostCents, returnCostCents, source],
  );
  return mapDeliveryCost(result.rows[0]);
}
