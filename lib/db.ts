import "server-only";

import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { algeriaWilayas } from "./algeria";
import type { Customer, DeliveryIntegration, DeliveryRate, DeliveryType, ImportJob, Order, OrderItem, OrderStatus, Product, ProductSize, ProductStatus, ProductTestimonial, ProductTranslation, ProductVariant, StoreSettings } from "./types";

type Row = Record<string, unknown>;

const databasePath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(process.cwd(), "data", "lovelystep.db");

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const globalDb = globalThis as typeof globalThis & { lovelyStepDb?: Database.Database };
export const db = globalDb.lovelyStepDb ?? new Database(databasePath);
if (process.env.NODE_ENV !== "production") globalDb.lovelyStepDb = db;

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TEXT
  );
  CREATE TABLE IF NOT EXISTS admin_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    csrf_token TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    ip TEXT NOT NULL,
    succeeded INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    short_description TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
    cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(cost_cents >= 0),
    compare_at_cents INTEGER,
    currency TEXT NOT NULL DEFAULT 'DZD',
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
    category TEXT NOT NULL DEFAULT 'Ensembles',
    badge TEXT,
    color TEXT NOT NULL DEFAULT '',
    colors_json TEXT NOT NULL DEFAULT '[]',
    materials TEXT NOT NULL DEFAULT '',
    care TEXT NOT NULL DEFAULT '',
    source_url TEXT,
    source_data_json TEXT,
    images_json TEXT NOT NULL DEFAULT '[]',
    color_images_json TEXT NOT NULL DEFAULT '{}',
    sizes_json TEXT NOT NULL DEFAULT '[]',
    variants_json TEXT NOT NULL DEFAULT '[]',
    features_json TEXT NOT NULL DEFAULT '[]',
    testimonials_json TEXT NOT NULL DEFAULT '[]',
    translations_json TEXT NOT NULL DEFAULT '{}',
    size_guide_image TEXT,
    seo_title TEXT,
    seo_description TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT NOT NULL UNIQUE,
    customer_name TEXT NOT NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL,
    city TEXT NOT NULL,
    wilaya_code TEXT NOT NULL DEFAULT '',
    wilaya_name TEXT NOT NULL DEFAULT '',
    commune TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL,
    delivery_type TEXT NOT NULL DEFAULT 'home',
    delivery_external_id TEXT,
    delivery_sync_status TEXT NOT NULL DEFAULT 'not_configured',
    delivery_sync_error TEXT,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new',
    items_json TEXT NOT NULL,
    subtotal_cents INTEGER NOT NULL,
    shipping_cents INTEGER NOT NULL DEFAULT 0,
    total_cents INTEGER NOT NULL,
    stock_reserved INTEGER NOT NULL DEFAULT 0 CHECK(stock_reserved IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    wilaya_code TEXT NOT NULL,
    wilaya_name TEXT NOT NULL,
    commune TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS customer_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS delivery_rates (
    wilaya_code TEXT PRIMARY KEY,
    wilaya_name_fr TEXT NOT NULL,
    wilaya_name_ar TEXT NOT NULL DEFAULT '',
    home_cents INTEGER NOT NULL DEFAULT 0 CHECK(home_cents >= 0),
    office_cents INTEGER NOT NULL DEFAULT 0 CHECK(office_cents >= 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS app_settings (
    setting_key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS import_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    error TEXT,
    extracted_json TEXT,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    details_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS order_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_hash TEXT NOT NULL,
    path TEXT NOT NULL,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    visit_day TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(visitor_hash, path, visit_day)
  );
  CREATE INDEX IF NOT EXISTS idx_products_status ON products(status, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON admin_sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_attempts_lookup ON login_attempts(email, ip, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_order_attempts ON order_attempts(ip, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_visits_created ON visits(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_customer_sessions_expiry ON customer_sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
`);

function ensureColumn(table: "products" | "orders", column: string, definition: string): void {
  const columns = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((item) => item.name));
  if (columns.has(column)) return;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("duplicate column name")) throw error;
  }
}
ensureColumn("products", "colors_json", "TEXT NOT NULL DEFAULT '[]'");
ensureColumn("products", "testimonials_json", "TEXT NOT NULL DEFAULT '[]'");
ensureColumn("products", "cost_cents", "INTEGER NOT NULL DEFAULT 0 CHECK(cost_cents >= 0)");
ensureColumn("products", "variants_json", "TEXT NOT NULL DEFAULT '[]'");
ensureColumn("products", "color_images_json", "TEXT NOT NULL DEFAULT '{}'");
ensureColumn("products", "translations_json", "TEXT NOT NULL DEFAULT '{}'");
ensureColumn("orders", "stock_reserved", "INTEGER NOT NULL DEFAULT 0 CHECK(stock_reserved IN (0,1))");
ensureColumn("orders", "customer_id", "INTEGER REFERENCES customers(id) ON DELETE SET NULL");
ensureColumn("orders", "first_name", "TEXT NOT NULL DEFAULT ''");
ensureColumn("orders", "last_name", "TEXT NOT NULL DEFAULT ''");
ensureColumn("orders", "wilaya_code", "TEXT NOT NULL DEFAULT ''");
ensureColumn("orders", "wilaya_name", "TEXT NOT NULL DEFAULT ''");
ensureColumn("orders", "commune", "TEXT NOT NULL DEFAULT ''");
ensureColumn("orders", "delivery_type", "TEXT NOT NULL DEFAULT 'home'");
ensureColumn("orders", "delivery_external_id", "TEXT");
ensureColumn("orders", "delivery_sync_status", "TEXT NOT NULL DEFAULT 'not_configured'");
ensureColumn("orders", "delivery_sync_error", "TEXT");
db.prepare("UPDATE products SET currency='DZD' WHERE currency<>'DZD'").run();
db.prepare("UPDATE products SET images_json=replace(images_json, '/uploads/products/', '/api/media/products/')").run();
db.prepare("UPDATE products SET images_json=replace(images_json, '/uploads/imports/', '/api/media/imports/')").run();
db.prepare("UPDATE products SET images_json=replace(images_json, '/generated/size-guides/', '/api/media/size-guides/')").run();
db.prepare("UPDATE products SET size_guide_image=replace(size_guide_image, '/generated/size-guides/', '/api/media/size-guides/') WHERE size_guide_image IS NOT NULL").run();

const seedDeliveryRate = db.prepare(`INSERT OR IGNORE INTO delivery_rates
  (wilaya_code,wilaya_name_fr,wilaya_name_ar,home_cents,office_cents,active) VALUES (?,?,?,0,0,1)`);
for (const wilaya of algeriaWilayas) seedDeliveryRate.run(wilaya.code, wilaya.nameFr, wilaya.nameAr);

const seedProducts = [
  { slug: "ensemble-journee-ensoleillee", name: "Ensemble Journée Ensoleillée", price: 349000, compareAt: 429000, badge: "Best-seller", category: "Ensembles", image: "/images/sunny-set.jpg", color: "Bleu piscine", sizes: ["3-4 ans", "5-6 ans", "7-8 ans"] },
  { slug: "salopette-petit-artiste", name: "Salopette Petit Artiste", price: 299000, compareAt: null, badge: "Nouveau", category: "Salopettes", image: "/images/playtime.jpg", color: "Bleu nuage", sizes: ["2-3 ans", "4-5 ans", "6-7 ans"] },
  { slug: "t-shirt-rayures-explorateur", name: "T-shirt Rayures Explorateur", price: 229000, compareAt: null, badge: "Coton doux", category: "Hauts", image: "/images/cozy-knit.jpg", color: "Rayures océan", sizes: ["2-3 ans", "4-5 ans", "6-8 ans"] },
  { slug: "ensemble-mini-muse", name: "Ensemble Mini Muse", price: 279000, compareAt: null, badge: null, category: "Ensembles", image: "/images/little-explorer.jpg", color: "Rayures sable", sizes: ["1-2 ans", "3-4 ans", "4-5 ans"] },
  { slug: "sweat-weekend", name: "Sweat Weekend", price: 249000, compareAt: null, badge: "Entretien facile", category: "Hauts", image: "/images/weekend-club.jpg", color: "Corail", sizes: ["5-6 ans", "7-8 ans", "9-10 ans"] },
  { slug: "sac-aventure", name: "Sac Aventure", price: 189000, compareAt: null, badge: "Stock limité", category: "Accessoires", image: "/images/soft-days.jpg", color: "Bleu marine", sizes: ["Taille unique"] },
];

const insertSeed = db.prepare(`INSERT OR IGNORE INTO products
  (slug,name,short_description,description,price_cents,compare_at_cents,status,category,badge,color,materials,care,images_json,sizes_json,features_json,seo_title,seo_description)
  VALUES (@slug,@name,@short,@description,@price,@compareAt,'published',@category,@badge,@color,@materials,@care,@images,@sizes,@features,@name,@short)`);
for (const item of seedProducts) {
  insertSeed.run({ ...item,
    short: "Une tenue douce, pratique et pensée pour les grandes aventures des petits.",
    description: "Confortable du matin au soir, cette pièce Lovely Step accompagne les jeux, les sorties et les moments en famille. Sa coupe facile à porter laisse les enfants bouger librement.",
    materials: "Matières douces sélectionnées pour le confort des enfants.",
    care: "Lavage doux à 30 °C. Laver avec des couleurs similaires.",
    images: JSON.stringify([item.image]), sizes: JSON.stringify(item.sizes.map((label) => ({ label, stock: 12 }))),
    features: JSON.stringify(["Doux pour la peau", "Coupe confortable", "Paiement à la livraison"]),
  });
}

const colorVariantMigration = "2026-08-color-specific-stock";
if (!db.prepare("SELECT 1 FROM schema_migrations WHERE name=?").get(colorVariantMigration)) {
  db.transaction(() => {
    const rows = db.prepare("SELECT id,color,colors_json,sizes_json,variants_json FROM products").all() as Row[];
    for (const row of rows) {
      const existingVariants = parseJson<ProductVariant[]>(row.variants_json, []);
      if (existingVariants.length) continue;
      const sizes = parseJson<ProductSize[]>(row.sizes_json, []);
      if (!sizes.length) continue;
      const savedColors = parseJson<string[]>(row.colors_json, []).filter(Boolean);
      const legacyColor = String(row.color ?? "").trim();
      const colors = savedColors.length ? savedColors : (legacyColor ? [legacyColor] : [""]);
      const variants = colors.flatMap((color, colorIndex) => sizes.map((size) => ({
        color,
        size: size.label,
        stock: colorIndex === 0 ? Math.max(0, Math.floor(Number(size.stock) || 0)) : 0,
        age: size.age,
        weight: size.weight,
        height: size.height,
      })));
      db.prepare("UPDATE products SET colors_json=?,variants_json=? WHERE id=?").run(JSON.stringify(colors.filter(Boolean)), JSON.stringify(variants), Number(row.id));
    }
    db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(colorVariantMigration);
  })();
}

const seedDzdPriceMigration = "2026-08-seed-dzd-prices";
if (!db.prepare("SELECT 1 FROM schema_migrations WHERE name=?").get(seedDzdPriceMigration)) {
  db.transaction(() => {
    const updates = [
      ["ensemble-journee-ensoleillee", 34900, 349000, 429000],
      ["salopette-petit-artiste", 29900, 299000, null],
      ["t-shirt-rayures-explorateur", 22900, 229000, null],
      ["ensemble-mini-muse", 27900, 279000, null],
      ["sweat-weekend", 24900, 249000, null],
      ["sac-aventure", 18900, 189000, null],
    ] as const;
    const update = db.prepare("UPDATE products SET price_cents=?,compare_at_cents=?,updated_at=CURRENT_TIMESTAMP WHERE slug=? AND price_cents=?");
    for (const [slug, oldPrice, newPrice, compareAt] of updates) update.run(newPrice, compareAt, slug, oldPrice);
    db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(seedDzdPriceMigration);
  })();
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function mapProduct(row: Row): Product {
  return {
    id: Number(row.id), slug: String(row.slug), name: String(row.name), shortDescription: String(row.short_description ?? ""),
    description: String(row.description ?? ""), priceCents: Number(row.price_cents), costCents: Number(row.cost_cents ?? 0), compareAtCents: row.compare_at_cents == null ? null : Number(row.compare_at_cents),
    currency: String(row.currency ?? "DZD"), status: String(row.status) as ProductStatus, category: String(row.category),
    badge: row.badge == null ? null : String(row.badge), color: String(row.color ?? ""), colors: parseJson<string[]>(row.colors_json, []), materials: String(row.materials ?? ""), care: String(row.care ?? ""),
    sourceUrl: row.source_url == null ? null : String(row.source_url), images: parseJson<string[]>(row.images_json, []),
    colorImages: parseJson<Record<string, string>>(row.color_images_json, {}),
    sizes: parseJson<ProductSize[]>(row.sizes_json, []), variants: parseJson<ProductVariant[]>(row.variants_json, []), features: parseJson<string[]>(row.features_json, []), testimonials: parseJson<ProductTestimonial[]>(row.testimonials_json, []),
    translations: parseJson<{ en?: ProductTranslation; ar?: ProductTranslation }>(row.translations_json, {}),
    sizeGuideImage: row.size_guide_image == null ? null : String(row.size_guide_image), seoTitle: row.seo_title == null ? null : String(row.seo_title),
    seoDescription: row.seo_description == null ? null : String(row.seo_description), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export function listProducts(includeUnpublished = false): Product[] {
  const sql = includeUnpublished ? "SELECT * FROM products ORDER BY updated_at DESC" : "SELECT * FROM products WHERE status='published' ORDER BY updated_at DESC";
  return (db.prepare(sql).all() as Row[]).map(mapProduct);
}

export function getProductBySlug(slug: string, includeUnpublished = false): Product | null {
  const row = db.prepare(`SELECT * FROM products WHERE slug=? ${includeUnpublished ? "" : "AND status='published'"}`).get(slug) as Row | undefined;
  return row ? mapProduct(row) : null;
}

export function getProductById(id: number): Product | null {
  const row = db.prepare("SELECT * FROM products WHERE id=?").get(id) as Row | undefined;
  return row ? mapProduct(row) : null;
}

export function deleteProduct(id: number): Product | null {
  const product = getProductById(id);
  if (!product) return null;
  const reservedOrders = db.prepare("SELECT items_json FROM orders WHERE stock_reserved=1").all() as Array<{ items_json: string }>;
  if (reservedOrders.some((row) => parseJson<OrderItem[]>(row.items_json, []).some((item) => item.productId === id))) {
    throw new Error("PRODUCT_HAS_RESERVED_ORDERS");
  }
  db.prepare("DELETE FROM products WHERE id=?").run(id);
  return product;
}

export function saveProduct(input: Partial<Product> & Pick<Product, "name" | "slug" | "priceCents">): Product {
  const current = input.id ? getProductById(input.id) : null;
  if (input.id && !current) throw new Error("PRODUCT_NOT_FOUND");
  const values = { id: input.id ?? null, slug: input.slug, name: input.name, short: input.shortDescription ?? current?.shortDescription ?? "",
    description: input.description ?? current?.description ?? "", price: input.priceCents, cost: input.costCents ?? current?.costCents ?? 0, compareAt: input.compareAtCents ?? null,
    currency: input.currency ?? "DZD", status: input.status ?? current?.status ?? "draft", category: input.category ?? current?.category ?? "Ensembles",
    badge: input.badge ?? null, color: input.color ?? current?.color ?? "", colors: JSON.stringify(input.colors ?? current?.colors ?? []), materials: input.materials ?? "", care: input.care ?? "", sourceUrl: input.sourceUrl ?? null,
    images: JSON.stringify(input.images ?? current?.images ?? []), colorImages: JSON.stringify(input.colorImages ?? current?.colorImages ?? {}), sizes: JSON.stringify(input.sizes ?? current?.sizes ?? []), variants: JSON.stringify(input.variants ?? current?.variants ?? []),
    features: JSON.stringify(input.features ?? current?.features ?? []), testimonials: JSON.stringify(input.testimonials ?? current?.testimonials ?? []), translations: JSON.stringify(input.translations ?? current?.translations ?? {}), sizeGuide: input.sizeGuideImage ?? current?.sizeGuideImage ?? null,
    seoTitle: input.seoTitle ?? input.name, seoDescription: input.seoDescription ?? input.shortDescription ?? "" };
  if (current) {
    db.prepare(`UPDATE products SET slug=@slug,name=@name,short_description=@short,description=@description,price_cents=@price,cost_cents=@cost,compare_at_cents=@compareAt,
      currency=@currency,status=@status,category=@category,badge=@badge,color=@color,colors_json=@colors,materials=@materials,care=@care,source_url=@sourceUrl,
      images_json=@images,color_images_json=@colorImages,sizes_json=@sizes,variants_json=@variants,features_json=@features,testimonials_json=@testimonials,translations_json=@translations,size_guide_image=@sizeGuide,seo_title=@seoTitle,seo_description=@seoDescription,
      updated_at=CURRENT_TIMESTAMP WHERE id=@id`).run(values);
    return getProductById(current.id)!;
  }
  const result = db.prepare(`INSERT INTO products (slug,name,short_description,description,price_cents,cost_cents,compare_at_cents,currency,status,category,badge,color,colors_json,
    materials,care,source_url,images_json,color_images_json,sizes_json,variants_json,features_json,testimonials_json,translations_json,size_guide_image,seo_title,seo_description)
    VALUES (@slug,@name,@short,@description,@price,@cost,@compareAt,@currency,@status,@category,@badge,@color,@colors,@materials,@care,@sourceUrl,@images,@colorImages,@sizes,@variants,@features,@testimonials,@translations,@sizeGuide,@seoTitle,@seoDescription)`).run(values);
  return getProductById(Number(result.lastInsertRowid))!;
}

function mapOrder(row: Row): Order {
  const customerName = String(row.customer_name);
  const nameParts = customerName.trim().split(/\s+/);
  return { id: Number(row.id), orderNumber: String(row.order_number), customerId: row.customer_id == null ? null : Number(row.customer_id),
    firstName: String(row.first_name ?? "") || nameParts[0] || "", lastName: String(row.last_name ?? "") || nameParts.slice(1).join(" "), customerName,
    phone: String(row.phone), city: String(row.city), wilayaCode: String(row.wilaya_code ?? ""), wilayaName: String(row.wilaya_name ?? row.city ?? ""), commune: String(row.commune ?? row.city ?? ""),
    address: String(row.address), deliveryType: (row.delivery_type === "office" ? "office" : "home") as DeliveryType,
    deliveryExternalId: row.delivery_external_id == null ? null : String(row.delivery_external_id),
    deliverySyncStatus: String(row.delivery_sync_status ?? "not_configured") as Order["deliverySyncStatus"],
    deliverySyncError: row.delivery_sync_error == null ? null : String(row.delivery_sync_error),
    notes: String(row.notes ?? ""), status: String(row.status) as OrderStatus, items: parseJson<OrderItem[]>(row.items_json, []),
    subtotalCents: Number(row.subtotal_cents), shippingCents: Number(row.shipping_cents), totalCents: Number(row.total_cents),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

export function listOrders(): Order[] { return (db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 250").all() as Row[]).map(mapOrder); }

export class StockUnavailableError extends Error {
  constructor() { super("STOCK_UNAVAILABLE"); }
}

function changeStock(items: OrderItem[], direction: -1 | 1): void {
  for (const item of items) {
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) throw new StockUnavailableError();
    const product = getProductById(item.productId);
    if (!product || (direction === -1 && product.status !== "published")) throw new StockUnavailableError();
    if (product.variants.length) {
      let variantIndex = product.variants.findIndex((variant) => variant.size === item.size && variant.color === (item.color ?? ""));
      if (variantIndex < 0 && direction === 1) {
        product.variants.push({ color: item.color ?? "", size: item.size, stock: 0 });
        variantIndex = product.variants.length - 1;
      }
      if (variantIndex < 0) throw new StockUnavailableError();
      const currentStock = Math.max(0, Math.floor(Number(product.variants[variantIndex].stock) || 0));
      if (direction === -1 && currentStock < quantity) throw new StockUnavailableError();
      product.variants[variantIndex] = { ...product.variants[variantIndex], stock: currentStock + direction * quantity };
      const sizes = aggregateVariantSizes(product.variants);
      db.prepare("UPDATE products SET variants_json=?,sizes_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(JSON.stringify(product.variants), JSON.stringify(sizes), product.id);
      continue;
    }
    let sizeIndex = product.sizes.findIndex((size) => size.label === item.size);
    if (sizeIndex < 0 && direction === 1) {
      product.sizes.push({ label: item.size, stock: 0 });
      sizeIndex = product.sizes.length - 1;
    }
    if (sizeIndex < 0) throw new StockUnavailableError();
    const currentStock = Math.max(0, Math.floor(Number(product.sizes[sizeIndex].stock) || 0));
    if (direction === -1 && currentStock < quantity) throw new StockUnavailableError();
    product.sizes[sizeIndex] = { ...product.sizes[sizeIndex], stock: currentStock + direction * quantity };
    db.prepare("UPDATE products SET sizes_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(JSON.stringify(product.sizes), product.id);
  }
}

function aggregateVariantSizes(variants: ProductVariant[]): ProductSize[] {
  const sizes = new Map<string, ProductSize>();
  for (const variant of variants) {
    const current = sizes.get(variant.size);
    if (current) current.stock += Math.max(0, Math.floor(Number(variant.stock) || 0));
    else sizes.set(variant.size, { label: variant.size, stock: Math.max(0, Math.floor(Number(variant.stock) || 0)), age: variant.age, weight: variant.weight, height: variant.height });
  }
  return [...sizes.values()];
}

type CreateOrderInput = {
  customerId: number | null;
  firstName: string;
  lastName: string;
  customerName: string;
  phone: string;
  city: string;
  wilayaCode: string;
  wilayaName: string;
  commune: string;
  address: string;
  deliveryType: DeliveryType;
  notes: string;
  items: OrderItem[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
};

export function createOrder(input: CreateOrderInput): Order {
  return db.transaction(() => {
    changeStock(input.items, -1);
    const orderNumber = `LS-${new Date().toISOString().slice(2,10).replaceAll("-","")}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const result = db.prepare(`INSERT INTO orders (order_number,customer_id,first_name,last_name,customer_name,phone,city,wilaya_code,wilaya_name,commune,address,delivery_type,notes,status,items_json,subtotal_cents,shipping_cents,total_cents,stock_reserved)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'new',?,?,?,?,1)`).run(orderNumber,input.customerId,input.firstName,input.lastName,input.customerName,input.phone,input.city,input.wilayaCode,input.wilayaName,input.commune,input.address,input.deliveryType,input.notes,JSON.stringify(input.items),input.subtotalCents,input.shippingCents,input.totalCents);
    return mapOrder(db.prepare("SELECT * FROM orders WHERE id=?").get(result.lastInsertRowid) as Row);
  })();
}

export function updateDeliverySync(id: number, patch: { status: Order["deliverySyncStatus"]; externalId?: string | null; error?: string | null }): void {
  db.prepare("UPDATE orders SET delivery_sync_status=?,delivery_external_id=?,delivery_sync_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .run(patch.status, patch.externalId ?? null, patch.error ?? null, id);
}

const stockReleasingStatuses = new Set<OrderStatus>(["refused", "returned", "cancelled"]);
export function updateOrderStatus(id: number, status: OrderStatus): "updated" | "not_found" | "stock_unavailable" {
  try {
    return db.transaction(() => {
      const row = db.prepare("SELECT * FROM orders WHERE id=?").get(id) as Row | undefined;
      if (!row) return "not_found" as const;
      const order = mapOrder(row);
      const stockReserved = Number(row.stock_reserved) === 1;
      const shouldReserve = !stockReleasingStatuses.has(status);
      if (stockReserved && !shouldReserve) changeStock(order.items, 1);
      if (!stockReserved && shouldReserve) changeStock(order.items, -1);
      db.prepare("UPDATE orders SET status=?,stock_reserved=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status, shouldReserve ? 1 : 0, id);
      return "updated" as const;
    })();
  } catch (error) {
    if (error instanceof StockUnavailableError) return "stock_unavailable";
    throw error;
  }
}
export function allowOrderAttempt(ip: string): boolean {
  db.prepare("DELETE FROM order_attempts WHERE created_at < datetime('now','-2 hours')").run();
  const count = Number((db.prepare("SELECT count(*) count FROM order_attempts WHERE ip=? AND created_at > datetime('now','-30 minutes')").get(ip) as { count: number }).count);
  if (count >= 8) return false;
  db.prepare("INSERT INTO order_attempts (ip) VALUES (?)").run(ip);
  return true;
}
export function createImportJob(sourceUrl: string): number { return Number(db.prepare("INSERT INTO import_jobs (source_url,status) VALUES (?,'queued')").run(sourceUrl).lastInsertRowid); }
export function updateImportJob(id: number, patch: { status: ImportJob["status"]; error?: string | null; extracted?: unknown; productId?: number | null }): void {
  db.prepare("UPDATE import_jobs SET status=@status,error=@error,extracted_json=@extracted,product_id=@productId,updated_at=CURRENT_TIMESTAMP WHERE id=@id").run({ id, status: patch.status, error: patch.error ?? null, extracted: patch.extracted ? JSON.stringify(patch.extracted) : null, productId: patch.productId ?? null });
}
export function listImportJobs(): ImportJob[] {
  return (db.prepare("SELECT * FROM import_jobs ORDER BY created_at DESC LIMIT 50").all() as Row[]).map((row) => ({ id: Number(row.id), sourceUrl: String(row.source_url), status: String(row.status) as ImportJob["status"], error: row.error == null ? null : String(row.error), productId: row.product_id == null ? null : Number(row.product_id), extracted: parseJson<Record<string, unknown> | null>(row.extracted_json, null), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }));
}

export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  announcement: {
    fr: "Paiement à la livraison · Confirmation par téléphone · Échange facile",
    en: "Cash on delivery · Phone confirmation · Easy exchange",
    ar: "الدفع عند الاستلام · تأكيد هاتفي · استبدال سهل",
  },
  heroEyebrow: { fr: "Nouvelle collection · 1 à 10 ans", en: "New collection · Ages 1–10", ar: "تشكيلة جديدة · من سنة إلى 10 سنوات" },
  heroTitle: { fr: "Des tenues faites pour leurs", en: "Outfits made for their", ar: "ملابس صُممت من أجل" },
  heroAccent: { fr: "plus beaux pas.", en: "loveliest steps.", ar: "أجمل خطواتهم." },
  heroDescription: {
    fr: "Douces, pratiques et pleines de charme. Commandez simplement et payez seulement à la livraison.",
    en: "Soft, practical and full of charm. Order simply and pay only when it arrives.",
    ar: "ناعمة وعملية ومليئة بالجمال. اطلبوا بسهولة وادفعوا فقط عند الاستلام.",
  },
  primaryCta: { fr: "Découvrir la collection", en: "Shop the collection", ar: "اكتشفوا التشكيلة" },
  storyTitle: { fr: "Leur confort d’abord. Votre sérénité aussi.", en: "Their comfort first. Your peace of mind too.", ar: "راحتهم أولاً، وراحة بالك أيضاً." },
  storyDescription: {
    fr: "Lovely Step choisit des vêtements agréables à porter, faciles à commander et présentés avec toutes les informations utiles pour choisir la bonne taille.",
    en: "Lovely Step selects comfortable clothes that are easy to order, with clear information to help you choose the right size.",
    ar: "تختار Lovely Step ملابس مريحة وسهلة الطلب مع كل المعلومات اللازمة لاختيار المقاس المناسب.",
  },
  heroImage: null,
  theme: { navy: "#1E416A", coral: "#EE5549", cream: "#FAEEE1", sand: "#DAAE8C", background: "#FFF9F2" },
};

function mergeStoreSettings(value: Partial<StoreSettings> | null): StoreSettings {
  if (!value) return DEFAULT_STORE_SETTINGS;
  const localized = (key: keyof Pick<StoreSettings, "announcement" | "heroEyebrow" | "heroTitle" | "heroAccent" | "heroDescription" | "primaryCta" | "storyTitle" | "storyDescription">) => ({
    ...DEFAULT_STORE_SETTINGS[key],
    ...(value[key] ?? {}),
  });
  return {
    announcement: localized("announcement"), heroEyebrow: localized("heroEyebrow"), heroTitle: localized("heroTitle"), heroAccent: localized("heroAccent"),
    heroDescription: localized("heroDescription"), primaryCta: localized("primaryCta"), storyTitle: localized("storyTitle"), storyDescription: localized("storyDescription"),
    heroImage: value.heroImage ?? null,
    theme: { ...DEFAULT_STORE_SETTINGS.theme, ...(value.theme ?? {}) },
  };
}

export function getStoreSettings(): StoreSettings {
  const row = db.prepare("SELECT value_json FROM app_settings WHERE setting_key='storefront'").get() as { value_json: string } | undefined;
  return mergeStoreSettings(row ? parseJson<Partial<StoreSettings>>(row.value_json, {}) : null);
}

export function saveStoreSettings(settings: StoreSettings): StoreSettings {
  db.prepare(`INSERT INTO app_settings (setting_key,value_json) VALUES ('storefront',?)
    ON CONFLICT(setting_key) DO UPDATE SET value_json=excluded.value_json,updated_at=CURRENT_TIMESTAMP`).run(JSON.stringify(settings));
  return getStoreSettings();
}

export function listDeliveryRates(): DeliveryRate[] {
  return (db.prepare("SELECT * FROM delivery_rates ORDER BY CAST(wilaya_code AS INTEGER)").all() as Row[]).map((row) => ({
    wilayaCode: String(row.wilaya_code), wilayaNameFr: String(row.wilaya_name_fr), wilayaNameAr: String(row.wilaya_name_ar ?? ""),
    homeCents: Number(row.home_cents), officeCents: Number(row.office_cents), active: Number(row.active) === 1,
  }));
}

export function getDeliveryRate(wilayaCode: string): DeliveryRate | null {
  return listDeliveryRates().find((rate) => rate.wilayaCode === wilayaCode.padStart(2, "0")) ?? null;
}

export function saveDeliveryRates(rates: DeliveryRate[]): DeliveryRate[] {
  const statement = db.prepare(`UPDATE delivery_rates SET home_cents=?,office_cents=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE wilaya_code=?`);
  db.transaction(() => {
    for (const rate of rates) statement.run(rate.homeCents, rate.officeCents, rate.active ? 1 : 0, rate.wilayaCode);
  })();
  return listDeliveryRates();
}

export const DEFAULT_DELIVERY_INTEGRATION: DeliveryIntegration = { enabled: false, providerName: "", baseUrl: "", createShipmentPath: "/shipments", apiTokenEnv: "DELIVERY_API_TOKEN" };

export function getDeliveryIntegration(): DeliveryIntegration {
  const row = db.prepare("SELECT value_json FROM app_settings WHERE setting_key='delivery_integration'").get() as { value_json: string } | undefined;
  return { ...DEFAULT_DELIVERY_INTEGRATION, ...(row ? parseJson<Partial<DeliveryIntegration>>(row.value_json, {}) : {}) };
}

export function saveDeliveryIntegration(integration: DeliveryIntegration): DeliveryIntegration {
  db.prepare(`INSERT INTO app_settings (setting_key,value_json) VALUES ('delivery_integration',?)
    ON CONFLICT(setting_key) DO UPDATE SET value_json=excluded.value_json,updated_at=CURRENT_TIMESTAMP`).run(JSON.stringify(integration));
  return getDeliveryIntegration();
}

function mapCustomer(row: Row): Customer {
  return { id: Number(row.id), firstName: String(row.first_name), lastName: String(row.last_name), phone: String(row.phone),
    wilayaCode: String(row.wilaya_code), wilayaName: String(row.wilaya_name), commune: String(row.commune), address: String(row.address ?? ""),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

export function getCustomerById(id: number): Customer | null {
  const row = db.prepare("SELECT * FROM customers WHERE id=?").get(id) as Row | undefined;
  return row ? mapCustomer(row) : null;
}

export function getCustomerCredentialsByPhone(phone: string): { customer: Customer; passwordHash: string } | null {
  const row = db.prepare("SELECT * FROM customers WHERE phone=?").get(phone) as Row | undefined;
  return row ? { customer: mapCustomer(row), passwordHash: String(row.password_hash) } : null;
}

export function createCustomer(input: Omit<Customer, "id" | "createdAt" | "updatedAt"> & { passwordHash: string }): Customer {
  const result = db.prepare(`INSERT INTO customers (first_name,last_name,phone,password_hash,wilaya_code,wilaya_name,commune,address)
    VALUES (?,?,?,?,?,?,?,?)`).run(input.firstName,input.lastName,input.phone,input.passwordHash,input.wilayaCode,input.wilayaName,input.commune,input.address);
  return getCustomerById(Number(result.lastInsertRowid))!;
}
export function dashboardStats() {
  const scalar = (sql: string) => Number((db.prepare(sql).get() as { count: number }).count);
  const delivered = (db.prepare("SELECT * FROM orders WHERE status='delivered'").all() as Row[]).map(mapOrder);
  const deliveredRevenueCents = delivered.reduce((sum, order) => sum + order.totalCents, 0);
  const productCosts = new Map(listProducts(true).map((product) => [product.id, product.costCents]));
  const deliveredCostCents = delivered.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + (item.unitCostCents ?? productCosts.get(item.productId) ?? 0) * item.quantity, 0), 0);
  const phoneCounts = new Map<string, number>();
  for (const order of delivered) {
    const phone = order.phone.replace(/\D/g, "");
    if (phone) phoneCounts.set(phone, (phoneCounts.get(phone) ?? 0) + 1);
  }
  const repeatBuyers = [...phoneCounts.values()].filter((count) => count > 1).length;
  const products = listProducts(true);
  const inventoryUnits = products.reduce((sum, product) => sum + (product.variants.length
    ? product.variants.reduce((variantSum, variant) => variantSum + Math.max(0, Math.floor(Number(variant.stock) || 0)), 0)
    : product.sizes.reduce((sizeSum, size) => sizeSum + Math.max(0, Math.floor(Number(size.stock) || 0)), 0)), 0);
  return {
    products: products.length,
    published: products.filter((product) => product.status === "published").length,
    newOrders: scalar("SELECT count(*) count FROM orders WHERE status IN ('new','to_confirm')"),
    orders: scalar("SELECT count(*) count FROM orders"),
    deliveredRevenueCents,
    grossProfitCents: deliveredRevenueCents - deliveredCostCents,
    visitors30d: scalar("SELECT count(DISTINCT visitor_hash) count FROM visits WHERE created_at >= datetime('now','-30 days')"),
    repeatBuyerRate: phoneCounts.size ? Math.round((repeatBuyers / phoneCounts.size) * 1000) / 10 : 0,
    inventoryUnits,
  };
}
export function recordVisit(visitorHash: string, visitPath: string, productId: number | null): void {
  db.prepare("INSERT OR IGNORE INTO visits (visitor_hash,path,product_id,visit_day) VALUES (?,?,?,date('now'))")
    .run(visitorHash, visitPath, productId);
}
export function audit(adminId: number | null, action: string, entityType?: string, entityId?: string, details?: unknown) {
  db.prepare("INSERT INTO audit_logs (admin_id,action,entity_type,entity_id,details_json) VALUES (?,?,?,?,?)").run(adminId,action,entityType ?? null,entityId ?? null,details ? JSON.stringify(details) : null);
}
