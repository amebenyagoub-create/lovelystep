import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL manque. Utilisez la chaîne Session pooler fournie par Supabase.");
const sqlitePath = path.resolve(process.env.SQLITE_SOURCE_PATH || path.join(process.cwd(), "data", "lovelystep.db"));
if (!fs.existsSync(sqlitePath)) throw new Error(`Base SQLite introuvable : ${sqlitePath}`);

const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
const pool = new pg.Pool({ connectionString: databaseUrl, ssl: process.env.DATABASE_SSL === "disable" ? false : { rejectUnauthorized: false }, max: 1 });
const schema = fs.readFileSync(path.join(process.cwd(), "lib", "postgres-schema.sql"), "utf8");
const tables = ["admins","customers","products","admin_sessions","customer_sessions","login_attempts","delivery_rates","app_settings","import_jobs","orders","audit_logs","order_attempts","schema_migrations","visits"];
const booleanColumns = new Set(["login_attempts.succeeded","delivery_rates.active","orders.stock_reserved"]);

function sourceRows(table) {
  const exists = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
  return exists ? sqlite.prepare(`SELECT * FROM "${table}"`).all() : [];
}

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(schema);
  for (const table of tables) {
    const records = sourceRows(table);
    if (!records.length) { console.log(`${table}: 0`); continue; }
    const targetColumns = new Set((await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table])).rows.map((row) => row.column_name));
    let inserted = 0;
    for (const record of records) {
      const columns = Object.keys(record).filter((column) => targetColumns.has(column));
      const values = columns.map((column) => booleanColumns.has(`${table}.${column}`) ? Boolean(record[column]) : record[column]);
      const names = columns.map((column) => `"${column}"`).join(",");
      const params = columns.map((_, index) => `$${index + 1}`).join(",");
      const result = await client.query(`INSERT INTO "${table}" (${names}) VALUES (${params}) ON CONFLICT DO NOTHING`, values);
      inserted += result.rowCount ?? 0;
    }
    console.log(`${table}: ${inserted}/${records.length}`);
    if (targetColumns.has("id")) {
      await client.query(`SELECT setval(pg_get_serial_sequence('"${table}"','id'), GREATEST(COALESCE((SELECT MAX(id) FROM "${table}"),1),1), EXISTS(SELECT 1 FROM "${table}"))`);
    }
  }
  await client.query("INSERT INTO schema_migrations(name) VALUES ('sqlite-to-supabase-v1') ON CONFLICT DO NOTHING");
  await client.query("COMMIT");
  console.log("Migration SQLite vers Supabase terminée.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
  sqlite.close();
}
