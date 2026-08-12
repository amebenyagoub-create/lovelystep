import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { dashboardStats, getDeliveryIntegration, getStoreSettings, listDeliveryRates, listExpenses, listImportJobs, listOrders, listProducts } from "@/lib/db-postgres";
import { metaStatus } from "@/lib/meta/config";
import { whatsappStatus } from "@/lib/whatsapp/config";
import { getZrExpressStatus } from "@/lib/zrexpress";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  const [stats, products, orders, imports, storeSettings, deliveryRates, deliveryIntegration, expenses] = await Promise.all([
    dashboardStats(), listProducts(true), listOrders(), listImportJobs(), getStoreSettings(), listDeliveryRates(), getDeliveryIntegration(), listExpenses(),
  ]);
  return NextResponse.json({
    admin: { email: session.email },
    csrfToken: session.csrfToken,
    stats,
    meta: {
      pixelConfigured: metaStatus().pixelConfigured,
      insightsConfigured: Boolean(process.env.META_AD_ACCOUNT_ID && process.env.META_ACCESS_TOKEN),
    },
    whatsapp: whatsappStatus(),
    zrExpress: getZrExpressStatus(),
    products, orders, imports, storeSettings, deliveryRates, deliveryIntegration, expenses,
  });
}
