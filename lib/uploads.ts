import "server-only";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { deleteObjects, objectStorageEnabled, storeObject } from "@/lib/object-storage";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const PRODUCT_WIDTH = 1080;
const PRODUCT_HEIGHT = 1350;
const CREAM = "#FAEEE1";
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
  if (!objectStorageEnabled()) {
    await fs.mkdir(outputDirectory, { recursive: true });
    await fs.mkdir(originalDirectory, { recursive: true });
    await fs.mkdir(sourceDirectory, { recursive: true });
  }
  const output: string[] = [];
  try {
    for (const file of files) {
      assertImage(file);
      const uploaded = Buffer.from(await file.arrayBuffer());
      const readyToPublish = await sharp(uploaded, { failOn: "error", limitInputPixels: 80_000_000 })
        .rotate()
        .resize(PRODUCT_WIDTH, PRODUCT_HEIGHT, { fit: "contain", position: "centre", background: CREAM, withoutEnlargement: false })
        .flatten({ background: CREAM })
        .webp({ quality: 94, effort: 4 })
        .toBuffer();
      const filename = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString("hex")}.webp`;
      output.push(`/api/media/products/${filename}`);
      if (objectStorageEnabled()) {
        await Promise.all([
          storeObject(`sources/${filename}`, readyToPublish, "image/webp"),
          storeObject(`originals/${filename}`, readyToPublish, "image/webp"),
          storeObject(`products/${filename}`, readyToPublish, "image/webp"),
        ]);
      } else {
        await Promise.all([
          fs.writeFile(path.join(sourceDirectory, filename), readyToPublish),
          fs.writeFile(path.join(originalDirectory, filename), readyToPublish),
          fs.writeFile(path.join(outputDirectory, filename), readyToPublish),
        ]);
      }
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
  await deleteObjects(filenames.flatMap((filename) => [`products/${filename}`, `originals/${filename}`, `sources/${filename}`]));
  await Promise.all(filenames.flatMap((filename) => [
    fs.unlink(path.join(process.cwd(), "public", "uploads", "products", filename)).catch(() => undefined),
    fs.unlink(path.join(process.cwd(), "public", "uploads", "originals", filename)).catch(() => undefined),
    fs.unlink(path.join(process.cwd(), "public", "uploads", "sources", filename)).catch(() => undefined),
  ]));
}
