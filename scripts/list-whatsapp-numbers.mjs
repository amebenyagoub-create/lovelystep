// Diagnostic en lecture seule : qui est le jeton WhatsApp, quels comptes WhatsApp Business
// voit-il, et quels numéros contiennent-ils réellement.
//
// N'écrit rien, n'envoie aucun message, n'affiche aucun jeton.
//
// Lancer :  node scripts/list-whatsapp-numbers.mjs
import { readFileSync } from "node:fs";
import path from "node:path";

function readEnvFile(file) {
  const values = {};
  const raw = readFileSync(file, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return values;
}

const env = readEnvFile(path.join(process.cwd(), ".env.local"));
const version = env.WHATSAPP_GRAPH_API_VERSION || env.META_GRAPH_API_VERSION || "v26.0";
const businessId = env.META_BUSINESS_ID || "1123941784653077";
const declaredPhoneId = env.WHATSAPP_PHONE_NUMBER_ID || "";

const base = `https://graph.facebook.com/${version}`;

async function graph(token, pathname, params = {}) {
  const url = new URL(`${base}/${pathname}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new Error(`${error.message ?? `HTTP ${response.status}`}${error.code ? ` (code ${error.code})` : ""}`);
  }
  return payload;
}

/** Inspecte un jeton : identité, application, comptes WhatsApp visibles et leurs numéros. */
async function inspect(label, token) {
  console.log(`\n=== ${label} ===`);
  if (!token) { console.log("absent de .env.local"); return; }

  try {
    const debug = await graph(token, "debug_token", { input_token: token });
    const data = debug.data ?? {};
    console.log(`application : ${data.app_id ?? "?"}`);
    console.log(`type        : ${data.type ?? "?"}`);
    console.log(`scopes      : ${(data.scopes ?? []).sort().join(", ") || "aucun"}`);
  } catch (error) {
    console.log(`debug_token : ECHEC — ${error.message}`);
  }

  let accounts = [];
  for (const edge of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
    try {
      const listed = await graph(token, `${businessId}/${edge}`, { fields: "id,name", limit: "50" });
      for (const account of listed.data ?? []) accounts.push({ ...account, edge });
    } catch (error) {
      console.log(`${edge} : ECHEC — ${error.message}`);
    }
  }

  if (!accounts.length) { console.log("aucun compte WhatsApp Business visible avec ce jeton"); return; }

  for (const account of accounts) {
    console.log(`\ncompte « ${account.name} » — id ${account.id} (${account.edge})`);
    try {
      const numbers = await graph(token, `${account.id}/phone_numbers`, { fields: "id,display_phone_number,verified_name,quality_rating", limit: "50" });
      const rows = numbers.data ?? [];
      if (!rows.length) { console.log("  aucun numéro"); continue; }
      for (const number of rows) {
        const flag = number.id === declaredPhoneId ? "  <-- WHATSAPP_PHONE_NUMBER_ID de .env.local" : "";
        console.log(`  ${number.display_phone_number} — id ${number.id} — ${number.verified_name ?? "sans nom"}${flag}`);
      }
    } catch (error) {
      console.log(`  numéros : ECHEC — ${error.message}`);
    }
  }
}

console.log(`Portefeuille : ${businessId}`);
console.log(`Graph API    : ${version}`);
console.log(`Phone id declare dans .env.local : ${declaredPhoneId || "aucun"}`);

await inspect("WHATSAPP_ACCESS_TOKEN", env.WHATSAPP_ACCESS_TOKEN);
await inspect("META_ACCESS_TOKEN", env.META_ACCESS_TOKEN);

console.log("\nSi les deux jetons affichent une application differente, c'est la cause :");
console.log("une affectation d'actif ne vaut que pour l'application qui l'a recue.");
