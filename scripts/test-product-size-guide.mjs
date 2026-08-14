import assert from "node:assert/strict";
import { recommendedHeightLabel } from "../lib/product-size.ts";

assert.equal(recommendedHeightLabel({ label: "90" }, "fr"), "90 cm");
assert.equal(recommendedHeightLabel({ label: "2-3 ans" }, "fr"), "90–98 cm");
assert.equal(recommendedHeightLabel({ label: "2-3 ans", height: "92-98 cm" }, "ar"), "92-98 سم");
assert.equal(recommendedHeightLabel({ label: "taille unique" }, "en"), "—");

console.log("Product size guide mapping: OK");
