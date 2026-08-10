import Storefront from "./storefront";
import { algeriaWilayas } from "@/lib/algeria";
import { getStoreSettings, listDeliveryRates, listProducts } from "@/lib/db";
import { toPublicProduct } from "@/lib/types";

export const dynamic = "force-dynamic";

export default function Page() {
  return <Storefront products={listProducts().map(toPublicProduct)} settings={getStoreSettings()} wilayas={algeriaWilayas} deliveryRates={listDeliveryRates()} />;
}
