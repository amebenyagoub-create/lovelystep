import { NextResponse } from "next/server";
import { destroySession, requireAdminApi, validCsrf } from "@/lib/auth";
import { audit } from "@/lib/db";

export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  audit(session.adminId, "admin.logout");
  await destroySession();
  return NextResponse.json({ ok: true });
}
