// Affecte un compte WhatsApp Business (WABA) à un utilisateur système, avec la tâche MANAGE.
//
// Écrit dans la configuration Meta : c'est la seule action non lecture-seule de ces scripts.
// Le jeton reste dans l'en-tête Authorization et n'est jamais affiché.
//
// Lancer :  node scripts/assign-whatsapp-asset.mjs
// Ou    :  node scripts/assign-whatsapp-asset.mjs <waba_id> <nom_utilisateur_systeme>
import { readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_WABA_ID = "2107937583135062";
const DEFAULT_SYSTEM_USER_NAME = "lovelystep";

function readEnvFile(file) {
  const values = {};
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    console.error(`Fichier introuvable : ${file}`);
    console.error("Lancez la commande depuis C:\\Users\\Amatek\\Desktop\\lovelystep");
    process.exitCode = 1;
    throw new Error("env");
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

const env = readEnvFile(path.join(process.cwd(), ".env.local"));
const version = env.WHATSAPP_GRAPH_API_VERSION || env.META_GRAPH_API_VERSION || "v26.0";
const businessId = env.META_BUSINESS_ID || "1123941784653077";
const wabaId = process.argv[2] || DEFAULT_WABA_ID;
const wantedName = (process.argv[3] || DEFAULT_SYSTEM_USER_NAME).toLowerCase();

/**
 * L'affectation d'un actif est une opération d'administration du portefeuille : elle exige
 * business_management, que porte le jeton publicitaire.
 */
const token = env.META_ACCESS_TOKEN || env.WHATSAPP_ACCESS_TOKEN || "";
if (!token) {
  console.error("Aucun jeton disponible dans .env.local.");
  process.exit(1);
}

const base = `https://graph.facebook.com/${version}`;

async function graph(pathname, { method = "GET", params = {}, body } = {}) {
  const url = new URL(`${base}/${pathname}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const init = { method, headers: { Authorization: `Bearer ${token}` } };
  if (body) {
    init.headers["content-type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(body);
  }
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new Error(`${error.message ?? `HTTP ${response.status}`}${error.code ? ` (code ${error.code})` : ""}`);
  }
  return payload;
}

console.log(`Portefeuille : ${businessId}`);
console.log(`WABA         : ${wabaId}`);
console.log(`Graph API    : ${version}`);
console.log("");

try {
  // L'identifiant global d'un utilisateur système est refusé par /assigned_users : il faut
  // celui que renvoie l'API pour l'application du jeton courant. On le résout par le nom.
  const listed = await graph(`${businessId}/system_users`, { params: { fields: "id,name,role", limit: "50" } });
  const users = listed.data ?? [];

  console.log("Utilisateurs système visibles avec ce jeton :");
  for (const user of users) console.log(`  - ${user.name} — id ${user.id}${user.role ? ` (${user.role})` : ""}`);
  console.log("");

  const match = users.find((user) => String(user.name ?? "").toLowerCase() === wantedName)
    ?? users.find((user) => String(user.name ?? "").toLowerCase().includes(wantedName));

  if (!match) {
    console.error(`Aucun utilisateur système nommé « ${wantedName} » dans cette liste.`);
    console.error("Relancez avec le nom exact : node scripts/assign-whatsapp-asset.mjs <waba_id> <nom>");
    process.exitCode = 1;
  } else {
    console.log(`Affectation de « ${match.name} » (id ${match.id}) au WABA ${wabaId}…`);
    const result = await graph(`${wabaId}/assigned_users`, {
      method: "POST",
      body: { user: match.id, tasks: JSON.stringify(["MANAGE"]) },
    });
    console.log("[OK]", JSON.stringify(result));
    console.log("");
    console.log("Aucune régénération de jeton nécessaire : les droits sont évalués à chaque appel.");
    console.log("Vérifiez avec : node scripts/verify-whatsapp.mjs");
  }
} catch (error) {
  console.error(`[ECHEC] ${error instanceof Error ? error.message : error}`);
  console.error("");
  console.error("Si l'erreur mentionne les permissions, le jeton n'administre pas ce portefeuille :");
  console.error("il faut alors passer par l'interface Meta.");
  process.exitCode = 1;
}
