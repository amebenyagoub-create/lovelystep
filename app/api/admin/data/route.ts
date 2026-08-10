import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { dashboardStats, getDeliveryIntegration, getStoreSettings, listDeliveryRates, listImportJobs, listOrders, listProducts } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  return NextResponse.json({
    admin: { email: session.email },
    csrfToken: session.csrfToken,
    stats: dashboardStats(),
    meta: {
      pixelConfigured: /^\d{5,30}$/.test(process.env.NEXT_PUBLIC_META_PIXEL_ID ?? ""),
      insightsConfigured: Boolean(process.env.META_AD_ACCOUNT_ID && process.env.META_ACCESS_TOKEN),
    },
    products: listProducts(true),
    orders: listOrders(),
    imports: listImportJobs(),
    storeSettings: getStoreSettings(),
    deliveryRates: listDeliveryRates(),
    deliveryIntegration: getDeliveryIntegration(),
  });
}
