import { NextResponse } from "next/server";
import { findWilaya } from "@/lib/algeria";
import { requireAdminApi } from "@/lib/auth";

/**
 * Communes for one wilaya.
 *
 * The full commune list is a 575 KB JSON import. The storefront can afford it because checkout
 * needs it, but pulling it into the admin bundle would cost every admin page load. The order
 * editor asks for one wilaya at a time instead, and only once it is opened.
 */
export async function GET(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  const wilaya = findWilaya(new URL(request.url).searchParams.get("wilaya") ?? "");
  if (!wilaya) return NextResponse.json({ error: "Wilaya inconnue." }, { status: 400 });
  return NextResponse.json({ communes: wilaya.communes.map((commune) => commune.nameFr) });
}
