import { NextResponse } from "next/server";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { audit, getProductById } from "@/lib/db-postgres";
import { publishProductToFacebookPage } from "@/lib/meta/page-posts";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Explicit retry for a failed product announcement. Published/pending rows cannot be reclaimed. */
export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { productId?: number };
  const productId = Number(body.productId);
  if (!Number.isInteger(productId) || productId < 1) return NextResponse.json({ error: "Produit invalide." }, { status: 400 });
  const product = await getProductById(productId);
  if (!product) return NextResponse.json({ error: "Produit introuvable." }, { status: 404 });
  if (product.status !== "published") return NextResponse.json({ error: "Le produit doit être publié." }, { status: 409 });

  const result = await publishProductToFacebookPage(product, true);
  await audit(session.adminId, "meta.page_post.retry", "product", String(productId), { ok: result.ok });
  if (result.ok) return NextResponse.json({ result });
  if (result.skipped === "already_claimed") return NextResponse.json({ error: "Ce produit est déjà publié sur Facebook ou un envoi est en cours." }, { status: 409 });
  return NextResponse.json({ error: result.error || "Publication Facebook impossible. Vérifiez la configuration et pages_manage_posts." }, { status: 502 });
}
