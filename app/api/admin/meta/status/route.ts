import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { isTrackingDisabledByAdmin, listRecentMetaEvents, listSyncState } from "@/lib/db-postgres";
import { metaStatus } from "@/lib/meta/config";
import { catalogQualityReport } from "@/lib/meta/catalog";

export const dynamic = "force-dynamic";

/** Diagnostics for the admin Meta page: configuration, freshness, coverage, recent errors. */
export async function GET() {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });

  const status = metaStatus();
  const [syncState, events, catalog, adminDisabled] = await Promise.all([
    listSyncState(),
    listRecentMetaEvents(50),
    catalogQualityReport().catch((error) => ({ error: error instanceof Error ? error.message.slice(0, 200) : "Rapport indisponible." })),
    isTrackingDisabledByAdmin().catch(() => false),
  ]);

  // Pixel/CAPI coverage: how many tracked events actually reached both channels.
  const purchases = events.filter((event) => event.eventName === "Purchase");
  const coverage = {
    total: purchases.length,
    pixelOnly: purchases.filter((event) => event.pixelSentAt && !event.capiSentAt).length,
    capiOnly: purchases.filter((event) => !event.pixelSentAt && event.capiSentAt).length,
    deduplicated: purchases.filter((event) => event.pixelSentAt && event.capiSentAt).length,
    failed: purchases.filter((event) => event.capiStatus != null && (event.capiStatus < 200 || event.capiStatus > 299)).length,
  };

  return NextResponse.json({
    config: {
      ...status,
      // Effective state: the env var permits, the admin switch can still veto.
      trackingEnabled: status.trackingEnabled && !adminDisabled,
      adminDisabled,
      adAccountConfigured: Boolean((process.env.META_AD_ACCOUNT_ID ?? "").trim()),
      catalogConfigured: Boolean((process.env.META_CATALOG_ID ?? "").trim()),
      businessConfigured: Boolean((process.env.META_BUSINESS_ID ?? "").trim()),
    },
    syncState,
    coverage,
    catalog,
    // Already redacted at write time; no personal data can appear here.
    recentErrors: events.filter((event) => event.capiError).slice(0, 20).map((event) => ({ eventName: event.eventName, status: event.capiStatus, error: event.capiError, at: event.createdAt })),
  });
}
