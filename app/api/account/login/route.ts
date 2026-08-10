import { NextResponse } from "next/server";
import { loginCustomer, normalizeAlgerianPhone, validSameOrigin } from "@/lib/customer-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!validSameOrigin(request)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { phone?: string; password?: string };
  const phone = normalizeAlgerianPhone(String(body.phone ?? ""));
  const password = String(body.password ?? "");
  if (!phone || !password) return NextResponse.json({ error: "Téléphone ou mot de passe invalide." }, { status: 400 });
  const customer = await loginCustomer(phone, password);
  return customer ? NextResponse.json({ customer }) : NextResponse.json({ error: "Téléphone ou mot de passe incorrect." }, { status: 401 });
}
