import { NextResponse } from "next/server";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { audit, setTrackingDisabledByAdmin } from "@/lib/db-postgres";

export const runtime = "nodejs";

/**
 * Tracking kill switch and safe disconnect.
 *
 * Disabling stops the browser Pixel and every server-side event immediately.
 * It cannot re-enable tracking that the environment forbids: META_TRACKING_ENABLED still wins.
 */
export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { disabled?: boolean };
  if (typeof body.disabled !== "boolean") return NextResponse.json({ error: "Valeur invalide." }, { status: 400 });

  await setTrackingDisabledByAdmin(body.disabled);
  await audit(session.adminId, body.disabled ? "meta.tracking.disable" : "meta.tracking.enable", "meta", "tracking");
  return NextResponse.json({
    ok: true,
    disabled: body.disabled,
    // Credentials live in environment variables and cannot be cleared from the browser.
    note: body.disabled
      ? "Suivi désactivé : le Pixel n’est plus chargé et aucun événement serveur n’est envoyé. Les identifiants restent dans les variables d’environnement ; retirez-les de l’hébergeur pour une déconnexion complète."
      : "Suivi réactivé, sous réserve que META_TRACKING_ENABLED soit à true.",
  });
}
