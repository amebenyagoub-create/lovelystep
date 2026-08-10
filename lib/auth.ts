import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { deleteAdminSession, getAdminCredentialRecord, getAdminSessionRecord, hasAdminRecord, insertAdmin, insertAdminSession, insertLoginAttempt, isAdminLoginAllowed } from "./db-postgres";

const COOKIE_NAME = "lovelystep_admin_session";
const SESSION_HOURS = 12;
export type AdminSession = { adminId: number; email: string; csrfToken: string };
function secureCookieEnabled():boolean{if(process.env.COOKIE_SECURE==="true")return true;if(process.env.COOKIE_SECURE==="false")return false;return process.env.NODE_ENV==="production"&&Boolean(process.env.NEXT_PUBLIC_SITE_URL?.startsWith("https://"));}
export function hashPassword(password:string):string{const salt=crypto.randomBytes(16);const hash=crypto.scryptSync(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});return`scrypt$32768$${salt.toString("base64url")}$${hash.toString("base64url")}`;}
export function verifyPassword(password:string,encoded:string):boolean{const[algorithm,cost,saltValue,hashValue]=encoded.split("$");if(algorithm!=="scrypt"||!cost||!saltValue||!hashValue)return false;try{const expected=Buffer.from(hashValue,"base64url");const actual=crypto.scryptSync(password,Buffer.from(saltValue,"base64url"),expected.length,{N:Number(cost),r:8,p:1,maxmem:64*1024*1024});return expected.length===actual.length&&crypto.timingSafeEqual(expected,actual);}catch{return false;}}
export async function hasAdmin():Promise<boolean>{return hasAdminRecord();}
export async function createFirstAdmin(email:string,password:string):Promise<number>{if(await hasAdmin())throw new Error("Un administrateur existe déjà.");return insertAdmin(email.trim().toLowerCase(),hashPassword(password));}
export async function loginAllowed(email:string,ip:string):Promise<boolean>{return isAdminLoginAllowed(email.toLowerCase(),ip);}
export async function recordLoginAttempt(email:string,ip:string,succeeded:boolean):Promise<void>{await insertLoginAttempt(email.toLowerCase(),ip,succeeded);}
export async function verifyAdminCredentials(email:string,password:string):Promise<{id:number;email:string}|null>{const row=await getAdminCredentialRecord(email.trim());if(!row||!verifyPassword(password,row.passwordHash))return null;return{id:row.id,email:row.email};}
export async function createSession(adminId:number):Promise<void>{const token=crypto.randomBytes(32).toString("base64url");const hash=crypto.createHash("sha256").update(token).digest("hex");const csrfToken=crypto.randomBytes(24).toString("base64url");const expires=new Date(Date.now()+SESSION_HOURS*60*60*1000);await insertAdminSession(adminId,hash,csrfToken,expires);(await cookies()).set(COOKIE_NAME,token,{httpOnly:true,sameSite:"strict",secure:secureCookieEnabled(),path:"/",expires});}
export async function destroySession():Promise<void>{const jar=await cookies();const token=jar.get(COOKIE_NAME)?.value;if(token)await deleteAdminSession(crypto.createHash("sha256").update(token).digest("hex"));jar.set(COOKIE_NAME,"",{httpOnly:true,sameSite:"strict",secure:secureCookieEnabled(),path:"/",expires:new Date(0)});}
export async function getAdminSession():Promise<AdminSession|null>{const token=(await cookies()).get(COOKIE_NAME)?.value;if(!token)return null;return getAdminSessionRecord(crypto.createHash("sha256").update(token).digest("hex"));}
export async function requireAdminPage():Promise<AdminSession>{const session=await getAdminSession();if(!session)redirect("/admin/login");return session;}
export async function requireAdminApi():Promise<AdminSession|null>{return getAdminSession();}
export function validCsrf(request:Request,session:AdminSession):boolean{const token=request.headers.get("x-csrf-token");if(!token||token.length!==session.csrfToken.length||!crypto.timingSafeEqual(Buffer.from(token),Buffer.from(session.csrfToken)))return false;const origin=request.headers.get("origin");return!origin||origin===new URL(request.url).origin;}
