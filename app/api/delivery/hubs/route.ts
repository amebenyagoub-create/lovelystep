import { NextResponse } from "next/server";
import { findWilaya } from "@/lib/algeria";
import { pickupHubsForWilaya } from "@/lib/pickup-hubs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bureaux ZR Express d'une wilaya, pour le choix « livraison au bureau » a la commande.
 *
 * Public par necessite : le client doit choisir avant de valider. Le cache vit dans
 * lib/pickup-hubs, partage avec la creation de commande qui revalide l'identifiant soumis.
 * Une panne cote ZR renvoie une liste vide plutot qu'une erreur : le formulaire laisse alors
 * passer la commande sans bureau au lieu de la bloquer.
 */
export async function GET(request: Request) {
  const wilaya = findWilaya(new URL(request.url).searchParams.get("wilaya") ?? "");
  if (!wilaya) return NextResponse.json({ error: "Wilaya inconnue." }, { status: 400 });
  try {
    return NextResponse.json({ hubs: await pickupHubsForWilaya(wilaya.code, wilaya.nameFr) });
  } catch {
    return NextResponse.json({ hubs: [], unavailable: true });
  }
}
