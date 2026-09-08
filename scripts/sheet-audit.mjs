// Ou commencent reellement les lignes de commande dans le Google Sheet ?
//
// Une ligne decalee est invisible pour l'agent de confirmation : il cherche le numero de
// commande en colonne A. S'il ne le trouve pas, il ne connait pas la commande, et le client
// n'est jamais appele. C'est une commande perdue, pas un probleme cosmetique.
//
// LECTURE SEULE par defaut. --fix realigne les lignes decalees vers la colonne A ;
// il ecrit dans le Sheet, donc lancez-le d'abord sans, et lisez ce qu'il annonce.
//
// Lancer :
//   node scripts/sheet-audit.mjs
//   node scripts/sheet-audit.mjs --fix

import { readFileSync } from "node:fs";
import crypto from "node:crypto";

const FIX = process.argv.includes("--fix");

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => { const at = line.indexOf("="); return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^["']|["']$/g, "")]; }),
);

function serviceAccount() {
  const inline = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const encoded = env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  const file = env.GOOGLE_SERVICE_ACCOUNT_FILE;
  const raw = inline || (encoded ? Buffer.from(encoded, "base64").toString("utf8") : "") || (file ? readFileSync(file, "utf8") : "");
  if (!raw) throw new Error("Aucun compte de service Google dans .env.local");
  return JSON.parse(raw);
}

async function accessToken() {
  const account = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claim = Buffer.from(JSON.stringify({
    iss: account.client_email, scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: account.token_uri || "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now,
  })).toString("base64url");
  const signature = crypto.createSign("RSA-SHA256").update(`${header}.${claim}`).sign(account.private_key.replace(/\\n/g, "\n")).toString("base64url");
  const response = await fetch(account.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claim}.${signature}` }),
  });
  const payload = await response.json();
  if (!payload.access_token) throw new Error(`Auth Google refusee : ${JSON.stringify(payload).slice(0, 300)}`);
  return payload.access_token;
}

const ID = env.GOOGLE_SHEETS_SPREADSHEET_ID;
const TAB = env.GOOGLE_SHEETS_TAB_NAME || "orders";
const token = await accessToken();
const api = (range, init, suffix = "", query = "") =>
  fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ID}/values/${encodeURIComponent(range)}${suffix}${query ? `?${query}` : ""}`,
    { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init?.headers ?? {}) } })
    .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 300)); return j; });

const letter = (index) => { let n = index + 1, s = ""; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

const grid = await api(`'${TAB}'!A1:BZ`);
const rows = grid.values ?? [];
const header = rows[0] ?? [];
console.log(`Onglet « ${TAB} » — ${rows.length - 1} ligne(s) sous l'en-tete\n`);
console.log("En-tete :");
header.forEach((name, index) => { if (String(name ?? "").trim()) console.log(`  ${letter(index).padEnd(3)} ${name}`); });

const ORDER = /^LS-\d{6}-[A-F0-9]{8}$/i;
const shifted = [];
const clean = [];
for (let i = 1; i < rows.length; i += 1) {
  const row = rows[i];
  if (!row || !row.some((cell) => String(cell ?? "").trim())) continue;
  const at = row.findIndex((cell) => ORDER.test(String(cell ?? "").trim()));
  if (at === 0) { clean.push(i + 1); continue; }
  if (at > 0) { shifted.push({ line: i + 1, at, number: String(row[at]).trim(), row }); continue; }
  console.log(`  ligne ${i + 1} : aucun numero de commande reconnu`);
}

console.log(`\nLignes correctes (numero en colonne A) : ${clean.length}`);
console.log(`Lignes DECALEES : ${shifted.length}`);
for (const item of shifted) {
  console.log(`  ligne ${item.line} : ${item.number} commence en colonne ${letter(item.at)} (decalage de ${item.at})`);
}

if (!shifted.length) { console.log("\nRien a reparer."); process.exit(0); }
if (!FIX) { console.log("\nRelancez avec --fix pour realigner ces lignes sur la colonne A."); process.exit(0); }

for (const item of shifted) {
  const values = item.row.slice(item.at, item.at + 19);
  while (values.length < 19) values.push("");
  const range = `'${TAB}'!A${item.line}:S${item.line}`;
  await api(range, { method: "PUT", body: JSON.stringify({ range, majorDimension: "ROWS", values: [values] }) }, "", "valueInputOption=USER_ENTERED");
  // Les cellules laissees a droite appartenaient a la meme ligne decalee : on les vide pour
  // ne pas laisser un second exemplaire du numero de commande dans la feuille.
  const tailFrom = Math.max(19, item.at);
  const tail = `'${TAB}'!${letter(tailFrom)}${item.line}:${letter(item.at + 18)}${item.line}`;
  if (item.at + 18 >= tailFrom) await api(tail, { method: "POST", body: "{}" }, ":clear");
  console.log(`  ligne ${item.line} realignee (${item.number})`);
}
console.log(`\n${shifted.length} ligne(s) realignee(s). L'agent les verra a son prochain passage.`);
