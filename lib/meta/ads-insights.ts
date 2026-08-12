import "server-only";

import { upsertAdsInsights, type AdsInsightRow } from "../db-postgres";
import { metaConfig } from "./config";
import { graphPaginate } from "./graph";

/**
 * Meta Ads Insights ingestion.
 *
 * Two properties matter most here:
 * 1. `actions` / `action_values` are keyed by `action_type`, never by array position — Meta
 *    reorders and omits entries freely, so positional access silently reads the wrong metric.
 * 2. Recent dates are re-fetched on every run because attribution keeps changing for days
 *    after the fact; upserts are idempotent so a repeat sync corrects rather than duplicates.
 */

export type InsightsLevel = "account" | "campaign" | "adset" | "ad";

type ActionEntry = { action_type?: string; value?: string };
type InsightsApiRow = {
  date_start?: string;
  date_stop?: string;
  account_id?: string;
  account_currency?: string;
  campaign_id?: string; campaign_name?: string;
  adset_id?: string; adset_name?: string;
  ad_id?: string; ad_name?: string;
  objective?: string;
  optimization_goal?: string;
  attribution_setting?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  clicks?: string;
  inline_link_clicks?: string;
  unique_clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  outbound_clicks?: ActionEntry[];
  actions?: ActionEntry[];
  action_values?: ActionEntry[];
  purchase_roas?: ActionEntry[];
  video_thruplay_watched_actions?: ActionEntry[];
  video_play_actions?: ActionEntry[];
  video_p25_watched_actions?: ActionEntry[];
  video_p50_watched_actions?: ActionEntry[];
  video_p75_watched_actions?: ActionEntry[];
  video_p100_watched_actions?: ActionEntry[];
};

const FIELDS = [
  "account_id", "account_currency", "campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name",
  "objective", "optimization_goal", "attribution_setting",
  "spend", "impressions", "reach", "frequency", "clicks", "inline_link_clicks", "unique_clicks", "ctr", "cpc", "cpm",
  "outbound_clicks", "actions", "action_values", "purchase_roas",
  "video_thruplay_watched_actions", "video_play_actions",
  "video_p25_watched_actions", "video_p50_watched_actions", "video_p75_watched_actions", "video_p100_watched_actions",
].join(",");

/** Looks up one action_type. Returns 0 when absent rather than guessing from another entry. */
function actionValue(entries: ActionEntry[] | undefined, ...types: string[]): number {
  if (!Array.isArray(entries)) return 0;
  for (const type of types) {
    const found = entries.find((entry) => entry.action_type === type);
    if (found) return Number(found.value ?? 0) || 0;
  }
  return 0;
}

const toInt = (value: string | undefined): number => Math.round(Number(value ?? 0)) || 0;
/** Money arrives as a decimal string in the account currency; store exact minor units. */
const toMinor = (value: string | number | undefined): number => {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
};
const toNumeric = (value: string | undefined): number | null => {
  const amount = Number(value ?? "");
  return Number.isFinite(amount) ? amount : null;
};

function entityIdentity(level: InsightsLevel, row: InsightsApiRow): { entityId: string; entityName: string } {
  if (level === "ad") return { entityId: String(row.ad_id ?? ""), entityName: String(row.ad_name ?? "") };
  if (level === "adset") return { entityId: String(row.adset_id ?? ""), entityName: String(row.adset_name ?? "") };
  if (level === "campaign") return { entityId: String(row.campaign_id ?? ""), entityName: String(row.campaign_name ?? "") };
  return { entityId: String(row.account_id ?? ""), entityName: "" };
}

