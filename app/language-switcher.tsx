"use client";

import type { StoreLocale } from "@/lib/use-locale";

export default function LanguageSwitcher({ locale, onChange }: { locale: StoreLocale; onChange: (locale: StoreLocale) => void }) {
  return <div className="language-switcher" aria-label="Language"><button className={locale === "fr" ? "active" : ""} onClick={() => onChange("fr")}>FR</button><button className={locale === "en" ? "active" : ""} onClick={() => onChange("en")}>EN</button><button className={locale === "ar" ? "active" : ""} onClick={() => onChange("ar")}>AR</button></div>;
}
