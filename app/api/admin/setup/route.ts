import { NextResponse } from "next/server";
import { audit } from "@/lib/db";
import { createFirstAdmin, createSession, hasAdmin } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (hasAdmin()) return NextResponse.json({ error: "La configuration initiale est déjà terminée." }, { status: 409 });
  const body = await request.json().catch(() => ({})) as { email?: string; password?: string };
  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "Adresse e-mail invalide." }, { status: 400 });
  if (password.length < 12) return NextResponse.json({ error: "Le mot de passe doit contenir au moins 12 caractères." }, { status: 400 });
  try {
    const adminId = createFirstAdmin(email, password);
    await createSession(adminId);
    audit(adminId, "admin.setup");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Configuration impossible." }, { status: 400 });
  }
}
