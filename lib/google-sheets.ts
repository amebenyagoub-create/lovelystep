import "server-only";

import { readFile } from "node:fs/promises";
import { createSign } from "node:crypto";
import { listOrders, listOrderSheetStates, listOrdersPendingSheetSync, markOrderSheetSynced, recordOrderSheetFailure, rememberOrderConversation, rememberOrderSheetState, updateOrderStatus } from "./db-postgres";
import { log, errorMessage } from "./log";
import { frenchAgeLabel } from "./product-size";
import { siteUrl } from "./site-url";
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
  QUEUED: "new",
  AGENT_TALKING: "to_confirm",
  SCHEDULED: "to_confirm",
  NO_REPLY: "to_confirm",
  CONFIRMED: "confirmed",
  CONFIRME: "confirmed",
  ACCEPTED: "confirmed",
  VALIDATED: "confirmed",
  PREPARING: "preparing",
  PROCESSING: "preparing",
  ZR_CREATED: "preparing",
  PARCEL_CREATED: "preparing",
  ZR_ERROR: "confirmed",
  SHIPPED: "shipped",
  IN_TRANSIT: "shipped",
  OUT_FOR_DELIVERY: "shipped",
  ARRIVED_WILAYA: "shipped",
  MISSED_ATTEMPT: "shipped",
  STALLED: "shipped",
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


/**
 * Absolute URL of the product photo, for the confirmation message.
 *
 * Meta fetches this itself and rejects WebP, which is every photo in this
 * catalogue — hence /api/wa-image, which converts to JPEG. Only uploaded
 * product images are convertible; seed images under /images are skipped rather
 * than producing a URL that would 404 on Meta's side and fail the whole send.
 */
export function orderImageUrl(order: Order): string {
  const image = order.items.find((item) => item.image?.trim())?.image?.trim() ?? "";
  const match = /^\/api\/media\/products\/([a-zA-Z0-9._-]+)$/.exec(image);
  const origin = siteUrl();
  if (!match || !origin) return "";
  return `${origin}/api/wa-image/${match[1]}`;
}

/** Column letter for a zero-based index: 0 -> A, 26 -> AA. */
function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rest = (n - 1) % 26;
    out = String.fromCharCode(65 + rest) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * Position of a column, found by NAME in the header row.
 *
 * The agent owns columns beyond this file's nineteen and its schema has grown
 * before. Hardcoding a position here would put the store one schema change away
 * from writing a product photo into, say, the ZR tracking column.
 */
