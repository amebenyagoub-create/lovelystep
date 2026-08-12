import crypto from "node:crypto";
import { strict as assert } from "node:assert";
import { buildWhatsAppConfirmationUrl } from "../lib/whatsapp/link.ts";
import { classifyOrderIntent, extractOrderNumber, normalizeWhatsAppPhone, parseWhatsAppOrderAction } from "../lib/whatsapp/intent.ts";
import { verifyWhatsAppSignature } from "../lib/whatsapp/security.ts";

const orderNumber = "LS-260811-A1B2C3D4";

assert.equal(extractOrderNumber(`bonjour ${orderNumber.toLowerCase()}`), orderNumber);
assert.equal(normalizeWhatsAppPhone("0555 12 34 56"), "+213555123456");
assert.equal(normalizeWhatsAppPhone("213555123456"), "+213555123456");
assert.equal(classifyOrderIntent(`oui je confirme ${orderNumber}`), "confirm");
assert.equal(classifyOrderIntent(`إلغاء ${orderNumber}`), "cancel");
assert.deepEqual(parseWhatsAppOrderAction(`reject_order:${orderNumber} Ne pas confirmer`), { action: "reject", orderNumber });
assert.deepEqual(parseWhatsAppOrderAction(`reason_price:${orderNumber}`), { action: "reason_price", orderNumber });

const link = buildWhatsAppConfirmationUrl("+213 555 123 456", orderNumber, "fr");
assert.ok(link?.startsWith("https://wa.me/213555123456?"));
assert.equal(new URL(link).searchParams.get("text"), `DÉMARRER CONFIRMATION ${orderNumber}`);

const body = JSON.stringify({ object: "whatsapp_business_account" });
const secret = "test-app-secret";
const signature = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
assert.equal(verifyWhatsAppSignature(body, signature, secret), true);
assert.equal(verifyWhatsAppSignature(`${body}x`, signature, secret), false);

console.log("WhatsApp agent unit checks passed.");
