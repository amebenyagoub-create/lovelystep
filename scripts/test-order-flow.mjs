import Database from "better-sqlite3";

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3104";
const databasePath = process.env.TEST_DATABASE_PATH;
if (!databasePath) throw new Error("TEST_DATABASE_PATH is required.");

const email = "qa-orders@lovelystep.local";
const password = "LovelyStep-Orders-QA-2026!";
const jsonHeaders = { "content-type": "application/json" };

function cookieFrom(response) {
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}

async function json(response) {
  return await response.json().catch(() => ({}));
}

let authResponse = await fetch(`${baseUrl}/api/admin/setup`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ email, password }) });
if (authResponse.status === 409) authResponse = await fetch(`${baseUrl}/api/admin/login`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ email, password }) });
if (!authResponse.ok) throw new Error(`Authentication failed: ${authResponse.status}`);
const cookie = cookieFrom(authResponse);

async function adminData() {
  const response = await fetch(`${baseUrl}/api/admin/data`, { headers: { cookie } });
  if (!response.ok) throw new Error(`Admin data failed: ${response.status}`);
  return await response.json();
}

let data = await adminData();
const initialInventory = data.stats.inventoryUnits;
const timestamp = Date.now().toString(36);
const productResponse = await fetch(`${baseUrl}/api/admin/products`, {
  method: "POST",
  headers: { ...jsonHeaders, cookie, "x-csrf-token": data.csrfToken },
  body: JSON.stringify({
    name: "Produit QA variantes",
    slug: `produit-qa-variantes-${timestamp}`,
    priceCents: 250000,
    costCents: 100000,
    status: "published",
    category: "QA",
    images: ["/images/soft-days.jpg"],
    colors: ["Crème", "Marine"],
    variants: [
      { color: "Crème", size: "80", stock: 3, age: "8-11 mois" },
      { color: "Marine", size: "80", stock: 5, age: "8-11 mois" },
    ],
    features: [],
    testimonials: [],
  }),
});
const productResult = await json(productResponse);
if (!productResponse.ok) throw new Error(String(productResult.error || `Product creation failed: ${productResponse.status}`));
const productId = productResult.product.id;

const storefront = await fetch(`${baseUrl}/`);
const storefrontText = await storefront.text();
if (!storefront.ok || storefrontText.includes("costCents") || storefrontText.includes("unitCostCents")) throw new Error("Private cost leaked into the public storefront payload.");

const firstVisit = await fetch(`${baseUrl}/api/analytics/visit`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ path: "/" }) });
const visitorCookie = cookieFrom(firstVisit);
const secondVisit = await fetch(`${baseUrl}/api/analytics/visit`, { method: "POST", headers: { ...jsonHeaders, cookie: visitorCookie }, body: JSON.stringify({ path: `/produits/${productResult.product.slug}`, productId }) });
if (!firstVisit.ok || !secondVisit.ok) throw new Error("Visitor tracking failed.");

const orderBody = (items) => JSON.stringify({ firstName: "Client", lastName: "QA", phone: "0550123456", wilayaCode: "16", commune: "Alger Centre", deliveryType: "home", address: "10 rue de test", notes: "", items });
const invalidQuantity = await fetch(`${baseUrl}/api/orders`, { method: "POST", headers: jsonHeaders, body: orderBody([{ productId, size: "80", color: "Crème", quantity: 1.5 }]) });
if (invalidQuantity.status !== 400) throw new Error(`Fractional quantity should fail with 400, received ${invalidQuantity.status}`);

const duplicateOverstock = await fetch(`${baseUrl}/api/orders`, { method: "POST", headers: jsonHeaders, body: orderBody([{ productId, size: "80", color: "Crème", quantity: 2 }, { productId, size: "80", color: "Crème", quantity: 2 }]) });
if (duplicateOverstock.status !== 409) throw new Error(`Combined overstock should fail with 409, received ${duplicateOverstock.status}`);

async function placeOrder(color, quantity) {
  const response = await fetch(`${baseUrl}/api/orders`, { method: "POST", headers: jsonHeaders, body: orderBody([{ productId, size: "80", color, quantity }]) });
  const result = await json(response);
  if (response.status !== 201) throw new Error(String(result.error || `Order failed: ${response.status}`));
  return result;
}

async function setStatus(orderId, status) {
  data = await adminData();
  return await fetch(`${baseUrl}/api/admin/orders`, { method: "PATCH", headers: { ...jsonHeaders, cookie, "x-csrf-token": data.csrfToken }, body: JSON.stringify({ id: orderId, status }) });
}

