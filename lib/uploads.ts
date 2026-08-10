import "server-only";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { removeImageBackgrounds } from "@/lib/background-removal";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const PRODUCT_WIDTH = 1080;
const PRODUCT_HEIGHT = 1350;
const CREAM = "#FAEEE1";
const PRODUCT_BOX = { width: 820, height: 760, left: 130, top: 355 } as const;
let overlayTemplate: Promise<Buffer> | null = null;

async function getTransparentBrandLogo(): Promise<Buffer> {
  const logoPath = path.join(process.cwd(), "public", "brand", "lovelystep-logo.png");
  const { data, info } = await sharp(logoPath, { failOn: "error" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    if (red > 238 && green > 226 && blue > 210 && Math.max(red, green, blue) - Math.min(red, green, blue) < 38) {
      data[index + 3] = 0;
    }
  }
  return sharp(data, { raw: info })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
    .resize(320, 320, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function getProductOverlay(): Promise<Buffer> {
  if (overlayTemplate) return overlayTemplate;
  overlayTemplate = (async () => {
    const overlayPath = path.join(process.cwd(), "app", "overlay.jpeg");
    const { data, info } = await sharp(overlayPath, { failOn: "error" }).resize(PRODUCT_WIDTH, PRODUCT_HEIGHT, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let index = 0; index < data.length; index += 4) {
      const brightness = Math.max(data[index], data[index + 1], data[index + 2]);
      if (brightness <= 24) data[index + 3] = 0;
      else if (brightness < 64) data[index + 3] = Math.round(((brightness - 24) / 40) * 255);
      const pixel = index / 4;
      const x = pixel % PRODUCT_WIDTH;
      const y = Math.floor(pixel / PRODUCT_WIDTH);
      if (x < 480 && y < 420) data[index + 3] = 0;
    }
    const frame = await sharp(data, { raw: info }).png({ compressionLevel: 9 }).toBuffer();
    const logo = await getTransparentBrandLogo();
    return sharp({ create: { width: PRODUCT_WIDTH, height: PRODUCT_HEIGHT, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: frame }, { input: logo, left: 48, top: 34 }])
      .png({ compressionLevel: 9 })
      .toBuffer();
  })();
  return overlayTemplate;
}

async function normalizeProductCutout(cutout: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(cutout, { failOn: "error" }).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let index = 3; index < data.length; index += 4) {
    const alpha = data[index];
    if (alpha <= 36) data[index] = 0;
    else if (alpha >= 220) data[index] = 255;
    else data[index] = Math.round(((alpha - 36) / 184) * 255);
  }
  const cleaned = await sharp(data, { raw: info })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 10 })
    .png()
    .toBuffer();
  return sharp(cleaned)
    .resize(PRODUCT_BOX.width, PRODUCT_BOX.height, {
      fit: "contain",
      position: "centre",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3,
    })
    .sharpen({ sigma: 0.55, m1: 0.8, m2: 1.5 })
    .png()
    .toBuffer();
}

function assertImage(file: File): void {
  if (!IMAGE_TYPES.has(file.type)) throw new Error(`${file.name || "Image"} : format non accepté.`);
  if (file.size < 1 || file.size > MAX_FILE_BYTES) throw new Error(`${file.name || "Image"} : taille maximale 15 Mo.`);
}

