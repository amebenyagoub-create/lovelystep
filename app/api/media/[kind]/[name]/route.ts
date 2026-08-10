import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const contentTypes: Record<string, string> = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export async function GET(_request: Request, context: { params: Promise<{ kind: string; name: string }> }) {
  const { kind, name } = await context.params;
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return new NextResponse("Not found", { status: 404 });
  const extension = path.extname(name).toLowerCase();
  const contentType = contentTypes[extension];
  if (!contentType) return new NextResponse("Not found", { status: 404 });
  const filePath = kind === "products" ? path.join(process.cwd(), "public", "uploads", "products", name)
    : kind === "imports" ? path.join(process.cwd(), "public", "uploads", "imports", name)
      : kind === "storefront" ? path.join(process.cwd(), "public", "uploads", "storefront", name)
      : kind === "size-guides" ? path.join(process.cwd(), "public", "generated", "size-guides", name) : null;
  if (!filePath) return new NextResponse("Not found", { status: 404 });
  try {
    const data = await fs.readFile(filePath);
    return new NextResponse(data, {
      headers: {
        "content-type": contentType,
        "content-length": String(data.length),
        "cache-control": kind === "size-guides" ? "public, max-age=300" : "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
