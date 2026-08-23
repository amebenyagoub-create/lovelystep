import { NextResponse } from "next/server";
import { insertCustomerLoginAttempt, isCustomerLoginAllowed } from "@/lib/db-postgres";
import { loginCustomer, normalizeAlgerianPhone, validSameOrigin } from "@/lib/customer-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!validSameOrigin(request)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { phone?: string; password?: string };
  const phone = normalizeAlgerianPhone(String(body.phone ?? ""));
  const password = String(body.password ?? "");
  if (!phone || !password) return NextResponse.json({ error: "Téléphone ou mot de passe invalide." }, { status: 400 });

  // Customer accounts hold a saved delivery address, so an unthrottled sign-in
  // form is a phone-number-plus-password guessing oracle. Same table and window
  // as the admin lockout, separated by `scope`.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  if (!await isCustomerLoginAllowed(phone, ip)) {
    return NextResponse.json({ error: "Trop de tentatives. Réessayez dans 15 minutes." }, { status: 429 });
  }

  const customer = await loginCustomer(phone, password);
  await insertCustomerLoginAttempt(phone, ip, Boolean(customer)).catch(() => undefined);
  return customer ? NextResponse.json({ customer }) : NextResponse.json({ error: "Téléphone ou mot de passe incorrect." }, { status: 401 });
}
