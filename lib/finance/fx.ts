import "server-only";

import { listFxRates } from "../db-postgres";

/**
 * Currency conversion for ad spend.
 *
 * The Meta ad account is not billed in DZD, so every spend row must be converted with the rate
 * that applied on its own date. A missing rate is NOT treated as 1.0 and NOT treated as zero:
 * the conversion reports the gap, and the KPI layer degrades to "unavailable" rather than
 * publishing a wrong profit figure.
 */

export type SpendRow = { date: string; currency: string; spendMinor: number };
export type ConversionResult = {
  /** Converted total in DZD minor units, or null when any row could not be converted. */
  totalDzdMinor: number | null;
  convertedRows: number;
  missingRates: Array<{ date: string; currency: string }>;
};

export async function convertSpendToDzd(rows: SpendRow[]): Promise<ConversionResult> {
  if (!rows.length) return { totalDzdMinor: 0, convertedRows: 0, missingRates: [] };

  const needed = [...new Set(rows.filter((row) => row.currency && row.currency !== "DZD").map((row) => row.currency))];
  const rates = needed.length ? await listFxRates(needed) : [];
  const rateByKey = new Map(rates.map((rate) => [`${rate.rateDate}|${rate.currency}`, rate.dzdPerUnit]));

  let total = 0;
  let converted = 0;
  const missing: Array<{ date: string; currency: string }> = [];

  for (const row of rows) {
    if (!row.currency || row.currency === "DZD") {
      total += row.spendMinor;
      converted += 1;
      continue;
    }
    const rate = rateByKey.get(`${row.date}|${row.currency}`);
    if (rate == null) {
      missing.push({ date: row.date, currency: row.currency });
      continue;
    }
    // Minor units in, minor units out: multiply then round once.
    total += Math.round(row.spendMinor * rate);
    converted += 1;
  }

  return {
    // A partial total would silently understate spend, which inflates profit. Refuse it.
    totalDzdMinor: missing.length ? null : total,
    convertedRows: converted,
    missingRates: missing,
  };
}
