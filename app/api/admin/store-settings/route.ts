import { NextResponse } from "next/server";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { audit, DEFAULT_STORE_SETTINGS, saveStoreSettings } from "@/lib/db-postgres";
import { revalidateTag } from "next/cache";
import { CATALOG_TAG } from "@/lib/public-cache";
import type { LocalizedText, StoreSettings } from "@/lib/types";

const validColor = (value: string) => /^#[0-9A-F]{6}$/i.test(value);
const validImage = (value: string) => !value || ((/^\/api\/media\/(products|imports|storefront)\/[a-zA-Z0-9._/-]+$/.test(value) || /^\/images\/[a-zA-Z0-9._/-]+$/.test(value)) && !value.includes(".."));
const text = (value: unknown, fallback: LocalizedText, max = 500): LocalizedText => {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { fr: String(source.fr ?? fallback.fr).trim().slice(0, max), en: String(source.en ?? fallback.en).trim().slice(0, max), ar: String(source.ar ?? fallback.ar).trim().slice(0, max) };
};

export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as Partial<StoreSettings>;
  const heroImage = String(body.heroImage ?? "");
  const theme = { ...DEFAULT_STORE_SETTINGS.theme, ...(body.theme ?? {}) };
  if (!validImage(heroImage) || Object.values(theme).some((color) => !validColor(String(color)))) return NextResponse.json({ error: "Image ou couleur de thème invalide." }, { status: 400 });
  const settings: StoreSettings = {
    announcement: text(body.announcement, DEFAULT_STORE_SETTINGS.announcement, 180), heroEyebrow: text(body.heroEyebrow, DEFAULT_STORE_SETTINGS.heroEyebrow, 120),
    heroTitle: text(body.heroTitle, DEFAULT_STORE_SETTINGS.heroTitle, 180), heroAccent: text(body.heroAccent, DEFAULT_STORE_SETTINGS.heroAccent, 120),
    heroDescription: text(body.heroDescription, DEFAULT_STORE_SETTINGS.heroDescription, 600), primaryCta: text(body.primaryCta, DEFAULT_STORE_SETTINGS.primaryCta, 80),
    storyTitle: text(body.storyTitle, DEFAULT_STORE_SETTINGS.storyTitle, 180), storyDescription: text(body.storyDescription, DEFAULT_STORE_SETTINGS.storyDescription, 600),
    heroImage: heroImage || null,
    theme: { navy: theme.navy.toUpperCase(), coral: theme.coral.toUpperCase(), cream: theme.cream.toUpperCase(), sand: theme.sand.toUpperCase(), background: theme.background.toUpperCase() },
  };
  await saveStoreSettings(settings);
  revalidateTag(CATALOG_TAG);
  await audit(session.adminId, "storefront.update", "settings", "storefront");
  return NextResponse.json({ settings });
}
