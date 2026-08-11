import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { hashPassword, publicOrigin, secureCookieEnabled, verifyPassword } from "./auth";
import { createCustomer, deleteCustomerSession, getCustomerById, getCustomerCredentialsByPhone, getCustomerSessionId, insertCustomerSession } from "./db-postgres";
import type { Customer } from "./types";
const COOKIE_NAME="lovelystep_customer_session";const SESSION_DAYS=30;
export function normalizeAlgerianPhone(value:string):string|null{const digits=value.replace(/\D/g,"");const local=digits.startsWith("213")?digits.slice(3):digits.startsWith("0")?digits.slice(1):digits;return/^[567]\d{8}$/.test(local)?`+213${local}`:null;}
// Same reverse-proxy caveat as validCsrf: request.url carries the server's bind hostname, so the
// expected origin has to come from the forwarded headers. See publicOrigin in ./auth.
export function validSameOrigin(request:Request):boolean{const origin=request.headers.get("origin");return!origin||origin===publicOrigin(request);}
async function createCustomerSession(customerId:number):Promise<void>{const token=crypto.randomBytes(32).toString("base64url");const hash=crypto.createHash("sha256").update(token).digest("hex");const expires=new Date(Date.now()+SESSION_DAYS*24*60*60*1000);await insertCustomerSession(customerId,hash,expires);(await cookies()).set(COOKIE_NAME,token,{httpOnly:true,sameSite:"strict",secure:secureCookieEnabled(),path:"/",expires});}
export async function registerCustomer(input:Omit<Customer,"id"|"createdAt"|"updatedAt">&{password:string}):Promise<Customer>{const customer=await createCustomer({...input,passwordHash:hashPassword(input.password)});await createCustomerSession(customer.id);return customer;}
export async function loginCustomer(phone:string,password:string):Promise<Customer|null>{const credentials=await getCustomerCredentialsByPhone(phone);if(!credentials||!verifyPassword(password,credentials.passwordHash))return null;await createCustomerSession(credentials.customer.id);return credentials.customer;}
export async function getCustomerSession():Promise<Customer|null>{const token=(await cookies()).get(COOKIE_NAME)?.value;if(!token)return null;const id=await getCustomerSessionId(crypto.createHash("sha256").update(token).digest("hex"));return id?getCustomerById(id):null;}
export async function logoutCustomer():Promise<void>{const jar=await cookies();const token=jar.get(COOKIE_NAME)?.value;if(token)await deleteCustomerSession(crypto.createHash("sha256").update(token).digest("hex"));jar.set(COOKIE_NAME,"",{httpOnly:true,sameSite:"strict",secure:secureCookieEnabled(),path:"/",expires:new Date(0)});}
