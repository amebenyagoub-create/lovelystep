import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { dashboardStats, getDeliveryIntegration, getStoreSettings, lastScheduledSheetSyncAt, listDeliveryRates, listExpenses, listOrders, listProducts, sheetOutboxDepth } from "@/lib/db-postgres";
import { metaStatus } from "@/lib/meta/config";
import { getZrExpressStatus } from "@/lib/zrexpress";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  // Google Sheets is synchronized by /api/cron/sheet-sync. Keeping that remote
  // request out of this route makes the dashboard independent from Google latency.
  const [stats, products, orders, storeSettings, deliveryRates, deliveryIntegration, expenses, depth, lastScheduledSync] = await Promise.all([
    dashboardStats(),
    listProducts(true),
    listOrders(),
    getStoreSettings(),
    listDeliveryRates(),
    getDeliveryIntegration(),
    listExpenses(),
    sheetOutboxDepth().catch(() => ({ pending: 0, failing: 0, oldestPendingAt: null })),
    lastScheduledSheetSyncAt().catch(() => null),
  ]);
  return NextResponse.json({
    admin: { email: session.email },
    csrfToken: session.csrfToken,
    stats,
    meta: {
      pixelConfigured: metaStatus().pixelConfigured,
      insightsConfigured: Boolean(process.env.META_AD_ACCOUNT_ID && process.env.META_ACCESS_TOKEN),
    },
    zrExpress: getZrExpressStatus(),
    sheetSync: {
      unknownStates: [],
      error: null,
      depth,
      lastScheduledSync,
    },
    products, orders, storeSettings, deliveryRates, deliveryIntegration, expenses,
  });
}
