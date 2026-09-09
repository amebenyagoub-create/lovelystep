// Toutes les incoherences du Google Sheet, en une passe. LECTURE SEULE, n'ecrit jamais.
//
// Le tableau de bord lit l'etat de la colonne `state`. Chaque anomalie ci-dessous se traduit
// par un chiffre faux dans /admin : un etat inconnu ne met jamais a jour la commande, un colis
// que ZR fait avancer sans que l'agent suive reste bloque, une ligne sans telephone ne sera
// jamais confirmee. Aucune ne leve d'erreur toute seule.
//
// Lancer : node scripts/sheet-consistency.mjs

import { readFileSync } from "node:fs";
import crypto from "node:crypto";

// Vocabulaire reconnu par SHEET_STATES dans lib/google-sheets.ts. Un etat absent d'ici est
// ignore par la boutique : le statut de la commande ne bougera jamais.
const KNOWN = new Set(["NEW","CREATED","TO_CONFIRM","PENDING_CONFIRMATION","CONFIRM_SENT","CONFIRMATION_SENT",
  "AWAITING_REPLY","AWAITING_RESPONSE","WAITING_CUSTOMER","NEEDS_HUMAN","NEEDS_REVIEW","HUMAN","QUEUED",
  "AGENT_TALKING","SCHEDULED","NO_REPLY","CONFIRMED","CONFIRME","ACCEPTED","VALIDATED","PREPARING","PROCESSING",
  "ZR_CREATED","PARCEL_CREATED","ZR_ERROR","SHIPPED","IN_TRANSIT","OUT_FOR_DELIVERY","ARRIVED_WILAYA",
  "MISSED_ATTEMPT","STALLED","EXPEDIEE","DELIVERED","LIVREE","REFUSED","REJECTED","RETURNED","RETOURNEE",
  "CANCELLED","CANCELED","ANNULEE"]);
const TERMINAL = new Set(["DELIVERED","LIVREE","RETURNED","RETOURNEE","CANCELLED","CANCELED","ANNULEE","REFUSED","REJECTED"]);
const PRE_DISPATCH = new Set(["","NEW","QUEUED","CONFIRM_SENT","AGENT_TALKING","SCHEDULED","NO_REPLY","HUMAN",
  "NEEDS_REVIEW","CONFIRMED","ZR_ERROR"]);
const SHIPPED_ISH = new Set(["ZR_CREATED","IN_TRANSIT","ARRIVED_WILAYA","OUT_FOR_DELIVERY","MISSED_ATTEMPT","STALLED","DELIVERED","RETURNED"]);

const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));

function serviceAccount() {
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON
    || (env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 ? Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, "base64").toString("utf8") : "")
    || (env.GOOGLE_SERVICE_ACCOUNT_FILE ? readFileSync(env.GOOGLE_SERVICE_ACCOUNT_FILE, "utf8") : "");
  if (!raw) throw new Error("Aucun compte de service Google dans .env.local");
  return JSON.parse(raw);
}
async function token() {
  const a = serviceAccount(); const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const c = Buffer.from(JSON.stringify({ iss: a.client_email, scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: a.token_uri || "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now })).toString("base64url");
  const sig = crypto.createSign("RSA-SHA256").update(`${h}.${c}`).sign(a.private_key.replace(/\\n/g, "\n")).toString("base64url");
  const r = await fetch(a.token_uri || "https://oauth2.googleapis.com/token", { method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${h}.${c}.${sig}` }) });
  const p = await r.json(); if (!p.access_token) throw new Error(`Auth Google refusee : ${JSON.stringify(p).slice(0, 200)}`);
  return p.access_token;
}

const ID = env.GOOGLE_SHEETS_SPREADSHEET_ID;
const TAB = env.GOOGLE_SHEETS_TAB_NAME || "orders";
const bearer = await token();
const grid = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ID}/values/${encodeURIComponent(`'${TAB}'!A1:BZ`)}`,
  { headers: { authorization: `Bearer ${bearer}` } }).then((r) => r.json());

const values = grid.values ?? [];
const header = (values[0] ?? []).map((v) => String(v ?? "").trim());
const idx = Object.fromEntries(header.map((name, position) => [name, position]));
const need = ["order_id", "state", "phone_e164", "zr_tracking", "zr_state", "state_at", "wilaya_id", "commune", "cod_total"];
const missing = need.filter((name) => !(name in idx));
if (missing.length) console.log(`En-tetes absents : ${missing.join(", ")}\n`);

const get = (row, name) => String(row[idx[name]] ?? "").trim();
const rows = values.slice(1).map((row, i) => ({ line: i + 2, row })).filter(({ row }) => row?.some((c) => String(c ?? "").trim()));

const problems = new Map();
const add = (kind, line, detail) => problems.set(kind, [...(problems.get(kind) ?? []), `ligne ${line}${detail ? ` — ${detail}` : ""}`]);

const seen = new Map();
const hoursAgo = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? (Date.now() - t) / 3_600_000 : null; };

for (const { line, row } of rows) {
  const id = get(row, "order_id");
  const state = get(row, "state").toUpperCase();
  const zrState = get(row, "zr_state");
  const tracking = get(row, "zr_tracking");
  const age = hoursAgo(get(row, "state_at"));

  if (!id) { add("Ligne sans numero de commande (invisible pour l'agent)", line); continue; }
  if (seen.has(id)) add("Numero de commande en double (compte deux fois dans les KPI)", line, `${id}, deja ligne ${seen.get(id)}`);
  else seen.set(id, line);

  if (state && !KNOWN.has(state)) add("Etat INCONNU de la boutique (le statut ne bougera jamais)", line, `${id} : « ${state} »`);
  if (!state) add("Etat vide (l'agent la traitera comme neuve)", line, id);
  if (!get(row, "phone_e164")) add("Telephone E164 absent (aucun message possible)", line, id);
  if (!get(row, "wilaya_id") || !get(row, "commune")) add("Wilaya ou commune manquante (ZR refusera le colis)", line, id);
  if (!get(row, "cod_total")) add("Montant COD absent", line, id);

  if (SHIPPED_ISH.has(state) && !tracking) add("Etat d'expedition sans numero de suivi ZR", line, `${id} : ${state}`);
  if (zrState && PRE_DISPATCH.has(state)) add("ZR a avance mais l'etat n'a pas suivi (statut ZR non reconnu)", line, `${id} : state=${state || "(vide)"} / zr_state=« ${zrState} »`);
  if (!TERMINAL.has(state) && age !== null && age > 72) add("Bloquee depuis plus de 72 h", line, `${id} : ${state} depuis ${Math.round(age / 24)} j`);
  if (TERMINAL.has(state) && SHIPPED_ISH.has(state) && !zrState) add("Etat terminal sans confirmation ZR (saisi a la main ?)", line, `${id} : ${state}`);
}

console.log(`Onglet « ${TAB} » — ${rows.length} ligne(s) de commande\n`);
if (!problems.size) { console.log("Aucune incoherence detectee."); process.exit(0); }
for (const [kind, list] of [...problems].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${kind} : ${list.length}`);
  for (const item of list.slice(0, 12)) console.log(`   ${item}`);
  if (list.length > 12) console.log(`   … et ${list.length - 12} autre(s)`);
  console.log("");
}
