import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import sharp from "sharp";

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3102";
const sourcePath = process.env.TEST_PRODUCT_IMAGE_PATH;
if (!sourcePath) throw new Error("TEST_PRODUCT_IMAGE_PATH is required.");

const email = "qa-ai@lovelystep.local";
const password = "LovelyStep-AI-QA-2026!";

function cookieFrom(response) {
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}

async function authenticate() {
  const credentials = JSON.stringify({ email, password });
  let response = await fetch(`${baseUrl}/api/admin/setup`, { method: "POST", headers: { "content-type": "application/json" }, body: credentials });
  if (response.status === 409) response = await fetch(`${baseUrl}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: credentials });
  if (!response.ok) throw new Error(`Authentication failed: ${response.status}`);
  return cookieFrom(response);
}

const cookie = await authenticate();
const adminResponse = await fetch(`${baseUrl}/api/admin/data`, { headers: { cookie } });
if (!adminResponse.ok) throw new Error(`Admin data failed: ${adminResponse.status}`);
const adminData = await adminResponse.json();

const source = await readFile(sourcePath);
const extension = extname(sourcePath).toLowerCase();
const type = extension === ".webp" ? "image/webp" : extension === ".png" ? "image/png" : "image/jpeg";
const upload = new FormData();
upload.append("images", new Blob([source], { type }), basename(sourcePath));
const uploadResponse = await fetch(`${baseUrl}/api/admin/uploads`, { method: "POST", headers: { cookie, "x-csrf-token": adminData.csrfToken }, body: upload });
const uploadResult = await uploadResponse.json();
if (!uploadResponse.ok || !uploadResult.images?.[0]) throw new Error(String(uploadResult.error || "Upload failed."));

const brandedResponse = await fetch(`${baseUrl}${uploadResult.images[0]}`);
if (!brandedResponse.ok) throw new Error("Branded image is not readable.");
const brandedBuffer = Buffer.from(await brandedResponse.arrayBuffer());
const brandedMetadata = await sharp(brandedBuffer).metadata();
if (brandedMetadata.width !== 1080 || brandedMetadata.height !== 1350) throw new Error("Branded image dimensions are invalid.");

const timestamp = Date.now().toString(36);
const productResponse = await fetch(`${baseUrl}/api/admin/products`, {
  method: "POST",
  headers: { cookie, "content-type": "application/json", "x-csrf-token": adminData.csrfToken },
  body: JSON.stringify({ name: "Test local overlay", slug: `test-local-overlay-${timestamp}`, priceCents: 0, currency: "DZD", status: "draft", category: "Test", images: uploadResult.images, sizes: [{ label: "80", stock: 1, age: "9-12 mois", weight: "9-11 kg", height: "70-80 cm" }], colors: ["Crème"], testimonials: [], features: [] }),
});
const productResult = await productResponse.json();
if (!productResponse.ok) throw new Error(String(productResult.error || "Test product creation failed."));

const guideResponse = await fetch(`${baseUrl}/api/admin/products/${productResult.product.id}/size-guide`, { method: "POST", headers: { cookie, "x-csrf-token": adminData.csrfToken } });
const guideResult = await guideResponse.json();
if (!guideResponse.ok) throw new Error(String(guideResult.error || "Guide generation failed."));
const guideImageResponse = await fetch(`${baseUrl}${guideResult.image}`);
const guideBuffer = Buffer.from(await guideImageResponse.arrayBuffer());
const guideMetadata = await sharp(guideBuffer).metadata();
const guideStats = await sharp(guideBuffer).stats();
if (guideMetadata.width !== 1080 || guideMetadata.height !== 1350 || guideStats.entropy < 1) throw new Error("Generated guide is blank or invalid.");

console.log(JSON.stringify({ ok: true, brandedImage: uploadResult.images[0], brandedDimensions: [brandedMetadata.width, brandedMetadata.height], guideImage: guideResult.image, guideDimensions: [guideMetadata.width, guideMetadata.height], guideEntropy: Number(guideStats.entropy.toFixed(2)), externalAiUsed: false }, null, 2));
