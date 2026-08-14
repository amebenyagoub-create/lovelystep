import { NextResponse } from "next/server";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { audit, getProductById } from "@/lib/db-postgres";
import { publishProductToInstagram } from "@/lib/meta/instagram-posts";
import { publishProductToFacebookPage } from "@/lib/meta/page-posts";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Explicit retry for a failed product announcement. Published/pending rows cannot be reclaimed. */
export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { productId?: number; channel?: "facebook" | "instagram" };
  const productId = Number(body.productId);
  const channel = body.channel === "instagram" ? "instagram" : "facebook";
  if (!Number.isInteger(productId) || productId < 1) return NextResponse.json({ error: "Produit invalide." }, { status: 400 });
  const product = await getProductById(productId);
  if (!product) return NextResponse.json({ error: "Produit introuvable." }, { status: 404 });
  if (product.status !== "published") return NextResponse.json({ error: "Le produit doit être publié." }, { status: 409 });

  const result = channel === "instagram"
    ? await publishProductToInstagram(product, true)
    : await publishProductToFacebookPage(product, true);
  await audit(session.adminId, "meta.social_post.retry", "product", String(productId), { ok: result.ok, channel });
  if (result.ok) return NextResponse.json({ result });
  if (result.skipped === "already_claimed") return NextResponse.json({ error: `Ce produit est déjà publié sur ${channel === "instagram" ? "Instagram" : "Facebook"} ou un envoi est en cours.` }, { status: 409 });
  return NextResponse.json({ error: result.error || (channel === "instagram" ? "Publication Instagram impossible. Vérifiez instagram_content_publish." : "Publication Facebook impossible. Vérifiez pages_manage_posts.") }, { status: 502 });
}
