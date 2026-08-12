// Vérification en lecture seule de la configuration WhatsApp Cloud API.
//
// N'envoie aucun message, n'écrit rien chez Meta, et n'affiche jamais le jeton ni le secret.
// Chaque élément est sondé séparément pour qu'une erreur soit localisable.
//
// Lancer :  node scripts/verify-whatsapp.mjs
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
const token = env.WHATSAPP_ACCESS_TOKEN ?? "";
const appSecret = env.WHATSAPP_APP_SECRET || env.META_APP_SECRET || "";
const businessNumber = env.WHATSAPP_BUSINESS_NUMBER ?? "";
const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID ?? "";
const verifyToken = env.WHATSAPP_VERIFY_TOKEN ?? "";
const version = env.WHATSAPP_GRAPH_API_VERSION || env.META_GRAPH_API_VERSION || "v26.0";
const site = (env.SITE_URL || env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");

if (!token) {
  console.error("WHATSAPP_ACCESS_TOKEN est vide dans .env.local.");
  process.exit(1);
}

const base = `https://graph.facebook.com/${version}`;
const results = [];

/** Le jeton part dans l'en-tête Authorization, jamais dans l'URL. */
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

// --- configuration locale, sans appel réseau ------------------------------------------------

await probe("Configuration locale", async () => {
  const problems = [];
  if (!/^\d{8,15}$/.test(businessNumber.replace(/[\s()+-]/g, ""))) problems.push("WHATSAPP_BUSINESS_NUMBER mal formé");
  if (!/^\d{5,30}$/.test(phoneNumberId)) problems.push("WHATSAPP_PHONE_NUMBER_ID mal formé");
  if (verifyToken.length < 16) problems.push("WHATSAPP_VERIFY_TOKEN trop court (16 caractères minimum)");
  if (!appSecret) problems.push("WHATSAPP_APP_SECRET absent : les webhooks seront tous rejetés");
  if (!site.startsWith("https://")) problems.push("SITE_URL n'est pas une origine HTTPS");
  if (problems.length) throw new Error(problems.join(" · "));
  return `numéro ${businessNumber}, Graph ${version}, site ${site}`;
});

// --- appels Meta en lecture seule -----------------------------------------------------------

await probe("Numéro WhatsApp", async () => {
  const number = await graph(phoneNumberId, { fields: "display_phone_number,verified_name,quality_rating,code_verification_status" });
  const declared = businessNumber.replace(/\D/g, "");
  const actual = String(number.display_phone_number ?? "").replace(/\D/g, "");
  const match = declared && actual && actual.endsWith(declared.slice(-9));
  return `${number.display_phone_number ?? phoneNumberId} — ${number.verified_name ?? "nom non vérifié"}, qualité ${number.quality_rating ?? "inconnue"}${match ? "" : " ⚠ ne correspond pas à WHATSAPP_BUSINESS_NUMBER"}`;
});

await probe("Jeton", async () => {
  const debug = await graph("debug_token", { input_token: token });
  const data = debug.data ?? {};
  const expiration = data.expires_at === 0 || data.expires_at == null
    ? "jamais"
    : new Date(data.expires_at * 1000).toLocaleString("fr-FR");
  const scopes = (data.scopes ?? []).slice().sort();
  if (!scopes.includes("whatsapp_business_messaging")) {
    throw new Error(`permission whatsapp_business_messaging absente — scopes : ${scopes.join(", ") || "aucun"}`);
  }
  const temporary = data.type !== "SYSTEM_USER" && expiration !== "jamais";
  return `type ${data.type ?? "?"}, expire ${expiration}${temporary ? " ⚠ jeton temporaire : à remplacer par un jeton d'utilisateur système avant la production" : ""}`;
});

// --- webhook joignable publiquement ----------------------------------------------------------

if (site.startsWith("https://")) {
  await probe("Webhook public", async () => {
    const url = new URL("/api/whatsapp/webhook", site);
    // Simule la vérification Meta avec un jeton volontairement faux : on attend un refus.
    url.searchParams.set("hub.mode", "subscribe");
    url.searchParams.set("hub.verify_token", "valeur-volontairement-incorrecte");
    url.searchParams.set("hub.challenge", "ping");
    const response = await fetch(url);
    if (response.status === 403) return `${url.origin}/api/whatsapp/webhook répond et refuse un mauvais jeton`;
    if (response.status === 200) throw new Error("le webhook accepte n'importe quel jeton de vérification : WHATSAPP_VERIFY_TOKEN n'est pas lu côté serveur");
    throw new Error(`réponse inattendue : HTTP ${response.status} (le site déployé n'a peut-être pas encore les variables WhatsApp)`);
  });
}

console.log("");
for (const { label, ok, detail } of results) console.log(`${ok ? "[OK]  " : "[ECHEC]"} ${label} : ${detail}`);

const failed = results.filter((result) => !result.ok);
console.log("");
if (failed.length) {
  console.log(`${failed.length} vérification(s) en échec.`);
  process.exit(1);
}
console.log(`Configuration WhatsApp cohérente. URL à déclarer dans Meta : ${site}/api/whatsapp/webhook`);
