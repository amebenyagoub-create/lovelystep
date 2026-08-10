import { NextResponse, after } from "next/server";
import { validAlgeriaAddress } from "@/lib/algeria";
import { normalizeAlgerianPhone, registerCustomer, validSameOrigin } from "@/lib/customer-auth";
import { claimMetaCapiEvent, markMetaCapiResult } from "@/lib/db-postgres";
import { sendServerEvent } from "@/lib/meta/capi";
import { metaRequestContext } from "@/lib/meta/request";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!validSameOrigin(request)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const firstName = String(body.firstName ?? "").trim().slice(0, 80);
  const lastName = String(body.lastName ?? "").trim().slice(0, 80);
  const phone = normalizeAlgerianPhone(String(body.phone ?? ""));
  const password = String(body.password ?? "");
  const wilayaCode = String(body.wilayaCode ?? "").padStart(2, "0");
  const commune = String(body.commune ?? "").trim().slice(0, 120);
  const address = String(body.address ?? "").trim().slice(0, 240);
  const wilaya = validAlgeriaAddress(wilayaCode, commune);
  if (firstName.length < 2 || lastName.length < 2 || !phone || password.length < 8 || password.length > 128 || !wilaya) {
    return NextResponse.json({ error: "Vérifiez le nom, le téléphone, l’adresse et le mot de passe (8 caractères minimum)." }, { status: 400 });
  }
  try {
    const customer = await registerCustomer({ firstName, lastName, phone, password, wilayaCode: wilaya.code, wilayaName: wilaya.nameFr, commune, address });
    // One registration per customer id, so a resubmit cannot create a second conversion.
    const metaEventId = `registration_${customer.id}`;
    const metaContext = metaRequestContext(request);
    after(async () => {
      try {
        if (!metaContext.consentGranted) return;
        if (!await claimMetaCapiEvent(metaEventId, "CompleteRegistration", null)) return;
        const result = await sendServerEvent({
          eventName: "CompleteRegistration",
          eventId: metaEventId,
          eventSourceUrl: metaContext.eventSourceUrl,
          userData: { phone: customer.phone, firstName: customer.firstName, lastName: customer.lastName, city: customer.commune, state: customer.wilayaName, country: "DZ", externalId: String(customer.id), fbp: metaContext.fbp, fbc: metaContext.fbc, clientIpAddress: metaContext.clientIpAddress, clientUserAgent: metaContext.clientUserAgent },
          customData: { content_name: "customer_account", currency: "DZD" },
        }, metaContext.consentGranted);
        await markMetaCapiResult(metaEventId, result.status, result.error ?? null);
      } catch {
        // Registration already succeeded; tracking failures stay silent.
      }
    });
    return NextResponse.json({ customer, metaEventId }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) return NextResponse.json({ error: "Un compte existe déjà avec ce numéro." }, { status: 409 });
    return NextResponse.json({ error: "Création du compte impossible." }, { status: 500 });
  }
}
