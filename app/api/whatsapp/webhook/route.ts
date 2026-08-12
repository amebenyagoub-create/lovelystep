import { NextResponse } from "next/server";
import { handleIncomingWhatsAppMessage, type IncomingWhatsAppMessage } from "@/lib/whatsapp/agent";
import { whatsappConfig } from "@/lib/whatsapp/config";
import { verifyWhatsAppSignature } from "@/lib/whatsapp/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const config = whatsappConfig();
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && config.verifyToken && token === config.verifyToken && challenge) {
    return new Response(challenge, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return NextResponse.json({ error: "Vérification refusée." }, { status: 403 });
}

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 512 * 1024) return NextResponse.json({ error: "Payload trop volumineux." }, { status: 413 });

  const rawBody = await request.text();
  if (rawBody.length > 512 * 1024) return NextResponse.json({ error: "Payload trop volumineux." }, { status: 413 });
  const config = whatsappConfig();
  if (!verifyWhatsAppSignature(rawBody, request.headers.get("x-hub-signature-256"), config.appSecret)) {
    return NextResponse.json({ error: "Signature invalide." }, { status: 401 });
  }

  const payload = (() => {
    try { return JSON.parse(rawBody) as {
      object?: string;
      entry?: Array<{ changes?: Array<{ value?: { messages?: IncomingWhatsAppMessage[] } }> }>;
    }; } catch { return null; }
  })();
  if (!payload) return NextResponse.json({ error: "Payload JSON invalide." }, { status: 400 });
  if (payload.object !== "whatsapp_business_account") return NextResponse.json({ ok: true, ignored: true });

  const messages = payload.entry?.flatMap((entry) => entry.changes?.flatMap((change) => change.value?.messages ?? []) ?? []) ?? [];
  let failed = false;
  for (const message of messages) {
    try { await handleIncomingWhatsAppMessage(message); }
    catch (error) {
      failed = true;
      console.error("WhatsApp webhook processing failed", error instanceof Error ? error.message : "unknown");
    }
  }
  // A non-2xx response asks Meta to retry. The database inbox makes that retry idempotent.
  if (failed) return NextResponse.json({ error: "Traitement temporairement indisponible." }, { status: 503 });
  return NextResponse.json({ ok: true });
}
