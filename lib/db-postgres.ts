import "server-only";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { algeriaWilayas } from "./algeria";
import type { Customer, DeliveryIntegration, DeliveryRate, DeliveryType, ImportJob, Order, OrderItem, OrderStatus, Product, ProductSize, ProductStatus, ProductTestimonial, ProductTranslation, ProductVariant, StoreSettings } from "./types";

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

async function initialize(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL est obligatoire. Configurez la connexion PostgreSQL Supabase.");
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "postgres-schema.sql"), "utf8");
  await pool.query(schema);
  for (const wilaya of algeriaWilayas) {
    await pool.query(`INSERT INTO delivery_rates (wilaya_code,wilaya_name_fr,wilaya_name_ar)
      VALUES ($1,$2,$3) ON CONFLICT (wilaya_code) DO NOTHING`, [wilaya.code, wilaya.nameFr, wilaya.nameAr]);
  }
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
    subtotalCents:Number(row.subtotal_cents),shippingCents:Number(row.shipping_cents),totalCents:Number(row.total_cents),createdAt:timestamp(row.created_at),updatedAt:timestamp(row.updated_at) };
}
export async function listOrders(): Promise<Order[]> { return (await rows("SELECT * FROM orders ORDER BY created_at DESC LIMIT 250")).map(mapOrder); }
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
const releasing=new Set<OrderStatus>(["refused","returned","cancelled"]);
export async function updateOrderStatus(id:number,status:OrderStatus):Promise<"updated"|"not_found"|"stock_unavailable">{await ensureDatabase();const client=await pool.connect();try{await client.query("BEGIN");const result=await client.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE",[id]);if(!result.rows[0]){await client.query("ROLLBACK");return "not_found";}const order=mapOrder(result.rows[0]);const reserved=Boolean(result.rows[0].stock_reserved);const shouldReserve=!releasing.has(status);if(reserved&&!shouldReserve)await changeStock(client,order.items,1);if(!reserved&&shouldReserve)await changeStock(client,order.items,-1);await client.query("UPDATE orders SET status=$1,stock_reserved=$2,updated_at=NOW() WHERE id=$3",[status,shouldReserve,id]);await client.query("COMMIT");return "updated";}catch(error){await client.query("ROLLBACK");if(error instanceof StockUnavailableError)return "stock_unavailable";throw error;}finally{client.release();}}

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
