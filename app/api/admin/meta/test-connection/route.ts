import { NextResponse } from "next/server";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { audit } from "@/lib/db-postgres";
import { metaConfig } from "@/lib/meta/config";
import { graphRequest, graphRequestWithAccessToken, MetaTokenExpiredError } from "@/lib/meta/graph";

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
  const pageId = (process.env.META_PAGE_ID ?? "").trim();
  const pageToken = (process.env.META_PAGE_ACCESS_TOKEN ?? "").trim();
  if (pageId && pageToken) {
    try {
      const page = await graphRequestWithAccessToken<{ id?: string; name?: string }>(pageId, { fields: "id,name" }, pageToken);
      checks.push({
        name: "facebook_page",
        ok: String(page.id ?? "") === pageId,
        detail: `${String(page.name ?? page.id ?? "Page accessible").slice(0, 100)} — pages_manage_posts sera vérifiée au premier envoi.`,
      });
    } catch (error) {
      checks.push({ name: "facebook_page", ok: false, detail: error instanceof MetaTokenExpiredError ? "Jeton Page expiré ou invalide." : (error instanceof Error ? error.message.slice(0, 200) : "Échec") });
    }
    try {
      const page = await graphRequestWithAccessToken<{ instagram_business_account?: { id?: string; username?: string } }>(pageId, { fields: "instagram_business_account{id,username}" }, pageToken);
      const instagram = page.instagram_business_account;
      const configuredInstagramId = (process.env.META_INSTAGRAM_ACCOUNT_ID ?? "").trim();
      const discoveredInstagramId = String(instagram?.id ?? "");
      checks.push({
        name: "instagram_account",
        ok: Boolean(discoveredInstagramId) && (!configuredInstagramId || configuredInstagramId === discoveredInstagramId),
        detail: !discoveredInstagramId
          ? "Aucun compte Instagram professionnel relié à cette Page."
          : configuredInstagramId && configuredInstagramId !== discoveredInstagramId
            ? `META_INSTAGRAM_ACCOUNT_ID ne correspond pas au compte relié (${discoveredInstagramId}).`
            : `@${String(instagram?.username ?? discoveredInstagramId).slice(0, 80)} · ID ${discoveredInstagramId} — instagram_content_publish sera vérifiée au premier envoi.`,
      });
    } catch (error) {
      checks.push({ name: "instagram_account", ok: false, detail: error instanceof MetaTokenExpiredError ? "Jeton Page expiré ou invalide." : (error instanceof Error ? error.message.slice(0, 200) : "Échec") });
    }
  }

  await audit(session.adminId, "meta.test_connection", "meta", "connection", { ok: checks.every((check) => check.ok) });
  return NextResponse.json({ ok: checks.every((check) => check.ok), graphApiVersion: config.graphApiVersion, checks });
}
