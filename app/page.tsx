import type { Metadata } from "next";
import Storefront from "./storefront";
import StoreTracking from "./store-tracking";
import { algeriaWilayas } from "@/lib/algeria";
import { cachedDeliveryRates, cachedProducts, cachedStoreSettings } from "@/lib/public-cache";
import { toPublicProduct } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default async function Page() {
  const [products,settings,deliveryRates]=await Promise.all([cachedProducts(),cachedStoreSettings(),cachedDeliveryRates()]);
  return <><Storefront products={products.map(toPublicProduct)} settings={settings} wilayas={algeriaWilayas} deliveryRates={deliveryRates} /><StoreTracking /></>;
}
