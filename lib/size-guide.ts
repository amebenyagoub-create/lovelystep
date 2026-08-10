import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { db, getProductById } from "./db";
import { frenchAgeLabel } from "./product-size";

const NAVY = "#1E416A";
const CORAL = "#EE5549";
const CREAM = "#FAEEE1";

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

async function storedImagePath(source: string): Promise<string | null> {
  const filename = source.split("/").at(-1) || "";
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) return null;
  const candidates = source.startsWith("/api/media/products/") || source.startsWith("/uploads/products/")
    ? [path.join(process.cwd(), "public", "uploads", "originals", filename), path.join(process.cwd(), "public", "uploads", "products", filename)]
    : source.startsWith("/api/media/imports/") || source.startsWith("/uploads/imports/")
      ? [path.join(process.cwd(), "public", "uploads", "imports", filename)]
      : source.startsWith("/images/") ? [path.join(process.cwd(), "public", "images", filename)] : [];
  for (const candidate of candidates) {
    try { await fs.access(candidate); return candidate; } catch { /* Try the next safe local candidate. */ }
  }
  return null;
}

async function transparentLogo(logoPath: string): Promise<Buffer> {
  const { data, info } = await sharp(logoPath).trim({ threshold: 8 }).ensureAlpha().resize(245, 245, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).raw().toBuffer({ resolveWithObject: true });
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    if (red > 238 && green > 226 && blue > 210 && Math.max(red, green, blue) - Math.min(red, green, blue) < 38) data[index + 3] = 0;
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

export async function generateSizeGuide(productId: number): Promise<string> {
  const product = getProductById(productId);
  if (!product) throw new Error("Produit introuvable.");
  if (!product.sizes.length) throw new Error("Ajoutez au moins une taille avant de générer le guide.");

  const sourceImage = product.images.find((image) => image !== product.sizeGuideImage && !image.includes("/size-guides/"));
  const imagePath = sourceImage ? await storedImagePath(sourceImage) : null;
  if (!imagePath) throw new Error("Ajoutez une photo produit originale avant de générer le guide.");
  let hero: Buffer;
  try {
    hero = await sharp(imagePath, { failOn: "error" }).rotate().flatten({ background: CREAM })
      .resize(1080, 840, { fit: "contain", background: CREAM, withoutEnlargement: false })
      .jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  } catch {
    throw new Error("La photo de couverture est introuvable ou illisible. Réimportez-la puis recommencez.");
  }

  const rows = product.sizes.slice(0, 6);
  const rowHeight = 54;
  const rowSvg = rows.map((size, index) => {
    const y = 1030 + index * rowHeight;
    return `<line x1="300" y1="${y + 22}" x2="780" y2="${y + 22}" stroke="${NAVY}" stroke-width="1.5" opacity=".65"/>
      <text x="540" y="${y}" class="size coral">${xml(frenchAgeLabel(size))}</text>`;
  }).join("");

  const overlay = Buffer.from(`<svg width="1080" height="1350" xmlns="http://www.w3.org/2000/svg">
    <style>
      .title{font:700 48px Arial,sans-serif;fill:${NAVY}} .head{font:700 23px Arial,sans-serif;fill:${NAVY}}
      .cell{font:700 22px Arial,sans-serif;fill:${NAVY};text-anchor:middle}.size{font:700 25px Arial,sans-serif;text-anchor:middle}.coral{fill:${CORAL}}
    </style>
    <rect x="24" y="20" width="275" height="275" rx="28" fill="${CREAM}"/>
    <path d="M690 82 H930 Q1000 82 1000 155 V780" fill="none" stroke="${NAVY}" stroke-width="9" stroke-linecap="round"/>
    <path d="M0 820 C135 750 205 825 205 930 C205 1020 120 1070 160 1190 C182 1260 120 1315 0 1350 Z" fill="${CORAL}"/>
    <path d="M110 780 C250 740 365 770 500 782 C660 796 760 760 930 792 L990 810 V1350 H78 C110 1280 96 1180 85 1090 C70 970 62 860 110 780 Z" fill="${CREAM}"/>
    <text x="540" y="900" class="title" text-anchor="middle">Guide des âges</text>
    <text x="540" y="980" class="head" text-anchor="middle">Âge conseillé</text>
    <line x1="300" y1="1000" x2="780" y2="1000" stroke="${NAVY}" stroke-width="2"/>
    ${rowSvg}
  </svg>`);

  const logoPath = path.join(process.cwd(), "public", "brand", "lovelystep-logo.png");
  const logo = await transparentLogo(logoPath);
  const outputDir = path.join(process.cwd(), "public", "generated", "size-guides");
  await fs.mkdir(outputDir, { recursive: true });
  const filename = `${product.slug}-${Date.now().toString(36)}.png`;
  const publicPath = `/api/media/size-guides/${filename}`;
  const outputPath = path.join(outputDir, filename);
  await sharp({ create: { width: 1080, height: 1350, channels: 3, background: CREAM } })
    .composite([{ input: hero, top: 0, left: 0 }, { input: overlay, top: 0, left: 0 }, { input: logo, top: 28, left: 34 }])
    .png({ compressionLevel: 9 }).toFile(outputPath);

  const images = [...new Set([...product.images.filter((image) => image !== product.sizeGuideImage), publicPath])];
  db.prepare("UPDATE products SET size_guide_image=?,images_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(publicPath, JSON.stringify(images), product.id);
  return publicPath;
}
