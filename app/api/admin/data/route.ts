import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { dashboardStats, getDeliveryIntegration, getStoreSettings, listDeliveryRates, listExpenses, listOrders, listProducts, sheetOutboxDepth } from "@/lib/db-postgres";
import { syncOrderStatesFromGoogleSheet } from "@/lib/google-sheets";
import { log, errorMessage } from "@/lib/log";
import { metaStatus } from "@/lib/meta/config";
import { getZrExpressStatus } from "@/lib/zrexpress";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  let orders: Awaited<ReturnType<typeof listOrders>>;
  // The scheduled job at /api/cron/sheet-sync is what keeps this current; the
  // call here only makes the page you are looking at as fresh as possible.
  let sheetSync: { unknownStates: string[]; error: string | null } = { unknownStates: [], error: null };
  try {
    const sync = await syncOrderStatesFromGoogleSheet();
    orders = sync.orders;
    sheetSync = { unknownStates: sync.unknownStates, error: null };
    if (sync.unknownStates.length) log.actionRequired("sheet_states_unknown", { states: sync.unknownStates });
  } catch (error) {
    const message = errorMessage(error, "Synchronisation Google Sheets impossible.");
    log.actionRequired("sheet_state_pull_failed", { message });
    sheetSync = { unknownStates: [], error: message };
    orders = await listOrders();
  }
  const [stats, products, storeSettings, deliveryRates, deliveryIntegration, expenses] = await Promise.all([
    dashboardStats(), listProducts(true), getStoreSettings(), listDeliveryRates(), getDeliveryIntegration(), listExpenses(),
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
    sheetSync: { ...sheetSync, depth: await sheetOutboxDepth().catch(() => ({ pending: 0, failing: 0, oldestPendingAt: null })) },
    products, orders, storeSettings, deliveryRates, deliveryIntegration, expenses,
  });
}