async function headerIndex(config: SheetsConfig, name: string): Promise<number> {
  const response = await sheetsRequest<{ values?: unknown[][] }>(
    config.spreadsheetId, a1(config.tabName, "A1:BZ1"));
  const headers = (response.values?.[0] ?? []).map((value) => String(value ?? "").trim());
  return headers.indexOf(name);
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

export async function clearOrderRowsFromGoogleSheet(apply = false): Promise<{ spreadsheetId: string; tabName: string; rows: number; cleared: boolean }> {
  const config = sheetsConfig();
  if (!config) throw new Error("GOOGLE_SHEETS_SPREADSHEET_ID n'est pas configuré.");
  await ensureHeaders(config);
  const range = a1(config.tabName, "A2:ZZZ");
  const current = await sheetsRequest<{ values?: unknown[][] }>(config.spreadsheetId, range);
  const rows = (current.values ?? []).filter((row) => row.some((cell) => String(cell ?? "").trim())).length;
  if (apply && rows) await sheetsRequest(config.spreadsheetId, range, { method: "POST", body: "{}" }, ":clear");
  return { ...config, rows, cleared: apply };
}

/**
 * Ecrit la commande sur une ligne calculee, sans passer par :append.
 *
 * :append ne recoit pas une destination mais une plage ou Google DEVINE le tableau, puis
 * ecrit a partir du bord gauche de ce qu'il a devine. Sur cette feuille il s'est trompe :
 * des commandes sont parties en colonne M au lieu de A. L'agent de confirmation cherche le
 * numero de commande en colonne A ; une ligne decalee lui est invisible, le client n'est
 * jamais appele, et la commande est perdue sans qu'aucune erreur ne soit levee.
 *
 * On calcule donc nous-memes la premiere ligne libre et on ecrit dessus. Une ligne est
 * consideree occupee des qu'UNE cellule de A a BZ contient quelque chose : les colonnes de
 * l'agent comptent, sinon une ligne qu'il a creee se ferait ecraser. La ligne 2 vide de cette
 * feuille reste vide, on ecrit apres la derniere ligne occupee.
 */
async function nextFreeRow(config: SheetsConfig): Promise<number> {
  const grid = await sheetsRequest<{ values?: unknown[][] }>(config.spreadsheetId, a1(config.tabName, "A2:BZ"));
  const rows = grid.values ?? [];
  let lastOccupied = 1;
  rows.forEach((row, index) => {
    if (row?.some((cell) => String(cell ?? "").trim())) lastOccupied = index + 2;
  });
  return lastOccupied + 1;
}

export async function appendOrderToGoogleSheet(order: Order): Promise<"appended" | "already_exists" | "disabled"> {
  const config = sheetsConfig();
  if (!config) return "disabled";
  await ensureHeaders(config);

  const orderNumbers = await sheetsRequest<{ values?: unknown[][] }>(config.spreadsheetId, a1(config.tabName, "A2:A"));
  if (orderNumbers.values?.some((row) => String(row[0] ?? "").trim() === order.orderNumber)) return "already_exists";

  const values = orderSheetRow(order);
  let writtenRow = 0;
  // Deux commandes simultanees peuvent viser la meme ligne. Apres ecriture on relit la
  // colonne A : si ce n'est pas notre numero, quelqu'un est passe avant et on recommence
  // plus bas plutot que d'ecraser sa commande.
  for (let attempt = 0; attempt < 4 && !writtenRow; attempt += 1) {
    const row = await nextFreeRow(config);
    const target = a1(config.tabName, `A${row}:S${row}`);
    await sheetsRequest(config.spreadsheetId, target, {
      method: "PUT",
      body: JSON.stringify({ range: target, majorDimension: "ROWS", values: [values] }),
    }, "", "valueInputOption=USER_ENTERED");
    const check = await sheetsRequest<{ values?: unknown[][] }>(config.spreadsheetId, a1(config.tabName, `A${row}`));
    if (String(check.values?.[0]?.[0] ?? "").trim() === order.orderNumber) writtenRow = row;
    else log.warn("sheet.row_taken", { orderNumber: order.orderNumber, row, attempt });
  }
  if (!writtenRow) throw new Error("La ligne Google Sheets n'a pas pu etre reservee apres plusieurs tentatives.");

  /**
   * Bureau ZR choisi par le client, transmis a l'agent.
   *
   * L'agent refuse de creer un colis pickup-point sans zr_hub_id ("hubId is required when
   * deliveryType is pickup-point"). Il n'a aucun moyen de le deviner : c'est la boutique qui
   * fait choisir le bureau au client. Sans cette colonne, toute commande au bureau echoue.
   *
   * Ecrit comme image_url : une colonne que l'agent possede, retrouvee par son en-tete, hors
   * des dix-neuf colonnes A-S. Si l'en-tete zr_hub_id n'existe pas encore dans l'onglet, rien
   * n'est ecrit et l'expedition se comporte comme avant — ajoutez la colonne pour l'activer.
   */
  try {
    const hubColumn = order.deliveryType === "office" && order.deliveryHubId ? await headerIndex(config, "zr_hub_id") : -1;
    if (hubColumn >= 0 && writtenRow) {
      const cell = a1(config.tabName, `${columnLetter(hubColumn)}${writtenRow}`);
      await sheetsRequest(config.spreadsheetId, cell, {
        method: "PUT",
        body: JSON.stringify({ range: cell, majorDimension: "ROWS", values: [[order.deliveryHubId]] }),
      }, "", "valueInputOption=RAW");
    }
  } catch (error) {
    console.warn("Google Sheets zr_hub_id skipped", error instanceof Error ? error.message : error);
  }

  // The photo lives in a column the agent owns, past this file's nineteen, so
  // it is written as a second targeted update rather than widening the append.
  // Never fatal: an order without its photo still gets confirmed, it just
  // arrives as text.
  try {
    const imageUrl = orderImageUrl(order);
    const column = imageUrl ? await headerIndex(config, "image_url") : -1;
    if (imageUrl && column >= 0) {
      const cell = a1(config.tabName, `${columnLetter(column)}${writtenRow}`);
      await sheetsRequest(config.spreadsheetId, cell, {
        method: "PUT",
        body: JSON.stringify({ range: cell, majorDimension: "ROWS", values: [[imageUrl]] }),
      }, "", "valueInputOption=RAW");
    }
  } catch (error) {
    console.warn("Google Sheets image_url skipped", error instanceof Error ? error.message : error);
  }
  return "appended";
}

export type SheetOrderRow = { orderNumber: string; sheetState: string; status: OrderStatus | null; conversation: string };

/**
 * Lit l'etat ET la conversation WhatsApp ecrits par l'agent de confirmation.
 *
 * La boutique n'ecrit que les colonnes A a S ; l'agent en ajoute les siennes a droite,
 * dont convo_log. On la retrouve donc par son en-tete et non par un index fige : l'agent
 * peut inserer une colonne sans que la boutique lise soudain la mauvaise.
 *
 * Une ligne sans etat est conservee ici, car sa conversation peut avoir avance alors que
 * l'agent n'a pas encore conclu. Le tri des etats se fait plus loin.
 */
export async function readOrderStatesFromGoogleSheet(): Promise<SheetOrderRow[]> {
  const config = sheetsConfig();
  if (!config) return [];
  await ensureHeaders(config);
  const conversationColumn = await headerIndex(config, "convo_log").catch(() => -1);
  const response = await sheetsRequest<{ values?: unknown[][] }>(config.spreadsheetId, a1(config.tabName, "A2:BZ"));
  return (response.values ?? []).flatMap((row) => {
    const orderNumber = String(row[0] ?? "").trim();
    if (!orderNumber) return [];
    const sheetState = String(row[18] ?? "").trim();
    const conversation = conversationColumn >= 0 ? String(row[conversationColumn] ?? "").trim() : "";
    if (!sheetState && !conversation) return [];
    return [{ orderNumber, sheetState, status: sheetState ? orderStatusFromSheetState(sheetState) : null, conversation }];
  });
}

export async function syncOrderStatesFromGoogleSheet(): Promise<{ orders: Order[]; updated: number; unknownStates: string[] }> {
  const [orders, sheetRows, lastStates] = await Promise.all([listOrders(), readOrderStatesFromGoogleSheet(), listOrderSheetStates()]);
  const ordersByNumber = new Map(orders.map((order) => [order.orderNumber.toUpperCase(), order]));
  const unknownStates = new Set<string>();
  let updated = 0;

  for (const row of sheetRows) {
    const order = ordersByNumber.get(row.orderNumber.toUpperCase());
    // La conversation avance independamment de l'etat : elle est recopiee avant tout filtrage,
    // sinon une commande dont l'etat n'a pas bouge garderait un fil fige.
    if (order && row.conversation) {
      order.whatsappLog = row.conversation;
      await rememberOrderConversation(order.id, row.conversation).catch(() => undefined);
    }
    if (!row.sheetState) continue;
    if (!row.status) {
      unknownStates.add(row.sheetState);
      continue;
    }
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
  // Best-effort inline export. Whatever happens here, the durable outbox
  // (orders.sheet_synced_at) is the thing that guarantees the row lands: three
  // retries over 1.5 s used to be the only attempt, and a ten-second Google
  // outage silently lost the order for the confirmation agent.
  try {
    await appendOrderToGoogleSheet(order);
    await markOrderSheetSynced(order.id);
  } catch (error) {
    const message = errorMessage(error, "Export Google Sheets impossible.");
    // Not fatal: the row stays in the outbox and the cron will retry it.
    log.warn("sheet.export_deferred", { orderNumber: order.orderNumber, message });
    await recordOrderSheetFailure(order.id, message).catch(() => undefined);
  }
}

export type SheetOutboxResult = { attempted: number; exported: number; alreadyPresent: number; disabled: number; failed: number; errors: string[] };

/**
 * Drains the export outbox. Idempotent by design: appendOrderToGoogleSheet
 * dedupes on order_number, so re-running costs one read and never doubles a row.
 */
export async function drainOrderSheetOutbox(limit = 50): Promise<SheetOutboxResult> {
  const pending = await listOrdersPendingSheetSync(limit);
  const result: SheetOutboxResult = { attempted: pending.length, exported: 0, alreadyPresent: 0, disabled: 0, failed: 0, errors: [] };

  for (const order of pending) {
    try {
      const outcome = await appendOrderToGoogleSheet(order);
      if (outcome === "disabled") {
        // No spreadsheet configured: leave the row queued rather than marking it
        // exported, otherwise configuring Sheets later would skip every order.
        result.disabled += 1;
        continue;
      }
      if (outcome === "already_exists") result.alreadyPresent += 1; else result.exported += 1;
      await markOrderSheetSynced(order.id);
    } catch (error) {
      const message = errorMessage(error, "Export Google Sheets impossible.");
      log.actionRequired("sheet_export_failed", { orderNumber: order.orderNumber, attempts: order.sheetAttempts + 1, message });
      result.failed += 1;
      if (result.errors.length < 5) result.errors.push(`${order.orderNumber}: ${message.slice(0, 200)}`);
      await recordOrderSheetFailure(order.id, message).catch(() => undefined);
    }
  }
  return result;
}
