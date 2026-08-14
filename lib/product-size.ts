export type StoreLocale = "fr" | "en" | "ar";

type SizeLike = { label: string; age?: string | null; height?: string | null };

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

const AGE_HEIGHT_MAP: Record<string, string> = {
  "0-3 mois": "50–62",
  "4-7 mois": "62–70",
  "8-11 mois": "70–76",
  "12-18 mois": "76–83",
  "18-24 mois": "83–90",
  "1-2 ans": "76–90",
  "2-3 ans": "90–98",
  "3-4 ans": "98–104",
  "4-5 ans": "104–110",
  "5-6 ans": "110–116",
  "6-7 ans": "116–122",
  "6-8 ans": "116–128",
  "7-8 ans": "122–128",
  "8-9 ans": "128–134",
  "9-10 ans": "134–140",
};

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

export function recommendedHeightLabel(size: SizeLike, locale: StoreLocale): string {
  const unit = locale === "ar" ? "سم" : "cm";
  const explicit = String(size.height ?? "").trim().replace(/\s*(?:cm|سم)\s*$/i, "");
  if (explicit) return `${explicit} ${unit}`;
  const supplierSize = String(size.label).trim().match(/^(\d{2,3})(?:\s*cm)?(?:\s*\/.*)?$/i)?.[1];
  if (supplierSize) return `${supplierSize} ${unit}`;
  const range = AGE_HEIGHT_MAP[frenchAgeLabel(size)];
  return range ? `${range} ${unit}` : "—";
}
