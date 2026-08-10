import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { audit } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > MAX_BYTES + 1024 * 1024) return NextResponse.json({ error: "Image trop volumineuse." }, { status: 413 });

  try {
    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof File) || !ACCEPTED_TYPES.has(file.type) || file.size < 1 || file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Choisissez une image JPG, PNG ou WebP de 15 Mo maximum." }, { status: 400 });
    }
    const directory = path.join(process.cwd(), "public", "uploads", "storefront");
    await fs.mkdir(directory, { recursive: true });
    const filename = `hero-${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}.webp`;
    await sharp(Buffer.from(await file.arrayBuffer()), { failOn: "error", limitInputPixels: 80_000_000 })
      .rotate()
      .resize({ width: 2200, height: 2200, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 92, effort: 4 })
      .toFile(path.join(directory, filename));
    const image = `/api/media/storefront/${filename}`;
    audit(session.adminId, "storefront.hero.upload", "settings", "storefront", { image });
    return NextResponse.json({ image });
  } catch {
    return NextResponse.json({ error: "Cette image est illisible ou endommagée." }, { status: 400 });
  }
}
