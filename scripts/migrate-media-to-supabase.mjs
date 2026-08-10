import fs from "node:fs/promises";
import path from "node:path";

const baseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,"");
const secret=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket=process.env.SUPABASE_STORAGE_BUCKET||"product-media";
if(!baseUrl||!secret)throw new Error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SECRET_KEY sont obligatoires.");
const headers=(extra={})=>({apikey:secret,...(secret.startsWith("eyJ")?{authorization:`Bearer ${secret}`}:{ }),...extra});
const encode=(value)=>value.split("/").map(encodeURIComponent).join("/");
const check=await fetch(`${baseUrl}/storage/v1/bucket`,{headers:headers()});
if(!check.ok)throw new Error(`Accès au bucket impossible (${check.status}).`);
const buckets=await check.json();
if(!buckets.some((item)=>item.id===bucket||item.name===bucket)){const create=await fetch(`${baseUrl}/storage/v1/bucket`,{method:"POST",headers:headers({"content-type":"application/json"}),body:JSON.stringify({id:bucket,name:bucket,public:false,file_size_limit:20*1024*1024,allowed_mime_types:["image/jpeg","image/png","image/webp"]})});if(!create.ok&&create.status!==409)throw new Error(`Création du bucket impossible (${create.status}).`);}
const roots=[
  [path.join(process.cwd(),"public","uploads","products"),"products"],
  [path.join(process.cwd(),"public","uploads","originals"),"originals"],
  [path.join(process.cwd(),"public","uploads","sources"),"sources"],
  [path.join(process.cwd(),"public","uploads","imports"),"imports"],
  [path.join(process.cwd(),"public","uploads","storefront"),"storefront"],
  [path.join(process.cwd(),"public","generated","size-guides"),"size-guides"],
];
const mime={".webp":"image/webp",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg"};
async function walk(directory){try{const entries=await fs.readdir(directory,{withFileTypes:true});const output=[];for(const entry of entries){const full=path.join(directory,entry.name);if(entry.isDirectory())output.push(...await walk(full));else output.push(full);}return output;}catch{return[];}}
let uploaded=0;
for(const[root,prefix]of roots){for(const file of await walk(root)){const type=mime[path.extname(file).toLowerCase()];if(!type)continue;const relative=path.relative(root,file).split(path.sep).join("/");const key=`${prefix}/${relative}`;const response=await fetch(`${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encode(key)}`,{method:"POST",headers:headers({"content-type":type,"x-upsert":"true"}),body:await fs.readFile(file)});if(!response.ok)throw new Error(`${key}: upload impossible (${response.status}).`);uploaded++;console.log(key);}}
console.log(`${uploaded} fichier(s) migré(s) vers Supabase Storage.`);
