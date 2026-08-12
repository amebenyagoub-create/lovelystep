import "server-only";

/**
 * Graph API version is pinned via META_GRAPH_API_VERSION.
 *
 * Verified against https://developers.facebook.com/docs/graph-api/changelog on 2026-08-10:
 * v26.0 is the current version (released 2026-07-29). Meta ships a new version roughly
 * quarterly and retires each one about two years after release, so this default has a
 * finite shelf life — an expired version fails closed (events rejected), it does not
 * silently degrade.
 *
 * Upgrade strategy: re-check the changelog each quarter, bump META_GRAPH_API_VERSION in
 * staging first, confirm Events Manager still receives test events with
 * META_TEST_EVENT_CODE set, then bump production. Update this default at the same time.
 */
const DEFAULT_GRAPH_API_VERSION = "v26.0";

export type MetaConfig = {
  enabled: boolean;
  pixelId: string;
  datasetId: string;
  accessToken: string;
  graphApiVersion: string;
  testEventCode: string;
  isProduction: boolean;
};

export function metaConfig(): MetaConfig {
  // META_PIXEL_ID is read at runtime; NEXT_PUBLIC_META_PIXEL_ID is inlined at `next build` and
  // then frozen (see next/dist/docs/01-app/02-guides/environment-variables.md), so on a host
  // where the variable is set after the build it reads empty forever. The public name stays as
  // a fallback for existing deployments. Nothing client-side reads either one: MetaPixel takes
  // the id as a prop, so the server can resolve it per request.
  const pixelId = ((process.env.META_PIXEL_ID ?? "").trim() || (process.env.NEXT_PUBLIC_META_PIXEL_ID ?? "")).trim();
  // Meta's CAPI dataset id is the Pixel id for a standard web dataset; META_DATASET_ID overrides it.
  const datasetId = (process.env.META_DATASET_ID ?? "").trim() || pixelId;
  const accessToken = (process.env.META_ACCESS_TOKEN ?? "").trim();
  const isProduction = process.env.NODE_ENV === "production";
  return {
    // Tracking is opt-in: it stays off unless explicitly enabled AND fully configured.
    enabled: process.env.META_TRACKING_ENABLED === "true" && /^\d{5,30}$/.test(datasetId) && accessToken.length > 0,
    pixelId,
    datasetId,
    accessToken,
    graphApiVersion: (process.env.META_GRAPH_API_VERSION ?? "").trim() || DEFAULT_GRAPH_API_VERSION,
    // Test events must never be attached to production traffic.
    testEventCode: isProduction ? "" : (process.env.META_TEST_EVENT_CODE ?? "").trim(),
    isProduction,
  };
}

export function metaStatus(): { trackingEnabled: boolean; pixelConfigured: boolean; capiConfigured: boolean; graphApiVersion: string; testEventCodeActive: boolean } {
  const config = metaConfig();
  return {
    trackingEnabled: config.enabled,
    pixelConfigured: /^\d{5,30}$/.test(config.pixelId),
    capiConfigured: config.accessToken.length > 0 && /^\d{5,30}$/.test(config.datasetId),
    graphApiVersion: config.graphApiVersion,
    testEventCodeActive: config.testEventCode.length > 0,
  };
}
