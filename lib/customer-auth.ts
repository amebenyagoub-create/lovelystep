import "server-only";

import crypto from "node:crypto";
import { cookies } from "next/headers";
import { hashPassword, verifyPassword } from "./auth";
import { createCustomer, db, getCustomerById, getCustomerCredentialsByPhone } from "./db";
import type { Customer } from "./types";

const COOKIE_NAME = "lovelystep_customer_session";
const SESSION_DAYS = 30;

function secureCookieEnabled(): boolean {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;
  return process.env.NODE_ENV === "production" && Boolean(process.env.NEXT_PUBLIC_SITE_URL?.startsWith("https://"));
}

export function normalizeAlgerianPhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  const local = digits.startsWith("213") ? digits.slice(3) : digits.startsWith("0") ? digits.slice(1) : digits;
  return /^[567]\d{8}$/.test(local) ? `+213${local}` : null;
}

export function validSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function createCustomerSession(customerId: number): Promise<void> {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  db.prepare("DELETE FROM customer_sessions WHERE datetime(expires_at)<CURRENT_TIMESTAMP").run();
  db.prepare("INSERT INTO customer_sessions (customer_id,token_hash,expires_at) VALUES (?,?,?)").run(customerId, tokenHash, expires.toISOString());
  (await cookies()).set(COOKIE_NAME, token, { httpOnly: true, sameSite: "strict", secure: secureCookieEnabled(), path: "/", expires });
}

export async function registerCustomer(input: Omit<Customer, "id" | "createdAt" | "updatedAt"> & { password: string }): Promise<Customer> {
  const customer = createCustomer({ ...input, passwordHash: hashPassword(input.password) });
  await createCustomerSession(customer.id);
  return customer;
}

export async function loginCustomer(phone: string, password: string): Promise<Customer | null> {
  const credentials = getCustomerCredentialsByPhone(phone);
  if (!credentials || !verifyPassword(password, credentials.passwordHash)) return null;
  await createCustomerSession(credentials.customer.id);
  return credentials.customer;
}

export async function getCustomerSession(): Promise<Customer | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const row = db.prepare("SELECT customer_id FROM customer_sessions WHERE token_hash=? AND datetime(expires_at)>CURRENT_TIMESTAMP")
    .get(crypto.createHash("sha256").update(token).digest("hex")) as { customer_id: number } | undefined;
  return row ? getCustomerById(row.customer_id) : null;
}

export async function logoutCustomer(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (token) db.prepare("DELETE FROM customer_sessions WHERE token_hash=?").run(crypto.createHash("sha256").update(token).digest("hex"));
  jar.set(COOKIE_NAME, "", { httpOnly: true, sameSite: "strict", secure: secureCookieEnabled(), path: "/", expires: new Date(0) });
}
