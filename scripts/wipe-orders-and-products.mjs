/**
 * Efface TOUTES les commandes et TOUS les produits de la base.
 *
 *   node --env-file=.env.local --conditions react-server --experimental-strip-types --import ./scripts/ts-resolve-hook.mjs scripts/wipe-orders-and-products.mjs        (compte, ne supprime rien)
 *   node --env-file=.env.local --conditions react-server --experimental-strip-types --import ./scripts/ts-resolve-hook.mjs scripts/wipe-orders-and-products.mjs --yes  (supprime)
 *
 * Il n'y a AUCUNE corbeille et AUCUN retour en arriere. Les cles etrangeres
 * sont toutes en CASCADE ou SET NULL, donc l'historique de statuts, les
 * remboursements, les couts de livraison et l'attribution partent avec les
 * commandes ; les couts produit et les entrees de catalogue Meta partent avec
 * les produits.
 *
 * Le chiffre d'affaires et la marge du tableau de bord sont calcules a partir
 * des commandes : ils repasseront a zero.
 */
import pg from "pg";
import { clearOrderRowsFromGoogleSheet } from "../lib/google-sheets.ts";

const APPLY = process.argv.includes("--yes");
const url = (process.env.DATABASE_URL ?? "").trim();
if (!url) { console.error("DATABASE_URL absent. Lancez avec --env-file=.env.local"); process.exit(1); }

const client = new pg.Client({ connectionString: url });
await client.connect();

async function count(table) {
  const r = await client.query(`SELECT count(*)::int n FROM ${table}`);
  return r.rows[0].n;
}

const before = {
  commandes: await count("orders"),
  produits: await count("products"),
  historique: await count("order_status_history"),
  catalogue_meta: await count("meta_catalog_items"),
};
const sheetBefore = await clearOrderRowsFromGoogleSheet(false);
console.log("\nAvant :");
for (const [k, v] of Object.entries(before)) console.log(`  ${k.padEnd(16)} ${v}`);
console.log(`  lignes_sheet     ${sheetBefore.rows} (${sheetBefore.tabName})`);

if (!APPLY) {
  console.log("\nRien n'a ete supprime. Relancez avec --yes pour effacer.\n");
  await client.end();
  process.exit(0);
}

try {
  await client.query("BEGIN");
  // Les commandes d'abord : un produit rattache a une commande est protege.
  await client.query("DELETE FROM orders");
  await client.query("DELETE FROM products");
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  console.error("\nEchec, rien n'a ete supprime :", error.message, "\n");
  await client.end();
  process.exit(1);
}

console.log("\nApres :");
for (const table of ["orders", "products", "order_status_history", "meta_catalog_items"]) {
  console.log(`  ${table.padEnd(22)} ${await count(table)}`);
}
await client.end();
const sheetCleared = await clearOrderRowsFromGoogleSheet(true);
const sheetAfter = await clearOrderRowsFromGoogleSheet(false);
console.log(`  ${"google_sheet".padEnd(22)} ${sheetAfter.rows} (${sheetCleared.rows} lignes effacees, en-tete conserve)`);
console.log("\nBase nettoyee.");
console.log("Note : le catalogue Facebook/Instagram garde les anciens articles.");
console.log("Resynchronisez-le depuis l'onglet Meta du tableau de bord.\n");
