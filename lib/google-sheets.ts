import "server-only";

import { readFile } from "node:fs/promises";
import { createSign } from "node:crypto";
import { adoptSheetDelivery, listOrders, listOrderSheetStates, listOrdersPendingSheetSync, markOrderSheetSynced, recordOrderSheetFailure, rememberOrderConversation, rememberOrderSheetState, updateOrderStatus } from "./db-postgres";
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

/** L'etat de la feuille ramene au vocabulaire de l'agent : sans accents, en majuscules. */
function normalizedSheetState(value: unknown): string {
  return String(value ?? "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/**
 * Etats ou une correction de la boutique peut encore etre recopiee dans la feuille.
 *
 * Au-dela, l'agent a deja cree le colis chez ZR Express. Reecrire l'adresse ou le telephone
 * ne changerait plus rien au colis en route, et ferait diverger la feuille de ce que le
 * transporteur detient reellement. Une commande arrivee la se corrige chez ZR, pas ici.
 */
const SHEET_STATES_STILL_EDITABLE = new Set([
  "", "NEW", "QUEUED", "NEEDS_REVIEW", "CONFIRM_SENT", "AGENT_TALKING",
  "HUMAN", "SCHEDULED", "NO_REPLY", "CONFIRMED", "ZR_ERROR",
]);

/** Etats ou la commande est finie : ni correction, ni annulation a pousser. */
const SHEET_STATES_TERMINAL = new Set(["DELIVERED", "RETURNED", "CANCELLED"]);

export function orderStatusFromSheetState(value: unknown): OrderStatus | null {
  return SHEET_STATES[normalizedSheetState(value)] ?? null;
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
 * Positions de colonnes, trouvees par NOM dans la ligne d'en-tete, en une seule lecture.
 *
 * L'agent possede les colonnes au-dela des dix-neuf de ce fichier, et son schema a deja
 * grandi. Figer une position ici mettrait la boutique a une evolution pres d'ecrire une photo
 * de produit dans, par exemple, la colonne du suivi ZR.
 *
 * Groupe plutot qu'une colonne a la fois : la synchronisation en lit trois a chaque passage du
 * travail planifie, toutes les cinq minutes -- trois allers-retours Google la ou un suffit.
 */
async function headerIndexes(config: SheetsConfig, names: readonly string[]): Promise<Record<string, number>> {
  const response = await sheetsRequest<{ values?: unknown[][] }>(
    config.spreadsheetId, a1(config.tabName, "A1:BZ1"));
  const headers = (response.values?.[0] ?? []).map((value) => String(value ?? "").trim());
  const found: Record<string, number> = {};
  for (const name of names) found[name] = headers.indexOf(name);
  return found;
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

/**
 * Ligne (numerotee comme dans la feuille) et etat actuel d'une commande deja exportee.
 *
 * On lit A2:S d'un coup plutot que la seule colonne A : l'etat sert immediatement a decider
 * si la ligne peut encore etre corrigee, et le relire ensuite couterait un second appel.
 */
async function findOrderRow(config: SheetsConfig, orderNumber: string): Promise<{ row: number; state: string; cells: unknown[] } | null> {
  const grid = await sheetsRequest<{ values?: unknown[][] }>(config.spreadsheetId, a1(config.tabName, "A2:S"));
  const rows = grid.values ?? [];
  for (let index = 0; index < rows.length; index += 1) {
    if (String(rows[index]?.[0] ?? "").trim() === orderNumber) {
      return { row: index + 2, state: String(rows[index]?.[18] ?? "").trim(), cells: rows[index] ?? [] };
    }
  }
  return null;
}

/**
 * Fusionne la ligne corrigee avec celle deja presente, sans jamais vider une case remplie.
 *
 * La boutique laisse plusieurs de ces colonnes vides -- `phone_alt` notamment, qu'elle ne
 * collecte pas -- alors que l'agent, lui, peut les avoir remplies en parlant au client.
 * Reecrire la ligne telle quelle effacerait ce travail : une correction d'adresse ferait
 * perdre le second numero de telephone, c'est-a-dire parfois le seul moyen de joindre le
 * client avant que le livreur ne parte.
 *
 * Regle : une valeur vide (ou `false`) venant de la boutique n'est pas une opinion, c'est une
 * absence -- elle ne remplace jamais une case qui contient deja quelque chose. Tout le reste
 * -- nom, telephone, wilaya, commune, adresse, articles, montant -- ecrase, puisque c'est
 * precisement ce que la correction vient changer.
 */
function mergedSheetRow(values: Array<string | number | boolean>, existing: unknown[]): Array<string | number | boolean> {
  return values.map((value, index) => {
    const absent = value === "" || value === false;
    const current = String(existing[index] ?? "").trim();
    return absent && current ? current : value;
  });
}

/**
 * Les deux colonnes que la boutique ecrit au-dela de ses dix-neuf : la photo du produit et le
 * bureau de retrait choisi par le client.
 *
 * Elles appartiennent a l'agent et sont retrouvees par leur en-tete, jamais par une position
 * figee : l'agent a deja ajoute des colonnes, et un index en dur ecrirait un jour une photo
 * dans la colonne du suivi ZR.
 *
 * Jamais fatal. Une commande sans photo se confirme quand meme, en texte ; l'absence de
 * bureau est en revanche signalee, parce qu'elle enverra le colis dans un bureau devine.
 */
async function writeAgentColumns(config: SheetsConfig, order: Order, row: number): Promise<void> {
  try {
    const imageUrl = orderImageUrl(order);
    const hubId = order.deliveryType === "office" ? String(order.deliveryHubId ?? "").trim() : "";
    // Une commande au bureau sans bureau : l'agent en devinera un a partir de la commune, et
    // le client peut se deplacer au mauvais endroit. Ce n'est pas bloquant, mais ca ne doit
    // pas rester muet -- c'est exactement ce qui est arrive a toutes les commandes au bureau.
    if (order.deliveryType === "office" && !hubId) {
      log.actionRequired("sheet_office_order_without_hub", { orderNumber: order.orderNumber, wilaya: order.wilayaCode });
    }
    if (!imageUrl && !hubId) return;
    const columns = await headerIndexes(config, ["image_url", "zr_hub_id"]);
    const writes: Array<[number, string]> = [];
    if (imageUrl && columns.image_url >= 0) writes.push([columns.image_url, imageUrl]);
    if (hubId && columns.zr_hub_id >= 0) writes.push([columns.zr_hub_id, hubId]);
    for (const [index, value] of writes) {
      const cell = a1(config.tabName, `${columnLetter(index)}${row}`);
      await sheetsRequest(config.spreadsheetId, cell, {
        method: "PUT",
        body: JSON.stringify({ range: cell, majorDimension: "ROWS", values: [[value]] }),
      }, "", "valueInputOption=RAW");
    }
  } catch (error) {
    log.warn("sheet.agent_columns_skipped", { orderNumber: order.orderNumber, message: errorMessage(error, "colonnes agent ignorees") });
  }
}

/**
 * Ecrit la commande dans la feuille : creation si elle est absente, MISE A JOUR sinon.
 *
 * La mise a jour n'existait pas. Une commande corrigee au back-office -- telephone, commune,
 * articles -- etait remise dans la file d'export, puis l'export repondait « deja presente »
 * et la marquait exportee. La correction n'atteignait donc jamais l'agent : le client etait
 * rappele sur l'ancien numero et le colis partait a l'ancienne adresse, sans qu'aucune erreur
 * ne soit levee nulle part.
 *
 * La colonne `state` (S) n'est JAMAIS reecrite ici. Elle appartient a l'agent : c'est sa
 * machine a etats, pas un champ d'affichage. La boutique n'y ecrit qu'a la creation de la
 * ligne, et pour une annulation (voir pushOrderCancellationToGoogleSheet).
 *
 * L'ecriture se fait sur une ligne calculee, jamais par :append. :append ne recoit pas une
 * destination mais une plage ou Google DEVINE le tableau, puis ecrit a partir du bord gauche
 * de ce qu'il a devine. Sur cette feuille il s'est trompe : des commandes sont parties en
 * colonne M au lieu de A. L'agent cherche le numero de commande en colonne A ; une ligne
 * decalee lui est invisible, le client n'est jamais appele, et la commande est perdue en
 * silence.
 */
export async function appendOrderToGoogleSheet(order: Order): Promise<"appended" | "updated" | "already_exists" | "disabled"> {
  const config = sheetsConfig();
  if (!config) return "disabled";
  await ensureHeaders(config);

  const values = orderSheetRow(order);
  const existing = await findOrderRow(config, order.orderNumber);

  if (existing) {
    if (!SHEET_STATES_STILL_EDITABLE.has(normalizedSheetState(existing.state))) {
      // Le colis est deja chez ZR Express : la feuille ne doit plus bouger.
      log.warn("sheet.update_skipped_dispatched", { orderNumber: order.orderNumber, state: existing.state });
      return "already_exists";
    }
    // A..R : les dix-huit colonnes de la boutique. La dix-neuvieme, `state`, reste a l'agent.
    const target = a1(config.tabName, `A${existing.row}:R${existing.row}`);
    await sheetsRequest(config.spreadsheetId, target, {
      method: "PUT",
      body: JSON.stringify({ range: target, majorDimension: "ROWS", values: [mergedSheetRow(values.slice(0, 18), existing.cells)] }),
    }, "", "valueInputOption=USER_ENTERED");
    await writeAgentColumns(config, order, existing.row);
    log.info("sheet.row_updated", { orderNumber: order.orderNumber, row: existing.row });
    return "updated";
  }

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

  await writeAgentColumns(config, order, writtenRow);
  return "appended";
}

export type SheetCancellationResult = "written" | "not_in_sheet" | "already_final" | "dispatched" | "disabled";

/**
 * Ecrit l'annulation dans la feuille pour que l'agent cesse de relancer le client.
 *
 * C'etait le trou le plus couteux du systeme : une commande annulee au back-office restait
 * « en attente de confirmation » dans la feuille, donc l'agent continuait a ecrire au client
 * et finissait par creer le colis d'une commande annulee.
 *
 * CANCELLED est la seule valeur que la boutique ecrit dans la colonne `state`, et elle est
 * sure : l'agent la traite comme terminale, la ligne sort simplement de toutes ses files
 * (admission, relance, suivi). Aucune autre valeur ne serait sans risque -- ecrire un etat
 * intermediaire reviendrait a piloter sa machine a etats depuis l'exterieur.
 *
 * Une ligne dont le colis existe deja n'est PAS touchee : annuler ici ne rappellerait pas le
 * colis, il faut l'annuler chez ZR Express. On le dit a l'operateur plutot que de lui laisser
 * croire que c'est fait.
 */
export async function pushOrderCancellationToGoogleSheet(orderNumber: string, reason: string): Promise<SheetCancellationResult> {
  const config = sheetsConfig();
  if (!config) return "disabled";
  await ensureHeaders(config);

  const existing = await findOrderRow(config, orderNumber);
  if (!existing) return "not_in_sheet";
  const state = normalizedSheetState(existing.state);
  if (SHEET_STATES_TERMINAL.has(state)) return "already_final";
  if (!SHEET_STATES_STILL_EDITABLE.has(state)) return "dispatched";

  const columns = await headerIndexes(config, ["state", "state_at", "cancel_reason"]);
  const written: Array<[number, string]> = [
    [columns.state, "CANCELLED"],
    [columns.state_at, new Date().toISOString()],
    [columns.cancel_reason, reason.slice(0, 200)],
  ];
  for (const [index, value] of written) {
    if (index < 0) continue;
    const cell = a1(config.tabName, `${columnLetter(index)}${existing.row}`);
    await sheetsRequest(config.spreadsheetId, cell, {
      method: "PUT",
      body: JSON.stringify({ range: cell, majorDimension: "ROWS", values: [[value]] }),
    }, "", "valueInputOption=RAW");
  }
  log.info("sheet.cancellation_pushed", { orderNumber, row: existing.row, from: existing.state });
  return "written";
}

export type SheetOrderRow = {
  orderNumber: string;
  sheetState: string;
  status: OrderStatus | null;
  conversation: string;
  tracking: string;
  parcelId: string;
};

/**
 * Lit ce que l'agent a ecrit : l'etat, la conversation WhatsApp, et les identifiants du colis.
 *
 * La boutique n'ecrit que les colonnes A a S ; l'agent ajoute les siennes a droite. On les
 * retrouve donc par leur en-tete et non par un index fige : l'agent peut inserer une colonne
 * sans que la boutique lise soudain la mauvaise.
 *
 * Une ligne sans etat est conservee ici, car sa conversation ou son colis peuvent avoir
 * avance alors que l'agent n'a pas encore conclu. Le tri se fait plus loin.
 */
export async function readOrderStatesFromGoogleSheet(): Promise<SheetOrderRow[]> {
  const config = sheetsConfig();
  if (!config) return [];
  await ensureHeaders(config);
  const columns = await headerIndexes(config, ["convo_log", "zr_tracking", "zr_parcel_id"])
    .catch(() => ({ convo_log: -1, zr_tracking: -1, zr_parcel_id: -1 } as Record<string, number>));
  const response = await sheetsRequest<{ values?: unknown[][] }>(config.spreadsheetId, a1(config.tabName, "A2:BZ"));
  const cell = (row: unknown[], index: number) => (index >= 0 ? String(row[index] ?? "").trim() : "");
  return (response.values ?? []).flatMap((row) => {
    const orderNumber = String(row[0] ?? "").trim();
    if (!orderNumber) return [];
    const sheetState = String(row[18] ?? "").trim();
    const conversation = cell(row, columns.convo_log);
    const tracking = cell(row, columns.zr_tracking);
    const parcelId = cell(row, columns.zr_parcel_id);
    if (!sheetState && !conversation && !tracking && !parcelId) return [];
    return [{ orderNumber, sheetState, status: sheetState ? orderStatusFromSheetState(sheetState) : null, conversation, tracking, parcelId }];
  });
}

export type SheetStateSyncResult = { orders: Order[]; updated: number; unknownStates: string[]; parcelsAdopted: number };

export async function syncOrderStatesFromGoogleSheet(): Promise<SheetStateSyncResult> {
  const [orders, sheetRows, lastStates] = await Promise.all([listOrders(), readOrderStatesFromGoogleSheet(), listOrderSheetStates()]);
  const ordersByNumber = new Map(orders.map((order) => [order.orderNumber.toUpperCase(), order]));
  const unknownStates = new Set<string>();
  let updated = 0;
  let parcelsAdopted = 0;

  for (const row of sheetRows) {
    const order = ordersByNumber.get(row.orderNumber.toUpperCase());
    // La conversation avance independamment de l'etat : elle est recopiee avant tout filtrage,
    // sinon une commande dont l'etat n'a pas bouge garderait un fil fige.
    if (order && row.conversation) {
      order.whatsappLog = row.conversation;
      await rememberOrderConversation(order.id, row.conversation).catch(() => undefined);
    }

    /**
     * Le colis existe des l'instant ou l'agent ecrit son identifiant, bien avant que l'etat
     * n'atteigne « expediee ». On le recopie donc ici, hors du filtrage par etat : c'est ce
     * qui empeche la boutique de proposer d'envoyer a ZR une commande deja partie, et de
     * laisser modifier ou supprimer une commande qui roule.
     */
    if (order && (row.parcelId || row.tracking)) {
      const adopted = await adoptSheetDelivery(order.id, row.parcelId || null, row.tracking || null).catch(() => false);
      if (adopted) {
        order.deliveryExternalId = row.parcelId || order.deliveryExternalId;
        order.deliveryTracking = row.tracking || order.deliveryTracking;
        order.deliverySyncStatus = "sent";
        order.deliverySyncError = null;
        parcelsAdopted += 1;
      }
    }

    if (!row.sheetState) continue;
    if (!row.status) {
      unknownStates.add(row.sheetState);
      continue;
    }
    if (!order || lastStates.get(order.id) === row.sheetState) continue;
    if (order.status !== row.status) {
      const result = await updateOrderStatus(order.id, row.status, null, "google_sheet", `État Google Sheets : ${row.sheetState}`);
      // Echec (stock indisponible par exemple) : on ne memorise pas l'etat, pour que le
      // passage suivant du cron retente au lieu de considerer la ligne comme traitee.
      if (result !== "updated") continue;
      order.status = row.status;
      updated += 1;
    }
    /**
     * L'etat brut est recopie meme quand le statut a neuf valeurs ne bouge pas.
     *
     * MISSED_ATTEMPT, STALLED et OUT_FOR_DELIVERY se replient tous les trois sur
     * « expediee » : sans cette recopie a jour, un colis qui passe en echec de livraison --
     * le signal le plus rentable du systeme -- n'apparait nulle part dans le back-office
     * avant le passage suivant.
     */
    order.sheetState = row.sheetState;
    await rememberOrderSheetState(order.id, row.sheetState);
  }
  return { orders, updated, unknownStates: [...unknownStates], parcelsAdopted };
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

export type SheetOutboxResult = { attempted: number; exported: number; refreshed: number; alreadyPresent: number; disabled: number; failed: number; errors: string[] };

/**
 * Vide la file d'export. Idempotent par construction : appendOrderToGoogleSheet retrouve la
 * ligne par son numero de commande, donc rejouer la file coute une lecture et ne cree jamais
 * de doublon. Une commande corrigee depuis l'export voit sa ligne mise a jour (`refreshed`)
 * au lieu d'etre ignoree -- c'est ce qui fait arriver la correction jusqu'a l'agent.
 */
export async function drainOrderSheetOutbox(limit = 50): Promise<SheetOutboxResult> {
  const pending = await listOrdersPendingSheetSync(limit);
  const result: SheetOutboxResult = { attempted: pending.length, exported: 0, refreshed: 0, alreadyPresent: 0, disabled: 0, failed: 0, errors: [] };

  for (const order of pending) {
    try {
      const outcome = await appendOrderToGoogleSheet(order);
      if (outcome === "disabled") {
        // No spreadsheet configured: leave the row queued rather than marking it
        // exported, otherwise configuring Sheets later would skip every order.
        result.disabled += 1;
        continue;
      }
      if (outcome === "already_exists") result.alreadyPresent += 1;
      else if (outcome === "updated") result.refreshed += 1;
      else result.exported += 1;
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
