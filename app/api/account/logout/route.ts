import { NextResponse } from "next/server";
import { logoutCustomer, validSameOrigin } from "@/lib/customer-auth";

export async function POST(request: Request) {
  if (!validSameOrigin(request)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  await logoutCustomer();
  return NextResponse.json({ ok: true });
}
