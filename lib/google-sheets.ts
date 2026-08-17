import "server-only";

import { readFile } from "node:fs/promises";
import { createSign } from "node:crypto";
import { listOrders, listOrderSheetStates, rememberOrderSheetState, updateOrderStatus } from "./db-postgres";
import { frenchAgeLabel } from "./product-size";
import type { Order, OrderStatus } from "./types";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

export const ORDER_SHEET_HEADERS = [
  "order_id",
  "created_at",
  "customer_name",
  "phone_raw",
  "phone_local",
  "phone_e164",
  "phone_alt",
  "wilaya_id",
  "wilaya_name",
  "commune",
  "address",
  "landmark",
  "product",
  "qty",
  "cod_total",
  "delivery_type",
  "is_exchange",
  "source",
  "state",
] as const;

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

type SheetsConfig = {
  spreadsheetId: string;
  tabName: string;
};

const SHEET_STATES: Record<string, OrderStatus> = {
  NEW: "new",
  CREATED: "new",
  TO_CONFIRM: "to_confirm",
  PENDING_CONFIRMATION: "to_confirm",
  CONFIRM_SENT: "to_confirm",
  CONFIRMATION_SENT: "to_confirm",
  AWAITING_REPLY: "to_confirm",
  AWAITING_RESPONSE: "to_confirm",
  WAITING_CUSTOMER: "to_confirm",
  NEEDS_HUMAN: "to_confirm",
  NEEDS_REVIEW: "to_confirm",
  HUMAN: "to_confirm",
  CONFIRMED: "confirmed",
  CONFIRME: "confirmed",
  ACCEPTED: "confirmed",
  VALIDATED: "confirmed",
  PREPARING: "preparing",
  PROCESSING: "preparing",
  ZR_CREATED: "preparing",
  PARCEL_CREATED: "preparing",
  SHIPPED: "shipped",
  IN_TRANSIT: "shipped",
  OUT_FOR_DELIVERY: "shipped",
  EXPEDIEE: "shipped",
  DELIVERED: "delivered",
  LIVREE: "delivered",
  REFUSED: "refused",
  REJECTED: "refused",
  RETURNED: "returned",
  RETOURNEE: "returned",
  CANCELLED: "cancelled",
  CANCELED: "cancelled",
  ANNULEE: "cancelled",
};

let cachedToken: { value: string; expiresAt: number } | null = null;

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function sheetsConfig(): SheetsConfig | null {
  const spreadsheetId = (process.env.GOOGLE_SHEETS_SPREADSHEET_ID ?? "").trim();
  if (!spreadsheetId) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(spreadsheetId)) throw new Error("GOOGLE_SHEETS_SPREADSHEET_ID est invalide.");

  const tabName = (process.env.GOOGLE_SHEETS_TAB_NAME ?? "orders").trim() || "orders";
  if (tabName.length > 100 || [..."[]:*?/\\"].some((character) => tabName.includes(character))) {
    throw new Error("GOOGLE_SHEETS_TAB_NAME est invalide.");
  }
  return { spreadsheetId, tabName };
}

