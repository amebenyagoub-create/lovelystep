import { isTrackingDisabledByAdmin } from "@/lib/db-postgres";
import { metaConfig } from "@/lib/meta/config";
import AttributionTracker from "./attribution-tracker";
import ConsentBanner from "./consent-banner";
import MetaPixel from "./meta-pixel";

/**
 * Tracking for the public storefront.
 *
 * Deliberately NOT in the root layout. The root layout wraps every route including the
 * prerendered ones, so a database read there executes during `next build` — which is how a
 * build ended up running schema migrations. Mounting this in the two force-dynamic store
 * pages keeps the read on the request path, and has the side benefit that the admin area
 * loads no tracking at all.
 */
export default async function StoreTracking() {
  // Admin kill switch: removes the browser Pixel as well as server-side events.
  const disabled = await isTrackingDisabledByAdmin().catch(() => false);
  const pixelId = disabled ? "" : metaConfig().pixelId;
  return <><MetaPixel pixelId={pixelId} /><AttributionTracker /><ConsentBanner /></>;
}
