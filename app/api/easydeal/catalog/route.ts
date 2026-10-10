import { NextResponse } from "next/server";
import { findWilaya } from "@/lib/algeria";
import { getDeliveryRate, getProductBySlug, listDeliveryRates } from "@/lib/db-postgres";
import { easyDealCorsHeaders } from "@/lib/easydeal";
import { toPublicProduct } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function forbidden() {
  return NextResponse.json({ error: "Origine non autorisée." }, { status: 403 });
}

export async function OPTIONS(request: Request) {
  const headers = easyDealCorsHeaders(request);
  return headers ? new Response(null, { status: 204, headers }) : forbidden();
}

export async function GET(request: Request) {
  const headers = easyDealCorsHeaders(request);
  if (!headers) return forbidden();

  const url = new URL(request.url);
  const slug = String(url.searchParams.get("slug") ?? "").trim().toLowerCase().slice(0, 80);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return NextResponse.json({ error: "Produit invalide." }, { status: 400, headers });
  }

  const product = await getProductBySlug(slug, false, "easydeal");
  if (!product) return NextResponse.json({ error: "Produit indisponible." }, { status: 404, headers });

  const wilayaCode = String(url.searchParams.get("wilaya") ?? "").padStart(2, "0");
  if (url.searchParams.has("wilaya")) {
    const [wilaya, rate] = await Promise.all([Promise.resolve(findWilaya(wilayaCode)), getDeliveryRate(wilayaCode)]);
    if (!wilaya || !rate?.active) return NextResponse.json({ error: "Livraison indisponible dans cette wilaya." }, { status: 404, headers });
    return NextResponse.json({
      communes: wilaya.communes.map((commune) => commune.nameFr),
      delivery: { homeCents: rate.homeCents, officeCents: rate.officeCents },
    }, { headers });
  }

  const rates = (await listDeliveryRates()).filter((rate) => rate.active && rate.homeCents > 0);
  return NextResponse.json({
    product: toPublicProduct(product),
    wilayas: rates.map((rate) => ({ code: rate.wilayaCode, name: rate.wilayaNameFr, homeCents: rate.homeCents, officeCents: rate.officeCents })),
  }, { headers });
}
