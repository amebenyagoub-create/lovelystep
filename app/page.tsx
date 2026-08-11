import Storefront from "./storefront";
import StoreTracking from "./store-tracking";
import { algeriaWilayas } from "@/lib/algeria";
import { getStoreSettings, listDeliveryRates, listProducts } from "@/lib/db-postgres";
import { getFreeShippingThresholdCents } from "@/lib/free-shipping-server";
import { toPublicProduct } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [products,settings,deliveryRates]=await Promise.all([listProducts(),getStoreSettings(),listDeliveryRates()]);
  return <><Storefront products={products.map(toPublicProduct)} settings={settings} wilayas={algeriaWilayas} deliveryRates={deliveryRates} freeShippingThresholdCents={getFreeShippingThresholdCents()} /><StoreTracking /></>;
}
