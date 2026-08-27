import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { objectStorageEnabled, readObject } from "@/lib/object-storage";

export const runtime = "nodejs";

/**
 * A product photo, as JPEG, for WhatsApp.
 *
 * The confirmation message sent by the external agent carries the product
 * image. WhatsApp Cloud API accepts **JPEG and PNG only** — every photo in this
 * catalogue is WebP, so a direct link to /api/media/products/… is refused by
 * Meta with a media error and the whole message fails to send.
 *
 * Meta fetches this URL itself, from its own servers, so it must be public and
 * must not depend on a session. It is also fetched once per order, so the
 * conversion cost is negligible and the result is cached for a year — the
 * filenames are content-hashed and never reused.
 *
 * 1600px is well inside Meta's 5 MB limit while staying sharp on a phone.
 */
const MAX_EDGE = 1600;

export async function GET(_request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  // Same guard as /api/media: no traversal, no separators, no surprises.
  if (!/^[a-zA-Z0-9._-]+$/.test(name) || name.includes("..")) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (!/\.(webp|png|jpe?g)$/i.test(name)) return new NextResponse("Not found", { status: 404 });

  try {
    const source = objectStorageEnabled()
      ? await readObject(`products/${name}`)
      : await fs.readFile(path.join(process.cwd(), "public", "uploads", "products", name));
    if (!source) return new NextResponse("Not found", { status: 404 });

    const jpeg = await sharp(source)
      .rotate()
      .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
      // Meta renders the image on a white card; flattening avoids a black
      // background wherever the source had transparency.
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();

    return new NextResponse(new Uint8Array(jpeg), {
      headers: {
        "content-type": "image/jpeg",
        "content-length": String(jpeg.length),
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
