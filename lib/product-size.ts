export type StoreLocale = "fr" | "en" | "ar";

export type SizeLike = { label: string; age?: string | null; height?: string | null };

/**
 * Table des tailles du fournisseur (1688), colonne 身高 : la stature de l'enfant, pas la
 * longueur du vetement. Le fournisseur note « 尺码偏小 » — ses tailles taillent petit — et la
 * table integre deja cette marge, donc elle se lit telle quelle. Les codes 130 et 140
 * prolongent le meme pas : la fiche fournisseur s'arrete a 120.
 */
const SUPPLIER_SIZE_TABLE: Array<{ code: number; min: number; max: number; age: string }> = [
  { code: 80, min: 70, max: 80, age: "9-18 mois" },
  { code: 90, min: 80, max: 85, age: "18-24 mois" },
  { code: 100, min: 85, max: 95, age: "2-3 ans" },
  { code: 110, min: 95, max: 103, age: "3-4 ans" },
  { code: 120, min: 103, max: 110, age: "4-5 ans" },
  { code: 130, min: 110, max: 118, age: "5-6 ans" },
  { code: 140, min: 118, max: 126, age: "6-7 ans" },
];

/** Gammes bebe : sous 80, le nombre du fournisseur est deja la stature de l'enfant. */
const BABY_AGE_MAP: Array<[number, string]> = [
  [59, "0-3 mois"],
  [66, "0-3 mois"],
  [73, "4-7 mois"],
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
  "4-6 ans": "104–116",
  "5-6 ans": "110–116",
  "6-7 ans": "116–122",
  "6-8 ans": "116–128",
  "7-8 ans": "122–128",
  "8-9 ans": "128–134",
  "9-10 ans": "134–140",
};

const AGE_PATTERN = /^\d+\s*[-–]\s*\d+\s*(?:mois|ans?|months?|years?)$/i;

/** En dessous de ce code, le nombre est déjà la stature de l'enfant (gammes bébé 59 à 73). */
const SUPPLIER_HEIGHT_FLOOR = 80;

function supplierCode(size: SizeLike): number | null {
  const explicit = String(size.age ?? "").trim();
  const code = `${size.label} ${explicit}`.trim().match(/^(\d{2,3})(?:\s*cm)?(?:\s*\/[^\s]+)?/i)?.[1];
  return code ? Number(code) : null;
}

function supplierHeightRange(size: SizeLike): HeightRange | null {
  const code = supplierCode(size);
  if (code === null || code < SUPPLIER_HEIGHT_FLOOR) return null;
  const row = SUPPLIER_SIZE_TABLE.find((entry) => code <= entry.code);
  return row ? { min: row.min, max: row.max } : null;
}

export function frenchAgeLabel(size: SizeLike): string {
  const explicit = String(size.age ?? "").trim();
  if (AGE_PATTERN.test(explicit)) return explicit;

  const supplierCode = `${size.label} ${explicit}`.trim().match(/^(\d{2,3})(?:\s*cm)?(?:\s*\/[^\s]+)?/i)?.[1];
  if (!supplierCode) return explicit || String(size.label).trim();

  const supplierSize = Number(supplierCode);
  const supplierRow = SUPPLIER_SIZE_TABLE.find((row) => supplierSize <= row.code);
  if (supplierSize >= SUPPLIER_HEIGHT_FLOOR && supplierRow) return supplierRow.age;
  return BABY_AGE_MAP.find(([maximum]) => supplierSize <= maximum)?.[1] ?? supplierRow?.age ?? (explicit || String(size.label).trim());
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

  const range = heightRange(size);
  return range ? `${range.min}–${range.max} ${unit}` : "—";
}

export type HeightRange = { min: number; max: number };
export type SizeRecommendation = { label: string; fit: "match" | "under" | "over" };

/** Fourchette de stature couverte par une taille, en centimètres. */
export function heightRange(size: SizeLike): HeightRange | null {
  const source = String(size.height ?? "").trim();
  if (!source) return supplierHeightRange(size) ?? ageHeightRange(size);
  const bounds = source.match(/(\d{2,3})\s*[-–]\s*(\d{2,3})/);
  if (bounds) {
    const min = Number(bounds[1]);
    const max = Number(bounds[2]);
    return max >= min ? { min, max } : null;
  }
  const single = source.match(/(\d{2,3})/);
  return single ? { min: Number(single[1]) - 5, max: Number(single[1]) + 5 } : null;
}

function ageHeightRange(size: SizeLike): HeightRange | null {
  const bounds = (AGE_HEIGHT_MAP[frenchAgeLabel(size)] || "").match(/(\d{2,3})\s*[-–]\s*(\d{2,3})/);
  return bounds ? { min: Number(bounds[1]), max: Number(bounds[2]) } : null;
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
