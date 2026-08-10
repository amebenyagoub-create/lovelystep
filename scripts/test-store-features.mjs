import Database from "better-sqlite3";
import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3105";
const databasePath = process.env.TEST_DATABASE_PATH;
if (!databasePath) throw new Error("TEST_DATABASE_PATH is required.");
const jsonHeaders = { "content-type": "application/json" };
const cookieFrom = (response) => response.headers.get("set-cookie")?.split(";")[0] || "";
const readJson = (response) => response.json().catch(() => ({}));

const email = "qa-store@lovelystep.local";
const password = "LovelyStep-Store-QA-2026!";
let response = await fetch(`${baseUrl}/api/admin/setup`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ email, password }) });
if (response.status === 409) response = await fetch(`${baseUrl}/api/admin/login`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ email, password }) });
if (!response.ok) throw new Error(`Admin auth failed: ${response.status}`);
const adminCookie = cookieFrom(response);

async function adminData() {
  const result = await fetch(`${baseUrl}/api/admin/data`, { headers: { cookie: adminCookie } });
  if (!result.ok) throw new Error(`Admin data failed: ${result.status}`);
  return result.json();
}

let data = await adminData();
if (data.deliveryRates.length !== 69) throw new Error(`Expected 69 delivery rates, received ${data.deliveryRates.length}`);
const csrf = data.csrfToken;
const timestamp = Date.now().toString(36);
const productResponse = await fetch(`${baseUrl}/api/admin/products`, { method: "POST", headers: { ...jsonHeaders, cookie: adminCookie, "x-csrf-token": csrf }, body: JSON.stringify({
  name: "Ensemble couleur QA", slug: `ensemble-couleur-qa-${timestamp}`, priceCents: 250000, costCents: 100000, status: "published", category: "QA",
  images: ["/images/soft-days.jpg", "/images/sunny-set.jpg"], colors: ["Crème", "Bleu"], colorImages: { "Crème": "/images/soft-days.jpg", "Bleu": "/images/sunny-set.jpg" },
  translations: { en: { name: "QA colour set", shortDescription: "English product copy" }, ar: { name: "طقم ألوان للاختبار", shortDescription: "وصف عربي للمنتج" } },
  variants: [{ color: "Crème", size: "80", stock: 3 }, { color: "Bleu", size: "80", stock: 4 }], features: [], testimonials: [],
}) });
const productResult = await readJson(productResponse);
if (!productResponse.ok || productResult.product.colorImages.Bleu !== "/images/sunny-set.jpg" || productResult.product.translations.en.name !== "QA colour set" || productResult.product.translations.ar.name !== "طقم ألوان للاختبار") throw new Error(productResult.error || "Colour image mapping or product translations failed.");

const settings = { ...data.storeSettings, heroTitle: { ...data.storeSettings.heroTitle, fr: "Façade QA personnalisée" }, theme: { ...data.storeSettings.theme, coral: "#EF5B50" } };
response = await fetch(`${baseUrl}/api/admin/store-settings`, { method: "POST", headers: { ...jsonHeaders, cookie: adminCookie, "x-csrf-token": csrf }, body: JSON.stringify(settings) });
if (!response.ok) throw new Error(`Store settings failed: ${response.status}`);

const rate16 = data.deliveryRates.find((rate) => rate.wilayaCode === "16");
if (!rate16) throw new Error("Wilaya 16 missing.");
response = await fetch(`${baseUrl}/api/admin/delivery`, { method: "POST", headers: { ...jsonHeaders, cookie: adminCookie, "x-csrf-token": csrf }, body: JSON.stringify({ rates: [{ ...rate16, homeCents: 60000, officeCents: 40000, active: true }] }) });
if (!response.ok) throw new Error(`Delivery settings failed: ${response.status}`);

const customerBody = { firstName: "Nadia", lastName: "Test", phone: "0550123456", password: "Client-QA-2026!", wilayaCode: "16", commune: "Alger Centre", address: "10 rue de test" };
response = await fetch(`${baseUrl}/api/account/register`, { method: "POST", headers: jsonHeaders, body: JSON.stringify(customerBody) });
const accountResult = await readJson(response);
if (!response.ok || accountResult.customer.phone !== "+213550123456") throw new Error(accountResult.error || "Account registration failed.");
const customerCookie = cookieFrom(response);
response = await fetch(`${baseUrl}/api/account/me`, { headers: { cookie: customerCookie } });
if (!response.ok || !(await response.json()).customer) throw new Error("Customer session failed.");

response = await fetch(`${baseUrl}/api/orders`, { method: "POST", headers: { ...jsonHeaders, cookie: customerCookie }, body: JSON.stringify({
  firstName: "Nadia", lastName: "Test", phone: "0550123456", wilayaCode: "16", commune: "Alger Centre", deliveryType: "home", address: "10 rue de test", notes: "QA",
  items: [{ productId: productResult.product.id, size: "80", color: "Bleu", quantity: 2 }],
}) });
const orderResult = await readJson(response);
if (response.status !== 201 || orderResult.totalCents !== 560000) throw new Error(orderResult.error || `Order total failed: ${response.status}`);

data = await adminData();
const order = data.orders.find((item) => item.orderNumber === orderResult.orderNumber);
if (!order || order.customerId !== accountResult.customer.id || order.wilayaCode !== "16" || order.commune !== "Alger Centre" || order.deliveryType !== "home" || order.shippingCents !== 60000 || order.items[0].image !== "/images/sunny-set.jpg") throw new Error("Saved order fields are incomplete.");

response = await fetch(`${baseUrl}/api/admin/orders/export`, { headers: { cookie: adminCookie } });
const workbook = Buffer.from(await response.arrayBuffer());
if (!response.ok || response.headers.get("content-type") !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || workbook.subarray(0, 2).toString() !== "PK") throw new Error("Excel export failed.");
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/commandes-lovelystep-test.xlsx", workbook);

const storefront = await fetch(`${baseUrl}/`).then((result) => result.text());
if (!storefront.includes("Façade QA personnalisée") || !storefront.includes("Ensemble couleur QA")) throw new Error("Customized storefront is not rendered.");

const database = new Database(databasePath, { readonly: true });
const customerCount = database.prepare("SELECT count(*) count FROM customers").get().count;
const savedOrder = database.prepare("SELECT wilaya_code,commune,delivery_type,shipping_cents FROM orders WHERE order_number=?").get(orderResult.orderNumber);
database.close();
if (customerCount !== 1 || savedOrder.shipping_cents !== 60000) throw new Error("Database verification failed.");

console.log(JSON.stringify({ ok: true, wilayas: data.deliveryRates.length, colorImageSwitch: true, productTranslations: true, storefrontCustomization: true, customerAccount: true, cascadingAddress: true, deliveryPricing: true, excelExportBytes: workbook.length, orderNumber: orderResult.orderNumber, productSlug: productResult.product.slug }, null, 2));
