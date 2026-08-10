import { NextResponse } from "next/server";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { audit } from "@/lib/db-postgres";
import { metaConfig } from "@/lib/meta/config";
import { graphRequest, MetaTokenExpiredError } from "@/lib/meta/graph";

export const runtime = "nodejs";

type Check = { name: string; ok: boolean; detail: string };

/**
 * Read-only connectivity check. Sends no events and writes nothing to Meta.
 * Each asset is probed separately so a single missing permission is identifiable.
 */
export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });

  const config = metaConfig();
  const checks: Check[] = [];
  const probe = async (name: string, path: string, params: Record<string, string>) => {
    try {
      const value = await graphRequest<Record<string, unknown>>(path, params);
      checks.push({ name, ok: true, detail: String(value.name ?? value.id ?? "OK").slice(0, 120) });
    } catch (error) {
      const expired = error instanceof MetaTokenExpiredError;
      checks.push({ name, ok: false, detail: expired ? "Jeton expiré ou invalide." : (error instanceof Error ? error.message.slice(0, 200) : "Échec") });
    }
  };

  if (!config.accessToken) {
    return NextResponse.json({ ok: false, checks: [{ name: "token", ok: false, detail: "META_ACCESS_TOKEN est absent." }] });
  }

  const adAccount = (process.env.META_AD_ACCOUNT_ID ?? "").trim();
  const catalogId = (process.env.META_CATALOG_ID ?? "").trim();

  await probe("token", "me", { fields: "id" });
  if (adAccount) await probe("ad_account", adAccount.startsWith("act_") ? adAccount : `act_${adAccount}`, { fields: "name,currency,timezone_name,account_status" });
  if (config.datasetId) await probe("dataset", config.datasetId, { fields: "name" });
  if (catalogId) await probe("catalog", catalogId, { fields: "name,product_count" });

  await audit(session.adminId, "meta.test_connection", "meta", "connection", { ok: checks.every((check) => check.ok) });
  return NextResponse.json({ ok: checks.every((check) => check.ok), graphApiVersion: config.graphApiVersion, checks });
}
