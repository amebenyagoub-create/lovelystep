import { NextResponse } from "next/server";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { addProductCost, audit, getProductById, listProductCosts } from "@/lib/db-postgres";

export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { productId?: number; costCents?: number; effectiveFrom?: string };
  const productId = Number(body.productId);
  const costCents = Number(body.costCents);
  if (!Number.isInteger(productId) || productId < 1 || !Number.isInteger(costCents) || costCents < 0 || costCents > 100_000_000) {
    return NextResponse.json({ error: "Coût invalide." }, { status: 400 });
  }
  if (body.effectiveFrom && Number.isNaN(Date.parse(String(body.effectiveFrom)))) return NextResponse.json({ error: "Date invalide." }, { status: 400 });
  const product = await getProductById(productId);
  if (!product) return NextResponse.json({ error: "Produit introuvable." }, { status: 404 });
  const cost = await addProductCost(productId, costCents, body.effectiveFrom ? String(body.effectiveFrom) : undefined);
  await audit(session.adminId, "product.cost.add", "product", String(productId), { costCents });
  return NextResponse.json({ cost, history: await listProductCosts(productId) });
}
