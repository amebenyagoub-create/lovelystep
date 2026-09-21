import "server-only";

const PIXEL_CODE = /^[A-Z0-9]{10,40}$/i;

export type TikTokConfig = {
  enabled: boolean;
  eventsApiEnabled: boolean;
  pixelId: string;
  accessToken: string;
};

export function tiktokConfig(): TikTokConfig {
  const pixelId = (process.env.TIKTOK_PIXEL_ID ?? "").trim();
  const accessToken = (process.env.TIKTOK_EVENTS_ACCESS_TOKEN ?? "").trim();
  const enabled = process.env.TIKTOK_TRACKING_ENABLED === "true" && PIXEL_CODE.test(pixelId);
  return { enabled, eventsApiEnabled: enabled && accessToken.length > 0, pixelId, accessToken };
}

