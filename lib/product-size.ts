export type StoreLocale = "fr" | "en" | "ar";

type SizeLike = { label: string; age?: string | null };

const SUPPLIER_AGE_MAP: Array<[number, string]> = [
  [59, "0-3 mois"],
  [66, "0-3 mois"],
  [73, "4-7 mois"],
  [80, "8-11 mois"],
  [90, "12-18 mois"],
  [100, "18-24 mois"],
  [110, "2-3 ans"],
  [120, "3-4 ans"],
  [130, "4-5 ans"],
  [140, "5-6 ans"],
];

export function frenchAgeLabel(size: SizeLike): string {
  const explicit = String(size.age ?? "").trim();
  if (explicit) return explicit;
  const match = String(size.label).trim().match(/^(\d{2,3})(?:\s*cm)?$/i);
  if (!match) return String(size.label).trim();
  const supplierSize = Number(match[1]);
  return SUPPLIER_AGE_MAP.find(([maximum]) => supplierSize <= maximum)?.[1] ?? String(size.label).trim();
}

export function localizedAgeLabel(size: SizeLike, locale: StoreLocale): string {
  const value = frenchAgeLabel(size);
  if (locale === "fr") return value;
  const months = value.match(/^(\d+)\s*[-–]\s*(\d+)\s*mois$/i);
  if (months) return locale === "ar" ? `${months[1]}–${months[2]} أشهر` : `${months[1]}–${months[2]} months`;
  const years = value.match(/^(\d+)\s*[-–]\s*(\d+)\s*ans?$/i);
  if (years) return locale === "ar" ? `${years[1]}–${years[2]} سنوات` : `${years[1]}–${years[2]} years`;
  return value;
}
