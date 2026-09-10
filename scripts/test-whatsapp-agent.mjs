import assert from "node:assert/strict";
import { buildAgentStoreContext } from "../lib/agent-store-context.ts";

const context = buildAgentStoreContext([{
  id: 7,
  slug: "ensemble-happy",
  name: "Ensemble Happy",
  shortDescription: "Cardigan, haut et pantalon",
  description: "",
  priceCents: 380_000,
  costCents: 190_000,
  compareAtCents: 420_000,
  status: "published",
  category: "Ensembles",
  color: "Bleu",
  colors: ["Bleu"],
  variants: [{ color: "Bleu", size: "3 ans", age: "3 ans", stock: 2 }],
  sizes: [],
}], [{
  wilayaCode: "31",
  wilayaNameFr: "Oran",
  wilayaNameAr: "وهران",
  homeCents: 70_000,
  officeCents: 50_000,
  carrierHomeCents: 0,
  carrierOfficeCents: 0,
  returnCostCents: 0,
  active: true,
}], "https://lovelystep.com");

assert.equal(context.products[0].priceDzd, 3_800);
assert.equal(context.products[0].variants[0].stock, 2);
assert.equal(context.products[0].productUrl, "https://lovelystep.com/produits/ensemble-happy");
assert.equal(context.delivery[0].homeDzd, 700);
assert.equal("costCents" in context.products[0], false, "le cout prive ne doit jamais quitter la boutique");
assert.deepEqual(context.promotions, [], "aucune promotion ne doit etre inventee");

console.log("✓ Contexte catalogue/stock de l’agent vérifié");
