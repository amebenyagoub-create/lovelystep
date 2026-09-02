import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { audit } from "@/lib/db-postgres";
import { objectStorageEnabled, storeObject } from "@/lib/object-storage";

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
    const filename = `hero-${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}.webp`;
    const source = sharp(Buffer.from(await file.arrayBuffer()), { failOn: "error", limitInputPixels: 80_000_000 }).rotate();
    // La banniere couvre un cadre haut sur telephone : une image carree y est rognee de moitie
    // et une image etroite est agrandie, ce qui se voit immediatement.
    const { width = 0, height = 0 } = await source.metadata();
    const warnings = [
      width && width < 1800 ? `Image de ${width} px de large : elle sera agrandie sur telephone et paraitra floue. Visez 2000 px minimum.` : "",
      width && height && height / width < 1.2 ? "Image presque carree ou panoramique : le cadre mobile est haut et etroit, il en rognera les cotes. Une photo verticale tient mieux." : "",
    ].filter(Boolean);
    const output = await source.clone()
      .resize({ width: 2200, height: 2200, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 92, effort: 4 })
      .toBuffer();
    if (objectStorageEnabled()) await storeObject(`storefront/${filename}`, output, "image/webp");
    else {
      const directory = path.join(process.cwd(), "public", "uploads", "storefront");
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, filename), output);
    }
    const image = `/api/media/storefront/${filename}`;
    await audit(session.adminId, "storefront.hero.upload", "settings", "storefront", { image });
    return NextResponse.json({ image, warnings });
  } catch {
    return NextResponse.json({ error: "Cette image est illisible ou endommagée." }, { status: 400 });
  }
}
