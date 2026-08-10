import { NextResponse } from "next/server";
import { createSession, loginAllowed, recordLoginAttempt, verifyAdminCredentials } from "@/lib/auth";
import { audit } from "@/lib/db-postgres";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { email?: string; password?: string };
  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  if (!await loginAllowed(email, ip)) return NextResponse.json({ error: "Trop de tentatives. Réessayez dans 15 minutes." }, { status: 429 });
  const admin = await verifyAdminCredentials(email, password);
  await recordLoginAttempt(email, ip, Boolean(admin));
  if (!admin) return NextResponse.json({ error: "E-mail ou mot de passe incorrect." }, { status: 401 });
  await createSession(admin.id);
  await audit(admin.id, "admin.login");
  return NextResponse.json({ ok: true });
}