export function mapInsightRow(level: InsightsLevel, row: InsightsApiRow): AdsInsightRow | null {
  const { entityId, entityName } = entityIdentity(level, row);
  const date = row.date_start;
  if (!entityId || !date) return null;

  const purchases = actionValue(row.actions, "purchase", "offsite_conversion.fb_pixel_purchase");
  const purchaseValueMinor = toMinor(actionValue(row.action_values, "purchase", "offsite_conversion.fb_pixel_purchase"));
  const spendMinor = toMinor(row.spend);

  return {
    date,
    level,
    entityId,
    entityName,
    accountId: String(row.account_id ?? ""),
    campaignId: row.campaign_id ?? null,
    campaignName: row.campaign_name ?? null,
    adsetId: row.adset_id ?? null,
    adsetName: row.adset_name ?? null,
    adId: row.ad_id ?? null,
    adName: row.ad_name ?? null,
    status: null,
    objective: row.objective ?? null,
    optimizationGoal: row.optimization_goal ?? null,
    attributionSetting: row.attribution_setting ?? null,
    accountTimezone: null,
    currency: String(row.account_currency ?? ""),
    spendMinor,
    purchaseValueMinor,
    cpcMinor: row.cpc == null ? null : toMinor(row.cpc),
    cpmMinor: row.cpm == null ? null : toMinor(row.cpm),
    // Derived rather than requested: Meta's cost_per_action_type needs its own parsing and
    // returns the same figure. Division guarded so zero purchases never yields Infinity.
    costPerPurchaseMinor: purchases > 0 ? Math.round(spendMinor / purchases) : null,
    impressions: toInt(row.impressions),
    reach: toInt(row.reach),
    frequency: toNumeric(row.frequency),
    clicks: toInt(row.clicks),
    linkClicks: toInt(row.inline_link_clicks),
    outboundClicks: actionValue(row.outbound_clicks, "outbound_click"),
    uniqueClicks: toInt(row.unique_clicks),
    ctr: toNumeric(row.ctr),
    landingPageViews: actionValue(row.actions, "landing_page_view"),
    leads: actionValue(row.actions, "lead", "offsite_conversion.fb_pixel_lead"),
    addsToCart: actionValue(row.actions, "add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"),
    checkouts: actionValue(row.actions, "initiate_checkout", "offsite_conversion.fb_pixel_initiate_checkout"),
    purchases,
    purchaseRoas: (() => {
      const roas = actionValue(row.purchase_roas, "purchase", "omni_purchase");
      return roas || null;
    })(),
    videoViews: actionValue(row.video_play_actions, "video_view"),
    thruplays: actionValue(row.video_thruplay_watched_actions, "video_view"),
    videoP25: actionValue(row.video_p25_watched_actions, "video_view"),
    videoP50: actionValue(row.video_p50_watched_actions, "video_view"),
    videoP75: actionValue(row.video_p75_watched_actions, "video_view"),
    videoP100: actionValue(row.video_p100_watched_actions, "video_view"),
    actions: row.actions ?? [],
    actionValues: row.action_values ?? [],
  };
}

export type InsightsSyncResult = { level: InsightsLevel; rows: number; from: string; to: string };

/** Fetches one level for a date range and upserts it. Dates are inclusive, YYYY-MM-DD. */
export async function syncInsightsLevel(level: InsightsLevel, since: string, until: string): Promise<InsightsSyncResult> {
  const config = metaConfig();
  const accountId = (process.env.META_AD_ACCOUNT_ID ?? "").trim();
  if (!accountId) throw new Error("META_AD_ACCOUNT_ID est absent du serveur.");
  if (!config.accessToken) throw new Error("META_ACCESS_TOKEN est absent du serveur.");
  const path = `${accountId.startsWith("act_") ? accountId : `act_${accountId}`}/insights`;

  const rows = await graphPaginate<InsightsApiRow>(path, {
    level,
    fields: FIELDS,
    // time_increment=1 gives one row per day, which is what the daily table stores.
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    limit: "500",
  });

  const mapped = rows.map((row) => mapInsightRow(level, row)).filter((row): row is AdsInsightRow => row !== null);
  if (mapped.length) await upsertAdsInsights(mapped);
  return { level, rows: mapped.length, from: since, to: until };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Incremental daily sync.
 * `refreshDays` re-fetches the trailing window because Meta keeps revising attributed
 * conversions for several days; 7 is the conventional safety margin.
 */
export async function syncRecentInsights(refreshDays = 7, levels: InsightsLevel[] = ["account", "campaign", "adset", "ad"]): Promise<InsightsSyncResult[]> {
  const until = isoDate(new Date());
  const since = isoDate(new Date(Date.now() - refreshDays * DAY_MS));
  const results: InsightsSyncResult[] = [];
  for (const level of levels) results.push(await syncInsightsLevel(level, since, until));
  return results;
}

/** Historical backfill, chunked so a long range cannot blow the request timeout. */
export async function backfillInsights(since: string, until: string, levels: InsightsLevel[] = ["account", "campaign", "adset", "ad"], chunkDays = 30): Promise<InsightsSyncResult[]> {
  const results: InsightsSyncResult[] = [];
  const end = new Date(`${until}T00:00:00Z`).getTime();
  let cursor = new Date(`${since}T00:00:00Z`).getTime();
  if (!Number.isFinite(cursor) || !Number.isFinite(end) || cursor > end) throw new Error("Plage de dates invalide.");
  while (cursor <= end) {
    const chunkEnd = Math.min(cursor + (chunkDays - 1) * DAY_MS, end);
    for (const level of levels) results.push(await syncInsightsLevel(level, isoDate(new Date(cursor)), isoDate(new Date(chunkEnd))));
    cursor = chunkEnd + DAY_MS;
  }
  return results;
}

export const __testing = { actionValue, mapInsightRow, toMinor };
