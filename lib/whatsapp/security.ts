import crypto from "node:crypto";

export function verifyWhatsAppSignature(rawBody: string, signature: string | null, appSecret: string): boolean {
  if (!signature?.startsWith("sha256=") || !appSecret) return false;
  const received = signature.slice("sha256=".length);
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  if (!/^[a-f0-9]{64}$/i.test(received) || received.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
}
