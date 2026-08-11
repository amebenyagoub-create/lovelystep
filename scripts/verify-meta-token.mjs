// Vérification en lecture seule du jeton Meta et des actifs déclarés dans .env.local.
//
// N'écrit rien chez Meta, n'envoie aucun événement, et n'affiche jamais le jeton.
// Chaque actif est sondé séparément pour qu'une permission manquante soit identifiable.
//
// Lancer :  node scripts/verify-meta-token.mjs
import { readFileSync } from "node:fs";
import path from "node:path";

const envPath = path.join(process.cwd(), ".env.local");

/** Lecture minimale d'un .env : `CLE=valeur`, sans interpolation ni guillemets. */
function readEnvFile(file) {
  const values = {};
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    console.error(`Fichier introuvable : ${file}`);
    console.error("Lancez la commande depuis C:\\Users\\Amatek\\Desktop\\lovelystep");
    process.exit(1);
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return values;
}

const env = readEnvFile(envPath);
const token = env.META_ACCESS_TOKEN ?? "";
const version = env.META_GRAPH_API_VERSION || "v26.0";
const adAccount = env.META_AD_ACCOUNT_ID ?? "";
const catalogId = env.META_CATALOG_ID ?? "";
const datasetId = env.META_DATASET_ID || env.META_PIXEL_ID || env.NEXT_PUBLIC_META_PIXEL_ID || "";

if (!token) {
  console.error("META_ACCESS_TOKEN est vide dans .env.local.");
  process.exit(1);
}

const base = `https://graph.facebook.com/${version}`;
const results = [];

/**
 * Le jeton part dans l'en-tête Authorization, jamais dans l'URL :
 * une URL se retrouve dans les journaux, les proxys et l'historique.
 */
async function graph(pathname, params = {}) {
  const url = new URL(`${base}/${pathname}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = body?.error ?? {};
    throw new Error(`${error.message ?? `HTTP ${response.status}`}${error.code ? ` (code ${error.code})` : ""}`);
  }
  return body;
}

async function probe(label, run) {
  try {
    results.push({ label, ok: true, detail: await run() });
  } catch (error) {
    results.push({ label, ok: false, detail: error instanceof Error ? error.message : "Échec" });
  }
}

await probe("Jeton valide", async () => {
  const me = await graph("me", { fields: "id,name" });
  return `${me.name ?? "utilisateur système"} (${me.id})`;
});

await probe("Permissions", async () => {
  // debug_token accepte le jeton lui-même comme access_token pour un jeton d'utilisateur système.
  const debug = await graph("debug_token", { input_token: token });
  const data = debug.data ?? {};
  const scopes = (data.scopes ?? []).slice().sort();
  const requises = ["ads_read", "catalog_management", "business_management"];
  const manquantes = requises.filter((scope) => !scopes.includes(scope));
  const expiration = data.expires_at === 0 || data.expires_at == null ? "jamais" : new Date(data.expires_at * 1000).toISOString().slice(0, 10);
  const resume = `type ${data.type ?? "?"}, expire ${expiration}, scopes : ${scopes.join(", ") || "aucun"}`;
  if (manquantes.length) throw new Error(`manque ${manquantes.join(", ")} — ${resume}`);
  return resume;
});

if (adAccount) {
  await probe("Compte publicitaire", async () => {
    const id = adAccount.startsWith("act_") ? adAccount : `act_${adAccount}`;
    const account = await graph(id, { fields: "name,currency,timezone_name,account_status" });
    return `${account.name || "sans nom"} — devise ${account.currency}, fuseau ${account.timezone_name}, statut ${account.account_status}`;
  });
}

if (datasetId) {
  await probe("Dataset (Pixel / CAPI)", async () => {
    const dataset = await graph(datasetId, { fields: "name" });
    return `${dataset.name ?? datasetId}`;
  });
}

if (catalogId) {
  await probe("Catalogue", async () => {
    const catalog = await graph(catalogId, { fields: "name,product_count" });
    return `${catalog.name} — ${catalog.product_count ?? 0} produit(s)`;
  });
}

console.log("");
for (const { label, ok, detail } of results) {
  console.log(`${ok ? "[OK]  " : "[ECHEC]"} ${label} : ${detail}`);
}

const failed = results.filter((result) => !result.ok);
console.log("");
if (failed.length) {
  console.log(`${failed.length} vérification(s) en échec.`);
  process.exit(1);
}
console.log("Tout est bon. Le suivi reste désactivé tant que META_TRACKING_ENABLED=false.");
