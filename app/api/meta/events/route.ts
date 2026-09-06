import { NextResponse } from "next/server";
import { getCustomerSession, validSameOrigin } from "@/lib/customer-auth";
import { sendServerEvent } from "@/lib/meta/capi";
import { cleanCustomData, type MetaCustomData, type MetaStandardEvent } from "@/lib/meta/events";
import { metaRequestContext } from "@/lib/meta/request";

export const runtime = "nodejs";

const ALLOWED_EVENTS = new Set<MetaStandardEvent>(["ViewContent", "AddToCart", "InitiateCheckout"]);
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const validText = (value: unknown, max = 300): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const validAmount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000;

function parseCustomData(value: unknown): MetaCustomData | null {
  if (!isObject(value) || !Array.isArray(value.content_ids) || value.content_ids.length < 1 || value.content_ids.length > 20) return null;
  if (!value.content_ids.every((id) => validText(id, 200))) return null;
  if (value.content_type !== "product" || value.currency !== "DZD" || !validAmount(value.value)) return null;

  const data: MetaCustomData = {
    content_ids: value.content_ids.map((id) => id.trim()),
    content_type: "product",
    value: value.value,
    currency: "DZD",
  };
  if (value.content_name !== undefined) {
    if (!validText(value.content_name)) return null;
    data.content_name = value.content_name.trim();
  }
  if (value.content_category !== undefined) {
    if (!validText(value.content_category)) return null;
    data.content_category = value.content_category.trim();
  }
  if (value.num_items !== undefined) {
    if (!Number.isInteger(value.num_items) || Number(value.num_items) < 1 || Number(value.num_items) > 200) return null;
    data.num_items = Number(value.num_items);
  }
  if (value.contents !== undefined) {
    if (!Array.isArray(value.contents) || value.contents.length < 1 || value.contents.length > 20) return null;
    const contents = value.contents.map((item) => {
      if (!isObject(item) || !validText(item.id, 200) || !Number.isInteger(item.quantity) || Number(item.quantity) < 1 || Number(item.quantity) > 10) return null;
      if (item.item_price !== undefined && !validAmount(item.item_price)) return null;
      return { id: item.id.trim(), quantity: Number(item.quantity), ...(item.item_price === undefined ? {} : { item_price: item.item_price }) };
    });
    if (contents.some((item) => item === null)) return null;
    data.contents = contents as NonNullable<MetaCustomData["contents"]>;
  }
  return cleanCustomData(data);
}

export async function POST(request: Request) {
  if (!validSameOrigin(request)) return NextResponse.json({ error: "Requete refusee." }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 32 * 1024) return NextResponse.json({ error: "Requete trop volumineuse." }, { status: 413 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const eventName = body?.eventName;
  const eventId = body?.eventId;
  const customData = parseCustomData(body?.customData);
  if (typeof eventName !== "string" || !ALLOWED_EVENTS.has(eventName as MetaStandardEvent) || typeof eventId !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(eventId) || !customData) {
    return NextResponse.json({ error: "Evenement invalide." }, { status: 400 });
  }

  const context = metaRequestContext(request);
  const customer = context.consentGranted ? await getCustomerSession().catch(() => null) : null;
  const result = await sendServerEvent({
    eventName: eventName as MetaStandardEvent,
    eventId,
    eventSourceUrl: context.eventSourceUrl,
    actionSource: "website",
    userData: {
      phone: customer?.phone,
      firstName: customer?.firstName,
      lastName: customer?.lastName,
      city: customer?.commune,
      state: customer?.wilayaName,
      country: customer ? "DZ" : undefined,
      externalId: customer ? String(customer.id) : undefined,
      fbp: context.fbp,
      fbc: context.fbc,
      clientIpAddress: context.clientIpAddress,
      clientUserAgent: context.clientUserAgent,
    },
    customData,
  }, context.consentGranted);

  return NextResponse.json(
    { ok: result.ok, eventsReceived: result.eventsReceived ?? 0, skipped: result.skipped ?? null },
    { status: result.ok || result.skipped ? 200 : 502 },
  );
}
