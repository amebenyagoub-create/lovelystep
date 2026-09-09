// Ajoute l'en-tete `zr_hub_id` a l'onglet des commandes, si absent.
//
// L'agent refuse de creer un colis pickup-point sans cet identifiant, et la boutique est la
// seule a le connaitre : c'est elle qui fait choisir le bureau au client. Sans cette colonne,
// aucune commande "au bureau" ne peut partir.
//
// N'ecrit qu'UNE cellule : le titre, dans la premiere colonne libre de la ligne 1.
// Ne touche a aucune donnee. Relancable sans risque.

import { readFileSync } from "node:fs";
import crypto from "node:crypto";

const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));

const account = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON
  || (env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 ? Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, "base64").toString("utf8") : "")
  || readFileSync(env.GOOGLE_SERVICE_ACCOUNT_FILE, "utf8"));

const now = Math.floor(Date.now() / 1000);
const head = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
const claim = Buffer.from(JSON.stringify({ iss: account.client_email, scope: "https://www.googleapis.com/auth/spreadsheets",
  aud: account.token_uri || "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now })).toString("base64url");
const signature = crypto.createSign("RSA-SHA256").update(`${head}.${claim}`).sign(account.private_key.replace(/\\n/g, "\n")).toString("base64url");
const auth = await fetch(account.token_uri || "https://oauth2.googleapis.com/token", { method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${signature}` }) }).then((r) => r.json());
if (!auth.access_token) throw new Error(`Auth Google refusee : ${JSON.stringify(auth).slice(0, 200)}`);

const ID = env.GOOGLE_SHEETS_SPREADSHEET_ID;
const TAB = env.GOOGLE_SHEETS_TAB_NAME || "orders";
const api = (range, init, query = "") =>
  fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ID}/values/${encodeURIComponent(range)}${query ? `?${query}` : ""}`,
    { ...init, headers: { authorization: `Bearer ${auth.access_token}`, "content-type": "application/json", ...(init?.headers ?? {}) } })
    .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 300)); return j; });

const letter = (index) => { let n = index + 1, out = ""; while (n > 0) { const rest = (n - 1) % 26; out = String.fromCharCode(65 + rest) + out; n = Math.floor((n - 1) / 26); } return out; };

const header = (await api(`'${TAB}'!A1:CZ1`)).values?.[0] ?? [];
const existing = header.findIndex((name) => String(name ?? "").trim() === "zr_hub_id");
if (existing >= 0) { console.log(`zr_hub_id existe deja en colonne ${letter(existing)}. Rien a faire.`); process.exit(0); }

// Premiere colonne libre a droite de tout en-tete existant.
let target = header.length;
while (target > 0 && !String(header[target - 1] ?? "").trim()) target -= 1;

/**
 * La grille a une largeur fixe : ecrire au-dela renvoie « exceeds grid limits ».
 * On l'elargit d'abord, du nombre exact de colonnes qui manquent, jamais plus.
 */
const meta = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ID}?fields=sheets(properties(sheetId,title,gridProperties/columnCount))`,
  { headers: { authorization: `Bearer ${auth.access_token}` } }).then((r) => r.json());
const sheet = (meta.sheets ?? []).find((entry) => entry.properties?.title === TAB) ?? meta.sheets?.[0];
if (!sheet) throw new Error(`Onglet « ${TAB} » introuvable.`);
const width = Number(sheet.properties?.gridProperties?.columnCount ?? 0);
if (target >= width) {
  const add = target - width + 1;
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ID}:batchUpdate`, {
    method: "POST",
    headers: { authorization: `Bearer ${auth.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ requests: [{ appendDimension: { sheetId: sheet.properties.sheetId, dimension: "COLUMNS", length: add } }] }),
  }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 300)); return j; });
  console.log(`Grille elargie de ${add} colonne(s) : ${width} -> ${width + add}.`);
}

const range = `'${TAB}'!${letter(target)}1`;
await api(range, { method: "PUT", body: JSON.stringify({ range, majorDimension: "ROWS", values: [["zr_hub_id"]] }) }, "valueInputOption=RAW");
console.log(`zr_hub_id ajoute en colonne ${letter(target)}.`);
console.log("Les commandes au bureau passees APRES le deploiement transmettront le bureau choisi.");
