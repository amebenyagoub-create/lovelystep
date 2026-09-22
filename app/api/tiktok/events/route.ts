import { NextResponse } from "next/server";
import { getCustomerSession, validSameOrigin } from "@/lib/customer-auth";
import { cleanCustomData, type MetaCustomData, type MetaStandardEvent } from "@/lib/meta/events";
import { sendTikTokEvent } from "@/lib/tiktok/events-api";
import { tiktokRequestContext } from "@/lib/tiktok/request";

export const runtime = "nodejs";

const ALLOWED_EVENTS = new Set<MetaStandardEvent>(["ViewContent", "AddToCart", "InitiateCheckout", "CompleteRegistration"]);
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const validText = (value: unknown, max = 300): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const validAmount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000;

function parseCustomData(value: unknown, eventName: MetaStandardEvent): MetaCustomData | null {
  if (!isObject(value)) return null;
  if (eventName === "CompleteRegistration") return cleanCustomData({ content_name: "customer_account" });
  if (!Array.isArray(value.content_ids) || value.content_ids.length < 1 || value.content_ids.length > 20 || !value.content_ids.every((id) => validText(id, 200))) return null;
  if (value.content_type !== "product" || value.currency !== "DZD" || !validAmount(value.value)) return null;
  const data: MetaCustomData = { content_ids: value.content_ids.map((id) => String(id).trim()), content_type: "product", value: value.value, currency: "DZD" };
  if (validText(value.content_name)) data.content_name = value.content_name.trim();
  if (Number.isInteger(value.num_items) && Number(value.num_items) >= 1 && Number(value.num_items) <= 200) data.num_items = Number(value.num_items);
  if (Array.isArray(value.contents) && value.contents.length <= 20) {
    const contents = value.contents.map((item) => {
      if (!isObject(item) || !validText(item.id, 200) || !Number.isInteger(item.quantity) || Number(item.quantity) < 1 || Number(item.quantity) > 10) return null;
      if (item.item_price !== undefined && !validAmount(item.item_price)) return null;
      return { id: item.id.trim(), quantity: Number(item.quantity), ...(item.item_price === undefined ? {} : { item_price: Number(item.item_price) }) };
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
  const eventName = String(body?.eventName ?? "") as MetaStandardEvent;
  const eventId = String(body?.eventId ?? "");
  const ttclid = validText(body?.ttclid, 300) ? body.ttclid.trim() : undefined;
  const customData = parseCustomData(body?.customData, eventName);
  if (!ALLOWED_EVENTS.has(eventName) || !/^[a-zA-Z0-9_-]{8,128}$/.test(eventId) || !customData) return NextResponse.json({ error: "Evenement invalide." }, { status: 400 });

  const context = tiktokRequestContext(request);
  const customer = context.consentGranted ? await getCustomerSession().catch(() => null) : null;
  const result = await sendTikTokEvent({
    eventName,
    eventId,
    url: context.url,
    referrer: context.referrer,
    user: { phone: customer?.phone, externalId: customer ? String(customer.id) : undefined, ttp: context.ttp, ttclid: ttclid ?? context.ttclid, ip: context.ip, userAgent: context.userAgent },
    customData,
  }, context.consentGranted);
  return NextResponse.json({ ok: result.ok, skipped: result.skipped ?? null }, { status: result.ok || result.skipped ? 200 : 502 });
}

