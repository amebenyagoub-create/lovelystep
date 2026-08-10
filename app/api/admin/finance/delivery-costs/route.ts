import { NextResponse } from "next/server";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { audit, upsertOrderDeliveryCost } from "@/lib/db-postgres";

export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { orderId?: number; carrierCostCents?: number; returnCostCents?: number };
  const orderId = Number(body.orderId);
  const carrierCostCents = Number(body.carrierCostCents ?? 0);
  const returnCostCents = Number(body.returnCostCents ?? 0);
  if (!Number.isInteger(orderId) || orderId < 1 || !Number.isInteger(carrierCostCents) || carrierCostCents < 0 || carrierCostCents > 10_000_000
    || !Number.isInteger(returnCostCents) || returnCostCents < 0 || returnCostCents > 10_000_000) {
    return NextResponse.json({ error: "Coût de livraison invalide." }, { status: 400 });
  }
  const deliveryCost = await upsertOrderDeliveryCost(orderId, carrierCostCents, returnCostCents, "manual");
  await audit(session.adminId, "order.delivery_cost", "order", String(orderId), { carrierCostCents, returnCostCents });
  return NextResponse.json({ deliveryCost });
}
