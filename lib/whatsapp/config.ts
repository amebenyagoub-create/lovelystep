import "server-only";

import { siteUrl } from "@/lib/site-url";

const DEFAULT_GRAPH_API_VERSION = "v26.0";

export type WhatsAppConfig = {
  accessToken: string;
  appSecret: string;
  businessNumber: string;
  graphApiVersion: string;
  phoneNumberId: string;
  verifyToken: string;
};

export function whatsappConfig(): WhatsAppConfig {
  return {
    accessToken: (process.env.WHATSAPP_ACCESS_TOKEN ?? "").trim(),
    appSecret: ((process.env.WHATSAPP_APP_SECRET ?? "").trim() || (process.env.META_APP_SECRET ?? "").trim()),
    businessNumber: (process.env.WHATSAPP_BUSINESS_NUMBER ?? "").trim(),
    graphApiVersion: (process.env.WHATSAPP_GRAPH_API_VERSION ?? process.env.META_GRAPH_API_VERSION ?? DEFAULT_GRAPH_API_VERSION).trim(),
    phoneNumberId: (process.env.WHATSAPP_PHONE_NUMBER_ID ?? "").trim(),
    verifyToken: (process.env.WHATSAPP_VERIFY_TOKEN ?? "").trim(),
  };
}

export function whatsappStatus() {
  const config = whatsappConfig();
  const publicSiteUrl = siteUrl();
  let webhookUrl = "";
  try { webhookUrl = new URL("/api/whatsapp/webhook", publicSiteUrl).toString(); } catch { /* SITE_URL is not configured yet. */ }
  const businessNumberConfigured = /^\+?\d{8,15}$/.test(config.businessNumber.replace(/[\s()-]/g, ""));
  const webhookConfigured = config.verifyToken.length >= 16 && config.appSecret.length > 0;
  const messagingConfigured = /^\d{5,30}$/.test(config.phoneNumberId) && config.accessToken.length > 0;
  return {
    businessNumberConfigured,
    graphApiVersion: config.graphApiVersion,
    messagingConfigured,
    ready: businessNumberConfigured && webhookConfigured && messagingConfigured,
    webhookConfigured,
    webhookUrl,
  };
}
