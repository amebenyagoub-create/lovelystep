"use client";

import { useSyncExternalStore } from "react";
import { writeConsentCookie } from "@/lib/meta/consent";
import { notifyConsentChanged, useConsent } from "@/lib/meta/use-consent";

const copy = {
  fr: { text: "Nous utilisons des cookies de mesure publicitaire pour comprendre l’origine de nos commandes. Ils ne sont déposés qu’avec votre accord.", accept: "Accepter", refuse: "Refuser", label: "Choix des cookies" },
  en: { text: "We use advertising measurement cookies to understand where our orders come from. They are only set with your agreement.", accept: "Accept", refuse: "Decline", label: "Cookie choice" },
  ar: { text: "نستخدم ملفات تعريف الارتباط لقياس الإعلانات لفهم مصدر طلباتنا. لا تُستخدم إلا بموافقتكم.", accept: "أوافق", refuse: "أرفض", label: "اختيار ملفات تعريف الارتباط" },
} as const;

type BannerLocale = keyof typeof copy;

// The stored locale is written by useLocale(); this component only reads it, never writes it back.
function subscribeLocale(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}
function readLocale(): BannerLocale {
  const stored = localStorage.getItem("lovelystep_locale");
  return stored === "en" || stored === "ar" ? stored : "fr";
}

/**
 * Marketing consent gate. Rendered on every page; hides itself once a choice is stored.
 * Declining is exactly as easy as accepting, and no tracking runs until "Accept" is pressed.
 */
export default function ConsentBanner() {
  const consent = useConsent();
  const locale = useSyncExternalStore(subscribeLocale, readLocale, () => "fr" as const);

  if (consent !== "unset") return null;
  const text = copy[locale];
  function choose(state: "granted" | "denied") {
    writeConsentCookie(state);
    notifyConsentChanged();
  }
  return (
    <div className="consent-banner" role="dialog" aria-label={text.label} dir={locale === "ar" ? "rtl" : "ltr"}>
      <p>{text.text}</p>
      <div className="consent-actions">
        <button type="button" className="consent-refuse" onClick={() => choose("denied")}>{text.refuse}</button>
        <button type="button" className="consent-accept" onClick={() => choose("granted")}>{text.accept}</button>
      </div>
    </div>
  );
}
