import { NextResponse } from "next/server";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { audit } from "@/lib/db";
import { saveProductImages } from "@/lib/uploads";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 80 * 1024 * 1024) return NextResponse.json({ error: "Envoi trop volumineux." }, { status: 413 });
  try {
    const form = await request.formData();
    const files = form.getAll("images").filter((value): value is File => value instanceof File);
    const images = await saveProductImages(files);
    if (!images.length) return NextResponse.json({ error: "Aucune image reçue." }, { status: 400 });
    audit(session.adminId, "product.images.upload", "product", undefined, { count: images.length });
    return NextResponse.json({ images });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Envoi impossible." }, { status: 400 });
  }
}
