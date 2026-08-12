/**
 * Money and ratio helpers.
 *
 * All monetary amounts in this codebase are integer minor units (centimes for DZD).
 * Nothing here introduces floating-point money: divisions that produce ratios return plain
 * numbers, divisions that produce money round explicitly back to integers.
 */

/** Safe division. Returns null instead of Infinity or NaN so no KPI can display a bogus number. */
export function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
}

/** Safe percentage, rounded to one decimal. */
export function percent(numerator: number, denominator: number): number | null {
  const value = ratio(numerator, denominator);
  return value === null ? null : Math.round(value * 1000) / 10;
}

/** Money divided by a count, rounded to whole minor units. */
export function perUnitMinor(totalMinor: number, count: number): number | null {
  const value = ratio(totalMinor, count);
  return value === null ? null : Math.round(value);
}

export const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

/** Median in days/hours, used for duration metrics. Returns null on an empty set. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  return Math.round(value * 100) / 100;
}
