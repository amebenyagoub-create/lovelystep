import rawCities from "./data/algeria-cities.raw.json";
import type { AlgeriaWilaya } from "./types";

type RawCity = {
  commune_name?: string;
  commune_name_fr?: string;
  wilaya_code?: string | number;
  wilaya_name?: string;
  wilaya_name_fr?: string;
  code_commune?: string | number;
};

// Source: Algeria-Cities (MIT), updated for the 69-wilaya / 1,541-commune division.
// https://github.com/ihahachi/Algeria-Cities
const grouped = new Map<string, AlgeriaWilaya>();

for (const item of rawCities as RawCity[]) {
  const code = String(item.wilaya_code ?? "").padStart(2, "0");
  const communeCode = String(item.code_commune ?? "").trim();
  const nameFr = String(item.commune_name_fr ?? "").trim();
  const nameAr = String(item.commune_name ?? "").trim();
  if (!code || !communeCode || !nameFr) continue;
  const wilaya = grouped.get(code) ?? {
    code,
    nameFr: String(item.wilaya_name_fr ?? code).trim(),
    nameAr: String(item.wilaya_name ?? item.wilaya_name_fr ?? code).trim(),
    communes: [],
  };
  wilaya.communes.push({ code: communeCode, nameFr, nameAr });
  grouped.set(code, wilaya);
}

export const algeriaWilayas: AlgeriaWilaya[] = [...grouped.values()]
  .sort((left, right) => Number(left.code) - Number(right.code))
  .map((wilaya) => ({
    ...wilaya,
    communes: wilaya.communes.sort((left, right) => left.nameFr.localeCompare(right.nameFr, "fr")),
  }));

export function findWilaya(code: string): AlgeriaWilaya | null {
  return algeriaWilayas.find((wilaya) => wilaya.code === code.padStart(2, "0")) ?? null;
}

export function validAlgeriaAddress(wilayaCode: string, communeName: string): AlgeriaWilaya | null {
  const wilaya = findWilaya(wilayaCode);
  if (!wilaya) return null;
  const normalized = communeName.trim().toLocaleLowerCase("fr");
  return wilaya.communes.some((commune) => commune.nameFr.toLocaleLowerCase("fr") === normalized || commune.nameAr === communeName.trim()) ? wilaya : null;
}
