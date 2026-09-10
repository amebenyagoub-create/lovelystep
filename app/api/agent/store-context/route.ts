import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { buildAgentStoreContext } from "@/lib/agent-store-context";
import { listDeliveryRates, listProducts } from "@/lib/db-postgres";
import { siteUrl } from "@/lib/site-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const expected = process.env.LOVELYSTEP_AGENT_SECRET?.trim() || "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!expected || expected.length !== supplied.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  const [products, rates] = await Promise.all([listProducts(false), listDeliveryRates()]);
  return NextResponse.json(buildAgentStoreContext(products, rates, siteUrl()), {
    headers: { "cache-control": "private, no-store" },
  });
}