async function serviceAccount(): Promise<ServiceAccount> {
  const inline = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "").trim();
  const encoded = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 ?? "").trim();
  const file = (process.env.GOOGLE_SERVICE_ACCOUNT_FILE ?? "").trim();
  const source = inline || (encoded ? Buffer.from(encoded, "base64").toString("utf8") : file ? await readFile(file, "utf8") : "");
  if (!source) throw new Error("Le compte de service Google Sheets n'est pas configuré.");

  let parsed: Partial<ServiceAccount>;
  try {
    parsed = JSON.parse(source) as Partial<ServiceAccount>;
  } catch {
    throw new Error("Le JSON du compte de service Google est invalide.");
  }
  const clientEmail = String(parsed.client_email ?? "").trim();
  const privateKey = String(parsed.private_key ?? "").replace(/\\n/g, "\n").trim();
  if (!clientEmail || !privateKey.includes("BEGIN PRIVATE KEY")) throw new Error("Le compte de service Google est incomplet.");
  return { client_email: clientEmail, private_key: privateKey, token_uri: parsed.token_uri };
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const account = await serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = account.token_uri || "https://oauth2.googleapis.com/token";
  const unsigned = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(JSON.stringify({
    iss: account.client_email,
    scope: SHEETS_SCOPE,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${base64Url(signer.sign(account.private_key))}`;
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description || `Authentification Google refusée (${response.status}).`);
  cachedToken = { value: payload.access_token, expiresAt: Date.now() + Math.max(300, Number(payload.expires_in) || 3600) * 1000 };
  return payload.access_token;
}

function a1(tabName: string, range: string): string {
  return `'${tabName.replaceAll("'", "''")}'!${range}`;
}

async function sheetsRequest<T>(
  spreadsheetId: string,
  range: string,
  init: RequestInit = {},
  action = "",
  search = "",
): Promise<T> {
  const token = await accessToken();
  const url = `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}${action}${search ? `?${search}` : ""}`;
  const response = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `Google Sheets a répondu ${response.status}.`);
  return payload;
}

function dzd(cents: number): number {
  return Math.round(Number(cents || 0)) / 100;
}

export function orderStatusFromSheetState(value: unknown): OrderStatus | null {
  const normalized = String(value ?? "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  return SHEET_STATES[normalized] ?? null;
}

export function orderSheetRow(order: Order): Array<string | number | boolean> {
  const localDigits = order.phone.replace(/\D/g, "").replace(/^213/, "");
  const localPhone = localDigits ? `0${localDigits}` : order.phone;
  const e164Phone = localDigits ? `+213${localDigits}` : order.phone;
  const products = order.items.map((item) => {
    const details = [item.color, frenchAgeLabel({ label: item.size })].filter(Boolean).join(", ");
    return `${item.name}${details ? ` (${details})` : ""} ×${item.quantity}`;
  }).join(" | ");

  return [
    order.orderNumber,
    order.createdAt,
    order.customerName,
    order.phone,
    localPhone,
    e164Phone,
    "",
    order.wilayaCode,
    order.wilayaName,
    order.commune,
    order.address,
    order.notes,
    products,
    order.items.reduce((total, item) => total + item.quantity, 0),
    dzd(order.totalCents),
    order.deliveryType,
    false,
    "lovelystep",
    order.status,
  ];
}

async function ensureHeaders(config: SheetsConfig): Promise<void> {
  const range = a1(config.tabName, `A1:S1`);
  const current = await sheetsRequest<{ values?: unknown[][] }>(config.spreadsheetId, range);
  const firstRow = current.values?.[0]?.map(String) ?? [];
  if (!firstRow.length) {
    await sheetsRequest(config.spreadsheetId, range, {
      method: "PUT",
      body: JSON.stringify({ range, majorDimension: "ROWS", values: [[...ORDER_SHEET_HEADERS]] }),
    }, "", "valueInputOption=RAW");
    return;
  }
  if (ORDER_SHEET_HEADERS.some((header, index) => firstRow[index] !== header)) {
    throw new Error(`L'onglet ${config.tabName} existe, mais ses colonnes ne correspondent pas au format de confirmation.`);
  }
}

export async function verifyGoogleSheetsConnection(): Promise<{ spreadsheetId: string; tabName: string }> {
  const config = sheetsConfig();
  if (!config) throw new Error("GOOGLE_SHEETS_SPREADSHEET_ID n'est pas configuré.");
  await ensureHeaders(config);
  const range = a1(config.tabName, "A1:S1");
  await sheetsRequest(config.spreadsheetId, range, {
    method: "PUT",
    body: JSON.stringify({ range, majorDimension: "ROWS", values: [[...ORDER_SHEET_HEADERS]] }),
  }, "", "valueInputOption=RAW");
  return config;
}

export async function appendOrderToGoogleSheet(order: Order): Promise<"appended" | "already_exists" | "disabled"> {
  const config = sheetsConfig();
  if (!config) return "disabled";
  await ensureHeaders(config);

  const orderNumbers = await sheetsRequest<{ values?: unknown[][] }>(config.spreadsheetId, a1(config.tabName, "A2:A"));
  if (orderNumbers.values?.some((row) => String(row[0] ?? "").trim() === order.orderNumber)) return "already_exists";

  const range = a1(config.tabName, "A:S");
  await sheetsRequest(config.spreadsheetId, range, {
    method: "POST",
    body: JSON.stringify({ range, majorDimension: "ROWS", values: [orderSheetRow(order)] }),
  }, ":append", "valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS");
  return "appended";
}

export async function readOrderStatesFromGoogleSheet(): Promise<Array<{ orderNumber: string; sheetState: string; status: OrderStatus | null }>> {
  const config = sheetsConfig();
  if (!config) return [];
  await ensureHeaders(config);
  const response = await sheetsRequest<{ values?: unknown[][] }>(config.spreadsheetId, a1(config.tabName, "A2:S"));
  return (response.values ?? []).flatMap((row) => {
    const orderNumber = String(row[0] ?? "").trim();
    const sheetState = String(row[18] ?? "").trim();
    return orderNumber && sheetState ? [{ orderNumber, sheetState, status: orderStatusFromSheetState(sheetState) }] : [];
  });
}

export async function syncOrderStatesFromGoogleSheet(): Promise<{ orders: Order[]; updated: number; unknownStates: string[] }> {
  const [orders, sheetRows, lastStates] = await Promise.all([listOrders(), readOrderStatesFromGoogleSheet(), listOrderSheetStates()]);
  const ordersByNumber = new Map(orders.map((order) => [order.orderNumber.toUpperCase(), order]));
  const unknownStates = new Set<string>();
  let updated = 0;

  for (const row of sheetRows) {
    if (!row.status) {
      unknownStates.add(row.sheetState);
      continue;
    }
    const order = ordersByNumber.get(row.orderNumber.toUpperCase());
    if (!order || lastStates.get(order.id) === row.sheetState) continue;
    if (order.status !== row.status) {
      const result = await updateOrderStatus(order.id, row.status, null, "google_sheet", `État Google Sheets : ${row.sheetState}`);
      if (result !== "updated") continue;
      order.status = row.status;
      updated += 1;
    }
    await rememberOrderSheetState(order.id, row.sheetState);
  }
  return { orders, updated, unknownStates: [...unknownStates] };
}

export async function queueOrderGoogleSheetSync(order: Order): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await appendOrderToGoogleSheet(order);
      return;
    } catch (error) {
      if (attempt === 3) {
        console.error("Google Sheets order sync failed", error instanceof Error ? error.message : error);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
}