export async function saveProductImages(files: File[]): Promise<string[]> {
  if (!files.length) return [];
  if (files.length > 12) throw new Error("Maximum 12 images par envoi.");
  if (files.reduce((total, file) => total + file.size, 0) > 80 * 1024 * 1024) throw new Error("Envoi trop volumineux. Maximum 80 Mo au total.");
  const outputDirectory = path.join(process.cwd(), "public", "uploads", "products");
  const originalDirectory = path.join(process.cwd(), "public", "uploads", "originals");
  const sourceDirectory = path.join(process.cwd(), "public", "uploads", "sources");
  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.mkdir(originalDirectory, { recursive: true });
  await fs.mkdir(sourceDirectory, { recursive: true });
  const overlay = await getProductOverlay();
  const sourceImages: Buffer[] = [];
  for (const file of files) {
    assertImage(file);
    const uploaded = Buffer.from(await file.arrayBuffer());
    sourceImages.push(await sharp(uploaded, { failOn: "error", limitInputPixels: 80_000_000 }).rotate().resize({ width: 2200, height: 2200, fit: "inside", withoutEnlargement: true }).png().toBuffer());
  }
  const cutouts = await removeImageBackgrounds(sourceImages);
  const output: string[] = [];
  try {
    for (const [index, cutout] of cutouts.entries()) {
      const filename = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString("hex")}.webp`;
      output.push(`/api/media/products/${filename}`);
      const product = await normalizeProductCutout(cutout);
      const original = await sharp({ create: { width: PRODUCT_WIDTH, height: PRODUCT_HEIGHT, channels: 3, background: CREAM } })
        .composite([{ input: product, blend: "over", left: PRODUCT_BOX.left, top: PRODUCT_BOX.top }])
        .webp({ quality: 94, effort: 4 })
        .toBuffer();
      await sharp(sourceImages[index]).webp({ quality: 95, effort: 4 }).toFile(path.join(sourceDirectory, filename));
      await fs.writeFile(path.join(originalDirectory, filename), original);
      await sharp(original).composite([{ input: overlay, blend: "over" }]).webp({ quality: 94, effort: 4 }).toFile(path.join(outputDirectory, filename));
    }
  } catch (error) {
    await deleteProductImages(output);
    throw error;
  }
  return output;
}

export async function deleteProductImages(images: string[]): Promise<void> {
  const filenames = images.flatMap((image) => {
    const match = /^\/api\/media\/products\/([a-zA-Z0-9._-]+)$/.exec(image);
    return match ? [match[1]] : [];
  });
  await Promise.all(filenames.flatMap((filename) => [
    fs.unlink(path.join(process.cwd(), "public", "uploads", "products", filename)).catch(() => undefined),
    fs.unlink(path.join(process.cwd(), "public", "uploads", "originals", filename)).catch(() => undefined),
    fs.unlink(path.join(process.cwd(), "public", "uploads", "sources", filename)).catch(() => undefined),
  ]));
}

export type EvidenceImage = { data: Buffer; mimeType: "image/jpeg"; sourceName: string };

async function normalizeEvidence(file: File, availableSlots: number): Promise<EvidenceImage[]> {
  assertImage(file);
  const input = Buffer.from(await file.arrayBuffer());
  const base = sharp(input, { failOn: "error" }).rotate();
  const metadata = await base.metadata();
  if (!metadata.width || !metadata.height) throw new Error(`${file.name} : dimensions illisibles.`);
  const targetWidth = Math.min(1600, metadata.width);
  const normalized = await base.resize({ width: targetWidth, withoutEnlargement: true }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  const normalizedMeta = await sharp(normalized).metadata();
  const width = normalizedMeta.width ?? targetWidth;
  const height = normalizedMeta.height ?? metadata.height;
  const desiredSlices = height / width > 2.4 ? Math.min(availableSlots, Math.max(2, Math.ceil(height / 2100))) : 1;
  if (desiredSlices === 1) return [{ data: normalized, mimeType: "image/jpeg", sourceName: file.name }];
  const sliceHeight = Math.ceil(height / desiredSlices);
  const slices: EvidenceImage[] = [];
  for (let index = 0; index < desiredSlices; index += 1) {
    const top = index * sliceHeight;
    const currentHeight = Math.min(sliceHeight, height - top);
    if (currentHeight < 80) continue;
    const data = await sharp(normalized).extract({ left: 0, top, width, height: currentHeight }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    slices.push({ data, mimeType: "image/jpeg", sourceName: `${file.name} · partie ${index + 1}/${desiredSlices}` });
  }
  return slices;
}

export async function prepareEvidenceImages(files: File[]): Promise<EvidenceImage[]> {
  if (!files.length) throw new Error("Ajoutez au moins une capture d’écran.");
  if (files.length > 5) throw new Error("Maximum 5 captures par analyse.");
  const evidence: EvidenceImage[] = [];
  for (const file of files) {
    const remainingFiles = files.length - files.indexOf(file) - 1;
    const slots = Math.max(1, 5 - evidence.length - remainingFiles);
    evidence.push(...await normalizeEvidence(file, slots));
    if (evidence.length >= 5) break;
  }
  return evidence.slice(0, 5);
}
