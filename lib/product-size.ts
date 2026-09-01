export type StoreLocale = "fr" | "en" | "ar";

export type SizeLike = { label: string; age?: string | null; height?: string | null };

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

const AGE_PATTERN = /^\d+\s*[-–]\s*\d+\s*(?:mois|ans?|months?|years?)$/i;

export function frenchAgeLabel(size: SizeLike): string {
  const explicit = String(size.age ?? "").trim();
  if (AGE_PATTERN.test(explicit)) return explicit;

  const supplierCode = `${size.label} ${explicit}`.trim().match(/^(\d{2,3})(?:\s*cm)?(?:\s*\/[^\s]+)?/i)?.[1];
  if (!supplierCode) return explicit || String(size.label).trim();

  const supplierSize = Number(supplierCode);
  return SUPPLIER_AGE_MAP.find(([maximum]) => supplierSize <= maximum)?.[1] ?? (explicit || String(size.label).trim());
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

  const range = AGE_HEIGHT_MAP[frenchAgeLabel(size)];
  if (range) return `${range} ${unit}`;

  const supplierSize = String(size.label).trim().match(/^(\d{2,3})(?:\s*cm)?(?:\s*\/.*)?$/i)?.[1];
  return supplierSize ? `${supplierSize} ${unit}` : "—";
}

export type HeightRange = { min: number; max: number };
export type SizeRecommendation = { label: string; fit: "match" | "under" | "over" };

/** Fourchette de stature couverte par une taille, en centimètres. */
export function heightRange(size: SizeLike): HeightRange | null {
  const source = String(size.height ?? "").trim() || AGE_HEIGHT_MAP[frenchAgeLabel(size)] || "";
  const bounds = source.match(/(\d{2,3})\s*[-–]\s*(\d{2,3})/);
  if (bounds) {
    const min = Number(bounds[1]);
    const max = Number(bounds[2]);
    return max >= min ? { min, max } : null;
  }
  const single = source.match(/(\d{2,3})/);
  return single ? { min: Number(single[1]) - 5, max: Number(single[1]) + 5 } : null;
}

/**
 * Taille conseillée pour une stature donnée. Entre deux tailles on retient toujours la plus
 * grande ; `fit` signale une stature hors de l'échelle proposée par le produit.
 */
export function recommendSize(sizes: readonly SizeLike[], heightCm: number): SizeRecommendation | null {
  if (!Number.isFinite(heightCm) || heightCm < 30 || heightCm > 200) return null;
  const scale = sizes.flatMap((size) => {
    const range = heightRange(size);
    return range ? [{ label: String(size.label), range }] : [];
  }).sort((first, second) => first.range.min - second.range.min || first.range.max - second.range.max);
  if (!scale.length) return null;

  const smallest = scale[0];
  const largest = scale[scale.length - 1];
  if (heightCm < smallest.range.min) return { label: smallest.label, fit: "under" };
  if (heightCm > largest.range.max) return { label: largest.label, fit: "over" };

  const covering = scale.filter(({ range }) => heightCm >= range.min && heightCm <= range.max);
  if (covering.length) return { label: covering[covering.length - 1].label, fit: "match" };
  const nextUp = scale.find(({ range }) => range.min > heightCm);
  return nextUp ? { label: nextUp.label, fit: "match" } : { label: largest.label, fit: "match" };
}
