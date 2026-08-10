import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3102";
const provider = process.env.TEST_AI_PROVIDER || "auto";
const email = "qa-ai@lovelystep.local";
const password = "LovelyStep-AI-QA-2026!";

async function makeFixture() {
  const svg = `<svg width="1200" height="1500" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="1500" fill="#fffaf4"/><rect x="50" y="50" width="1100" height="1400" rx="30" fill="white" stroke="#1e416a" stroke-width="5"/><text x="100" y="140" font-family="Arial" font-size="58" font-weight="bold" fill="#1e416a">1688 PRODUCT LISTING</text><text x="100" y="235" font-family="Arial" font-size="48" fill="#ee5549">Kids Cotton Bear Set</text><text x="100" y="330" font-family="Arial" font-size="37" fill="#181716">Supplier price: RMB 39.00</text><text x="100" y="390" font-family="Arial" font-size="37" fill="#181716">MOQ: 2 pieces</text><text x="100" y="450" font-family="Arial" font-size="37" fill="#181716">Material: 95% cotton, 5% elastane</text><text x="100" y="540" font-family="Arial" font-size="44" font-weight="bold" fill="#1e416a">SIZE CHART</text><text x="100" y="620" font-family="Arial" font-size="34" fill="#181716">80 | age 9-12 months | 9-11 kg | 70-80 cm</text><text x="100" y="685" font-family="Arial" font-size="34" fill="#181716">90 | age 12-18 months | 11-13 kg | 80-90 cm</text><text x="100" y="750" font-family="Arial" font-size="34" fill="#181716">100 | age 18-24 months | 13-15 kg | 90-100 cm</text><text x="100" y="850" font-family="Arial" font-size="35" fill="#181716">Colors: cream and navy</text><text x="100" y="910" font-family="Arial" font-size="35" fill="#181716">Care: gentle wash at 30 C</text><text x="100" y="995" font-family="Arial" font-size="38" font-weight="bold" fill="#1e416a">CUSTOMER TESTIMONIALS</text><text x="100" y="1055" font-family="Arial" font-size="31" fill="#181716">5/5 - Nadia: Soft fabric and accurate sizing.</text><text x="100" y="1110" font-family="Arial" font-size="31" fill="#181716">4/5 - Amel: Beautiful colors, arrived as pictured.</text><rect x="360" y="1180" width="480" height="200" rx="60" fill="#daae8c"/><circle cx="600" cy="1240" r="45" fill="#ee5549"/><path d="M480 1330 Q600 1210 720 1330" fill="none" stroke="#1e416a" stroke-width="35"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

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
const dataResponse = await fetch(`${baseUrl}/api/admin/data`, { headers: { cookie } });
if (!dataResponse.ok) throw new Error(`Admin data failed: ${dataResponse.status}`);
const adminData = await dataResponse.json();
const image = await makeFixture();
const externalProductPath = process.env.TEST_PRODUCT_IMAGE_PATH;
const productImage = externalProductPath ? await readFile(externalProductPath) : image;
const productImageType = externalProductPath && extname(externalProductPath).toLowerCase() === ".webp" ? "image/webp" : "image/png";
const form = new FormData();
form.set("provider", provider);
form.append("screenshots", new Blob([image], { type: "image/png" }), "1688-fixture.png");
form.append("productImages", new Blob([productImage], { type: productImageType }), externalProductPath ? "original-product.webp" : "product-fixture.png");
const importResponse = await fetch(`${baseUrl}/api/admin/ai-import`, { method: "POST", headers: { cookie, "x-csrf-token": adminData.csrfToken }, body: form });
const result = await importResponse.json();
if (!importResponse.ok) throw new Error(String(result.error || `Import failed: ${importResponse.status}`));
if (result.product.status !== "draft" || !result.product.images?.length || !result.product.name || !result.product.colors?.length || !result.product.testimonials?.length) throw new Error("The imported draft is incomplete.");

const uploadForm = new FormData();
uploadForm.append("images", new Blob([image], { type: "image/png" }), "drag-drop-fixture.png");
const uploadResponse = await fetch(`${baseUrl}/api/admin/uploads`, {
  method: "POST",
  headers: { cookie, "x-csrf-token": adminData.csrfToken },
  body: uploadForm,
});
const uploadResult = await uploadResponse.json();
if (!uploadResponse.ok || !uploadResult.images?.[0]?.startsWith("/api/media/products/")) {
  throw new Error(String(uploadResult.error || `Direct upload failed: ${uploadResponse.status}`));
}

const storedImageResponse = await fetch(`${baseUrl}${uploadResult.images[0]}`);
if (!storedImageResponse.ok || !String(storedImageResponse.headers.get("content-type")).startsWith("image/")) throw new Error("The dynamically stored product image is not publicly readable.");
const brandedBuffer = Buffer.from(await storedImageResponse.arrayBuffer());
const brandedMetadata = await sharp(brandedBuffer).metadata();
if (brandedMetadata.width !== 1080 || brandedMetadata.height !== 1350) throw new Error("The branded product image does not use the expected 1080x1350 format.");

const guideResponse = await fetch(`${baseUrl}/api/admin/products/${result.product.id}/size-guide`, { method: "POST", headers: { cookie, "x-csrf-token": adminData.csrfToken } });
const guideResult = await guideResponse.json();
if (!guideResponse.ok || !guideResult.image?.startsWith("/api/media/size-guides/")) throw new Error(String(guideResult.error || "Size-guide generation failed."));
const guideImageResponse = await fetch(`${baseUrl}${guideResult.image}`);
if (!guideImageResponse.ok) throw new Error("The generated size guide is not publicly readable.");
const guideBuffer = Buffer.from(await guideImageResponse.arrayBuffer());
const guideMetadata = await sharp(guideBuffer).metadata();
const guideStats = await sharp(guideBuffer).stats();
if (guideMetadata.width !== 1080 || guideMetadata.height !== 1350 || guideStats.entropy < 1) throw new Error("The generated size guide appears blank or has invalid dimensions.");

console.log(JSON.stringify({ ok: true, requestedProvider: provider, usedProvider: result.provider, draftName: result.product.name, sizes: result.product.sizes.length, colors: result.product.colors.length, testimonials: result.product.testimonials.length, importedImages: result.product.images.length, originalProductPhotoUsed: Boolean(externalProductPath), directUpload: true, brandedProductImage: { width: brandedMetadata.width, height: brandedMetadata.height }, overlayImage: { width: guideMetadata.width, height: guideMetadata.height, entropy: Number(guideStats.entropy.toFixed(2)) }, warnings: result.warnings.length }, null, 2));
