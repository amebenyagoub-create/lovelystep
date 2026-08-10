import "server-only";

import { purgeOldTrackingData, type PurgeResult } from "../db-postgres";

/**
 * Data retention.
 *
 * Tracking data is kept only as long as it is useful for reporting, then deleted.
 * Retention windows are configurable; the defaults are deliberately conservative.
 *
 * Financial records (orders, refunds, costs, expenses) are NEVER purged here: they are
 * accounting records with their own legal retention obligations. Only behavioural and
 * tracking data expires.
 */

const positiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export type RetentionPolicy = { visitsDays: number; metaEventsDays: number; attributionDays: number };

export function retentionPolicy(): RetentionPolicy {
  return {
    // Visitor counts feed the 30-day KPI, so keep a margin beyond it.
    visitsDays: positiveInt(process.env.RETENTION_VISITS_DAYS, 180),
    // The dedup ledger only needs to outlive Meta's attribution windows.
    metaEventsDays: positiveInt(process.env.RETENTION_META_EVENTS_DAYS, 180),
    // Attribution supports historical ROAS, so it is the longest-lived of the three.
    attributionDays: positiveInt(process.env.RETENTION_ATTRIBUTION_DAYS, 400),
  };
}

export async function applyRetention(): Promise<PurgeResult & { policy: RetentionPolicy }> {
  const policy = retentionPolicy();
  const result = await purgeOldTrackingData(policy);
  return { ...result, policy };
}
