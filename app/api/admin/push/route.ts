import { NextResponse } from "next/server";
import { adminPushConfig, sendAdminPush } from "@/lib/admin-push";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import {
  countAdminPushSubscriptions,
  deleteAdminPushSubscription,
  saveAdminPushSubscription,
  type AdminPushSubscription,
} from "@/lib/db-postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingSubscription = { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };

function readSubscription(value: IncomingSubscription): Omit<AdminPushSubscription, "adminId"> | null {
  const endpoint = typeof value.endpoint === "string" ? value.endpoint.trim() : "";
  const p256dh = typeof value.keys?.p256dh === "string" ? value.keys.p256dh.trim() : "";
  const auth = typeof value.keys?.auth === "string" ? value.keys.auth.trim() : "";
  try {
    if (new URL(endpoint).protocol !== "https:") return null;
  } catch { return null; }
  if (endpoint.length > 4096 || p256dh.length < 40 || p256dh.length > 256 || auth.length < 16 || auth.length > 256) return null;
  return { endpoint, p256dh, auth };
}

export async function GET() {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  const config = adminPushConfig();
  return NextResponse.json({ configured: Boolean(config), publicKey: config?.publicKey ?? "", subscriptions: await countAdminPushSubscriptions() });
}

export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Session expirée. Rechargez la page." }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 16_384) return NextResponse.json({ error: "Requête trop volumineuse." }, { status: 413 });
  const subscription = readSubscription(await request.json().catch(() => ({})) as IncomingSubscription);
  if (!subscription) return NextResponse.json({ error: "Abonnement de notification invalide." }, { status: 400 });
  if (!adminPushConfig()) return NextResponse.json({ error: "Les notifications ne sont pas encore configurées sur Railway." }, { status: 503 });

  await saveAdminPushSubscription(session.adminId, subscription, request.headers.get("user-agent") ?? "");
  try {
    await sendAdminPush({ ...subscription, adminId: session.adminId }, {
      title: "Notifications Lovely Step activées",
      body: "Vous recevrez désormais une alerte pour chaque nouvelle commande.",
      url: "/admin?tab=orders",
      tag: "lovelystep-push-welcome",
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true, warning: "Abonnement enregistré, mais la notification de test n'a pas pu être envoyée." });
  }
}

export async function DELETE(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Session expirée. Rechargez la page." }, { status: 403 });
  const endpoint = String((await request.json().catch(() => ({})) as { endpoint?: unknown }).endpoint ?? "").trim();
  if (!endpoint || endpoint.length > 4096) return NextResponse.json({ error: "Abonnement invalide." }, { status: 400 });
  await deleteAdminPushSubscription(endpoint);
  return NextResponse.json({ ok: true });
}
