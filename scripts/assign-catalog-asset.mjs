// Affecte le catalogue produit à l'utilisateur système, avec la tâche MANAGE.
//
// Sans cette affectation, le jeton lit le catalogue mais ne peut rien y écrire : la
// synchronisation renvoie « (#200) Permissions error » sur chaque article.
//
// Lancer :  node scripts/assign-catalog-asset.mjs
// Ou    :  node scripts/assign-catalog-asset.mjs <catalog_id> <nom_utilisateur_systeme>
import { readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_SYSTEM_USER_NAME = "lovelystep";

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
const version = env.META_GRAPH_API_VERSION || "v26.0";
const businessId = env.META_BUSINESS_ID || "1123941784653077";
const catalogId = process.argv[2] || env.META_CATALOG_ID || "";
const wantedName = (process.argv[3] || DEFAULT_SYSTEM_USER_NAME).toLowerCase();
const token = env.META_ACCESS_TOKEN || "";

if (!token) { console.error("META_ACCESS_TOKEN est vide dans .env.local."); process.exit(1); }
if (!catalogId) { console.error("META_CATALOG_ID est vide dans .env.local."); process.exit(1); }

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
console.log(`Catalogue    : ${catalogId}`);
console.log("");

try {
  // L'identifiant global d'un utilisateur système est refusé : il faut celui que renvoie
  // l'API pour l'application du jeton courant. On le résout par le nom.
  const listed = await graph(`${businessId}/system_users`, { params: { fields: "id,name", limit: "50" } });
  const users = listed.data ?? [];
  const match = users.find((user) => String(user.name ?? "").toLowerCase() === wantedName)
    ?? users.find((user) => String(user.name ?? "").toLowerCase().includes(wantedName));

  if (!match) {
    console.error(`Aucun utilisateur système nommé « ${wantedName} ».`);
    console.error(`Disponibles : ${users.map((user) => user.name).join(", ") || "aucun"}`);
    process.exitCode = 1;
  } else {
    console.log(`Affectation de « ${match.name} » (id ${match.id})…`);
    const result = await graph(`${catalogId}/assigned_users`, {
      method: "POST",
      body: { user: match.id, tasks: JSON.stringify(["MANAGE"]) },
    });
    console.log("[OK]", JSON.stringify(result));

    const details = await graph(catalogId, { params: { fields: "name,product_count" } });
    console.log(`Catalogue « ${details.name} » — ${details.product_count ?? 0} produit(s)`);
    console.log("");
    console.log("Relancez « Synchroniser le catalogue » dans Administration → Meta.");
  }
} catch (error) {
  console.error(`[ECHEC] ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
