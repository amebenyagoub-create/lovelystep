// Vérifie — et au besoin crée — l'abonnement de l'application Meta au compte WhatsApp Business.
//
// Sans cet abonnement, Meta n'appelle jamais le webhook : les messages entrants sont perdus
// sans aucune erreur visible, ni côté Meta ni côté serveur.
//
// Lecture seule par défaut.  node scripts/whatsapp-subscription.mjs
// Abonnement                node scripts/whatsapp-subscription.mjs --subscribe
import { readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_WABA_ID = "2107937583135062";

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
const token = env.WHATSAPP_ACCESS_TOKEN || env.META_ACCESS_TOKEN || "";
const wabaId = process.argv.find((arg) => /^\d{10,}$/.test(arg)) || DEFAULT_WABA_ID;
const doSubscribe = process.argv.includes("--subscribe");

if (!token) {
  console.error("Aucun jeton dans .env.local.");
  process.exit(1);
}

const base = `https://graph.facebook.com/${version}`;

async function graph(pathname, { method = "GET" } = {}) {
  const response = await fetch(`${base}/${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new Error(`${error.message ?? `HTTP ${response.status}`}${error.code ? ` (code ${error.code})` : ""}`);
  }
  return payload;
}

console.log(`WABA      : ${wabaId}`);
console.log(`Graph API : ${version}`);
console.log("");

let appId = "?";
try {
  const debug = await graph(`debug_token?input_token=${encodeURIComponent(token)}`);
  appId = String(debug?.data?.app_id ?? "?");
  console.log(`Application du jeton : ${appId}`);
} catch (error) {
  console.log(`Application du jeton : inconnue (${error.message})`);
}

try {
  const subscribed = await graph(`${wabaId}/subscribed_apps`);
  const apps = subscribed.data ?? [];
  console.log("");
  if (!apps.length) {
    console.log("Aucune application abonnée à ce compte WhatsApp Business.");
    console.log("C'est la raison pour laquelle Meta n'appelle pas le webhook.");
  } else {
    console.log("Applications abonnées :");
    for (const app of apps) {
      const target = app.whatsapp_business_api_data ?? {};
      const mark = String(target.id ?? "") === appId ? "  <-- celle de votre jeton" : "";
      console.log(`  - ${target.name ?? "sans nom"} (id ${target.id ?? "?"})${mark}`);
    }
  }

  const already = apps.some((app) => String(app.whatsapp_business_api_data?.id ?? "") === appId);

  if (already) {
    console.log("");
    console.log("[OK] L'application est bien abonnée. Si les messages n'arrivent toujours pas,");
    console.log("verifiez que le champ « messages » est coche dans Meta > WhatsApp > Configuration.");
  } else if (doSubscribe) {
    console.log("");
    console.log("Abonnement en cours…");
    const result = await graph(`${wabaId}/subscribed_apps`, { method: "POST" });
    console.log("[OK]", JSON.stringify(result));
    console.log("");
    console.log("Relancez sans --subscribe pour confirmer, puis renvoyez un message de test.");
  } else {
    console.log("");
    console.log("Pour abonner l'application, relancez avec :");
    console.log("  node scripts/whatsapp-subscription.mjs --subscribe");
  }
} catch (error) {
  console.error(`[ECHEC] ${error.message}`);
  process.exitCode = 1;
}
