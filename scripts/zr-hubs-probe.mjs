/**
 * Diagnostic : que renvoie reellement ZR Express sur /hubs/search ?
 *
 * Usage : node scripts/zr-hubs-probe.mjs            (liste complete, groupee par commune)
 *         node scripts/zr-hubs-probe.mjs Alger Oran (test du mot-cle, wilaya par wilaya)
 *
 * A lancer depuis la machine qui a acces au reseau ZR. Aucune ecriture, lecture seule.
 */
import { readFileSync } from "node:fs";

const envFile = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = Object.fromEntries(
  envFile.split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => { const at = line.indexOf("="); return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const headers = {
  accept: "application/json",
  "content-type": "application/json",
  "X-Api-Key": env.ZREXPRESS_API_KEY,
  "X-Tenant": env.ZREXPRESS_TENANT_ID,
};

async function search(keyword, pageNumber = 1) {
  const response = await fetch("https://api.zrexpress.app/api/v1/hubs/search", {
    method: "POST", headers,
    body: JSON.stringify({ keyword, pageSize: 100, pageNumber, includeServices: false }),
  });
  const payload = await response.json().catch(() => ({}));
  const items = Array.isArray(payload.items) ? payload.items : Array.isArray(payload.data?.items) ? payload.data.items : [];
  return { status: response.status, items, payload };
}

const keywords = process.argv.slice(2);

if (!keywords.length) {
  const all = [];
  for (let page = 1; page <= 20; page += 1) {
    const { status, items, payload } = await search("", page);
    if (status !== 200) { console.log(`page ${page} : HTTP ${status}`, JSON.stringify(payload).slice(0, 300)); break; }
    all.push(...items);
    if (items.length < 100) break;
  }
  const pickup = all.filter((item) => item.isPickupPoint === true);
  console.log(`Total renvoye : ${all.length} — dont bureaux de retrait : ${pickup.length}\n`);
  const byDistrict = new Map();
  for (const item of pickup) {
    const district = item.address?.district ?? "(sans commune)";
    byDistrict.set(district, [...(byDistrict.get(district) ?? []), item.name]);
  }
  for (const [district, names] of [...byDistrict].sort((a, b) => a[0].localeCompare(b[0], "fr"))) {
    console.log(`${district} (${names.length}) : ${names.join(" | ")}`);
  }
} else {
  for (const keyword of keywords) {
    const { status, items, payload } = await search(keyword);
    const pickup = items.filter((item) => item.isPickupPoint === true);
    console.log(`\n=== "${keyword}" — HTTP ${status} — ${items.length} resultat(s), ${pickup.length} bureau(x) de retrait`);
    if (status !== 200) console.log("   ", JSON.stringify(payload).slice(0, 300));
    for (const item of pickup.slice(0, 20)) console.log(`   ${item.address?.district ?? "?"} · ${item.name}`);
  }
}
