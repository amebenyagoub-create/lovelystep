import { metaConfig } from "@/lib/meta/config";
import { cachedTrackingDisabled } from "@/lib/public-cache";
import AttributionTracker from "./attribution-tracker";
import MetaPixel from "./meta-pixel";

/**
 * Tracking for the public storefront.
 *
 * Deliberately NOT in the root layout. The root layout wraps every route including the
 * prerendered ones, so a database read there executes during `next build` — which is how a
 * build ended up running schema migrations. Mounting this in the two force-dynamic store
 * pages keeps the read on the request path, and has the side benefit that the admin area
 * loads no tracking at all.
 *
 * There is no consent banner: measurement runs by default and visitors opt out from the
 * privacy page. The admin kill switch below still disables everything at once.
 */
export default async function StoreTracking() {
  // Admin kill switch: removes the browser Pixel as well as server-side events.
  const disabled = await cachedTrackingDisabled();
  const pixelId = disabled ? "" : metaConfig().pixelId;
  return <><MetaPixel pixelId={pixelId} /><AttributionTracker /></>;
}
