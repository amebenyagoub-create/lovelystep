import "server-only";

const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET || "product-media";
let bucketReady: Promise<void> | null = null;

export function objectStorageEnabled(): boolean { return Boolean(baseUrl && secretKey); }
function headers(extra:Record<string,string>={}):Record<string,string>{
  if(!secretKey)throw new Error("SUPABASE_SECRET_KEY manque pour le stockage d’images.");
  const value:Record<string,string>={apikey:secretKey,...extra};
  if(secretKey.startsWith("eyJ"))value.authorization=`Bearer ${secretKey}`;
  return value;
}
function encoded(value:string):string{return value.split("/").map(encodeURIComponent).join("/");}
async function ensureBucket():Promise<void>{
  if(!baseUrl||!secretKey)throw new Error("Le stockage Supabase n’est pas configuré.");
  bucketReady??=(async()=>{const check=await fetch(`${baseUrl}/storage/v1/bucket`,{headers:headers(),cache:"no-store"});if(!check.ok)throw new Error(`Vérification Storage impossible (${check.status}).`);const existing=await check.json() as Array<{id?:string;name?:string}>;if(existing.some((item)=>item.id===bucket||item.name===bucket))return;const created=await fetch(`${baseUrl}/storage/v1/bucket`,{method:"POST",headers:headers({"content-type":"application/json"}),body:JSON.stringify({id:bucket,name:bucket,public:false,file_size_limit:20*1024*1024,allowed_mime_types:["image/jpeg","image/png","image/webp"]})});if(!created.ok&&created.status!==409)throw new Error(`Création Storage impossible (${created.status}).`);})();
  return bucketReady;
}
export async function storeObject(key:string,data:Buffer,contentType:string):Promise<void>{await ensureBucket();const response=await fetch(`${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encoded(key)}`,{method:"POST",headers:headers({"content-type":contentType,"x-upsert":"true"}),body:new Uint8Array(data)});if(!response.ok)throw new Error(`Enregistrement Storage impossible (${response.status}).`);}
export async function readObject(key:string):Promise<Buffer|null>{if(!objectStorageEnabled())return null;await ensureBucket();const response=await fetch(`${baseUrl}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${encoded(key)}`,{headers:headers(),cache:"no-store"});if(response.status===404)return null;if(!response.ok)throw new Error(`Lecture Storage impossible (${response.status}).`);return Buffer.from(await response.arrayBuffer());}
export async function deleteObjects(keys:string[]):Promise<void>{if(!objectStorageEnabled()||!keys.length)return;await ensureBucket();const response=await fetch(`${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}`,{method:"DELETE",headers:headers({"content-type":"application/json"}),body:JSON.stringify({prefixes:keys})});if(!response.ok&&response.status!==404)throw new Error(`Suppression Storage impossible (${response.status}).`);}
