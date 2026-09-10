import { NextResponse } from "next/server";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { getDeliveryRate, getProductById } from "@/lib/db-postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODELS = new Set(["deepseek-v4-flash", "gpt-5.6-sol"]);

export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });

  const body = await request.json().catch(() => ({})) as {
    message?: string;
    productId?: number;
    wilayaCode?: string;
    deliveryType?: "home" | "office";
    model?: string;
  };
  const message = String(body.message || "").trim();
  const productId = Number(body.productId);
  const model = String(body.model || "deepseek-v4-flash");
  const deliveryType = body.deliveryType === "office" ? "office" : "home";
  if (!message || message.length > 1_000 || !Number.isInteger(productId) || !MODELS.has(model)) {
    return NextResponse.json({ error: "Paramètres de test invalides." }, { status: 400 });
  }

  const [product, rate] = await Promise.all([
    getProductById(productId),
    getDeliveryRate(String(body.wilayaCode || "")),
  ]);
  if (!product || product.status !== "published") return NextResponse.json({ error: "Produit publié introuvable." }, { status: 404 });
  if (!rate?.active) return NextResponse.json({ error: "Tarif de livraison introuvable." }, { status: 404 });

  const agentUrl = process.env.WHATSAPP_AGENT_URL?.replace(/\/+$/, "") || "";
  const secret = process.env.LOVELYSTEP_AGENT_SECRET?.trim() || "";
  if (!agentUrl || !secret) return NextResponse.json({ error: "Le test de l’agent n’est pas configuré." }, { status: 503 });
  const shippingCents = deliveryType === "office" ? rate.officeCents : rate.homeCents;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 100_000);
  try {
    const response = await fetch(`${agentUrl}/internal/test-agent`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({
        message,
        model,
        order: {
          order_id: "LS-SANDBOX",
          customer_name: "Client test",
          product: product.name,
          qty: 1,
          cod_total: (product.priceCents + shippingCents) / 100,
          address: "Adresse de test",
          commune: "Commune de test",
          wilaya_id: rate.wilayaCode,
          wilaya_name: rate.wilayaNameFr,
          delivery_type: deliveryType,
          state: "CONFIRM_SENT",
        },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json({ error: value.error || "Test de l’agent impossible." }, { status: response.status });
    return NextResponse.json(value);
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return NextResponse.json({ error: timedOut ? "Le modèle a dépassé 100 secondes." : "Connexion à l’agent impossible." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