const firstOrderResult = await placeOrder("Crème", 2);
data = await adminData();
const firstOrder = data.orders.find((item) => item.orderNumber === firstOrderResult.orderNumber);
let product = data.products.find((item) => item.id === productId);
const creamStock = () => product?.variants.find((variant) => variant.color === "Crème" && variant.size === "80")?.stock;
const marineStock = () => product?.variants.find((variant) => variant.color === "Marine" && variant.size === "80")?.stock;
if (!firstOrder || creamStock() !== 1 || marineStock() !== 5) throw new Error("The order did not reserve stock only from the selected color.");
if (firstOrder.items[0].unitCostCents !== 100000) throw new Error("The private unit cost was not snapshotted in the order.");

if (!(await setStatus(firstOrder.id, "cancelled")).ok) throw new Error("Cancellation failed.");
data = await adminData();
product = data.products.find((item) => item.id === productId);
if (creamStock() !== 3 || marineStock() !== 5) throw new Error("Cancellation did not restore the selected color stock.");

if (!(await setStatus(firstOrder.id, "confirmed")).ok) throw new Error("Reactivation failed.");
if (!(await setStatus(firstOrder.id, "delivered")).ok) throw new Error("Delivery status failed.");
const secondOrderResult = await placeOrder("Marine", 1);
data = await adminData();
const secondOrder = data.orders.find((item) => item.orderNumber === secondOrderResult.orderNumber);
if (!secondOrder || !(await setStatus(secondOrder.id, "delivered")).ok) throw new Error("Second delivery failed.");

data = await adminData();
product = data.products.find((item) => item.id === productId);
if (creamStock() !== 1 || marineStock() !== 4) throw new Error("Variant inventory is inconsistent after two delivered orders.");
if (data.stats.deliveredRevenueCents !== 750000 || data.stats.grossProfitCents !== 450000) throw new Error("Delivered revenue or gross profit is incorrect.");
if (data.stats.repeatBuyerRate !== 100 || data.stats.visitors30d !== 1) throw new Error("Repeat buyer rate or visitor KPI is incorrect.");
if (data.stats.inventoryUnits !== initialInventory + 5) throw new Error("Inventory KPI is incorrect.");

const blockedDelete = await fetch(`${baseUrl}/api/admin/products`, { method: "DELETE", headers: { ...jsonHeaders, cookie, "x-csrf-token": data.csrfToken }, body: JSON.stringify({ id: productId }) });
if (blockedDelete.status !== 409) throw new Error("Deleting a product tied to reserved orders should be blocked.");

const draftResponse = await fetch(`${baseUrl}/api/admin/products`, {
  method: "POST",
  headers: { ...jsonHeaders, cookie, "x-csrf-token": data.csrfToken },
  body: JSON.stringify({ name: "Brouillon QA suppression", slug: `brouillon-qa-${timestamp}`, priceCents: 0, costCents: 0, status: "draft", colors: [], sizes: [], variants: [], images: [] }),
});
const draftResult = await json(draftResponse);
if (!draftResponse.ok) throw new Error(String(draftResult.error || "Draft creation failed."));
data = await adminData();
const deleteDraft = await fetch(`${baseUrl}/api/admin/products`, { method: "DELETE", headers: { ...jsonHeaders, cookie, "x-csrf-token": data.csrfToken }, body: JSON.stringify({ id: draftResult.product.id }) });
if (!deleteDraft.ok) throw new Error("Draft deletion failed.");

data = await adminData();
const missingOrder = await fetch(`${baseUrl}/api/admin/orders`, { method: "PATCH", headers: { ...jsonHeaders, cookie, "x-csrf-token": data.csrfToken }, body: JSON.stringify({ id: 99999999, status: "confirmed" }) });
if (missingOrder.status !== 404) throw new Error(`Missing order should fail with 404, received ${missingOrder.status}`);

const database = new Database(databasePath);
database.prepare("UPDATE admin_sessions SET expires_at=?").run("2000-01-01T00:00:00.000Z");
database.close();
const expiredSession = await fetch(`${baseUrl}/api/admin/data`, { headers: { cookie } });
if (expiredSession.status !== 401) throw new Error(`Expired session should fail with 401, received ${expiredSession.status}`);

console.log(JSON.stringify({
  ok: true,
  colorSpecificStock: true,
  privateCostProtected: true,
  deliveredRevenueCents: 750000,
  grossProfitCents: 450000,
  visitorTracking: true,
  repeatBuyerRate: 100,
  inventoryKpi: true,
  safeProductDeletion: true,
  expiredSessionRejected: true,
}, null, 2));
