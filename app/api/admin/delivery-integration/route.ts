import { NextResponse } from "next/server";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { audit, saveDeliveryIntegration } from "@/lib/db";
import type { DeliveryIntegration } from "@/lib/types";

export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as Partial<DeliveryIntegration>;
  const integration: DeliveryIntegration = {
    enabled: body.enabled === true,
    providerName: String(body.providerName ?? "").trim().slice(0, 80),
    baseUrl: String(body.baseUrl ?? "").trim().replace(/\/+$/, "").slice(0, 300),
    createShipmentPath: `/${String(body.createShipmentPath ?? "shipments").trim().replace(/^\/+/, "").slice(0, 160)}`,
    apiTokenEnv: String(body.apiTokenEnv ?? "DELIVERY_API_TOKEN").trim().slice(0, 80),
  };
  if (integration.enabled) {
    try { if (new URL(integration.baseUrl).protocol !== "https:") throw new Error(); } catch { return NextResponse.json({ error: "L’URL API active doit être une adresse HTTPS valide." }, { status: 400 }); }
    if (!integration.providerName || !/^[A-Z][A-Z0-9_]{2,79}$/.test(integration.apiTokenEnv)) return NextResponse.json({ error: "Nom du transporteur ou variable du jeton invalide." }, { status: 400 });
  }
  saveDeliveryIntegration(integration);
  audit(session.adminId, "delivery.integration.update", "settings", "delivery_integration", { enabled: integration.enabled, providerName: integration.providerName });
  return NextResponse.json({ integration });
}
