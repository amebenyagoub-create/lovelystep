import pg from "pg";

if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL manque.");
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:1});
const counts=await pool.query("SELECT (SELECT count(*) FROM products)::int products,(SELECT count(*) FROM orders)::int orders,(SELECT count(*) FROM admins)::int admins");
await pool.end();
const base=process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,"");
const secret=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!base||!secret)throw new Error("Configuration Storage manquante.");
const response=await fetch(`${base}/storage/v1/bucket`,{headers:{apikey:secret}});
if(!response.ok)throw new Error(`Storage inaccessible (${response.status}).`);
const bucket=process.env.SUPABASE_STORAGE_BUCKET||"product-media";
const buckets=await response.json();
console.log(JSON.stringify({ok:true,...counts.rows[0],storageBucket:buckets.some((item)=>item.id===bucket||item.name===bucket)}));
