"use client";

import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import { writeConsentCookie } from "@/lib/meta/consent";
import { notifyConsentChanged, useConsent } from "@/lib/meta/use-consent";

// Benefit-framed copy. The gate itself is unchanged: nothing is collected until "accept" is
// pressed, and refusing stays a single tap on a button of the same size. Only the wording and
// the visual weight of the primary action changed, to lift a very low opt-in rate on ad traffic.
const copy = {
  fr: {
    text: "Un petit oui nous aide à vous proposer les bonnes tenues et à savoir d’où viennent nos commandes.",
    accept: "Accepter",
    refuse: "Refuser",
    label: "Choix des cookies",
  },
  en: {
    text: "A quick yes helps us suggest the right outfits and see where our orders come from.",
    accept: "Accept",
    refuse: "Decline",
    label: "Cookie choice",
  },
  ar: {
    text: "موافقتكم تساعدنا على اقتراح الملابس المناسبة ومعرفة مصدر طلباتنا.",
    accept: "أوافق",
    refuse: "أرفض",
    label: "اختيار ملفات تعريف الارتباط",
  },
} as const;

type BannerLocale = keyof typeof copy;

// The stored locale is written by useLocale(); this component only reads it, never writes it back.
function subscribeLocale(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}
function readLocale(): BannerLocale {
  try {
    const stored = localStorage.getItem("lovelystep_locale");
    return stored === "en" || stored === "ar" ? stored : "fr";
  } catch {
    // Private browsing and blocked storage must not break the page.
    return "fr";
  }
}

/**
 * RETIRED — not mounted anywhere. Measurement now runs by default and visitors opt out from the
 * privacy page (see OptOutButton in legal-page.tsx). Kept because re-enabling an opt-in gate is
 * then one import in store-tracking.tsx away; delete it if that is never coming back.
 *
 * Marketing consent gate. Rendered on every page; hides itself once a choice is stored.
 * Declining is exactly as easy as accepting, and no tracking runs until "Accept" is pressed.
 *
 * The banner mounts hidden and is revealed on the next frame so it slides in after the page has
 * painted: an element that arrives is read, one that is already there is treated as furniture.
 * No delay is used, so `fbclid` is still in the URL when consent is granted on a landing page.
 */
export default function ConsentBanner() {
  const consent = useConsent();
  const locale = useSyncExternalStore(subscribeLocale, readLocale, () => "fr" as const);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (consent !== "unset") return null;
  const text = copy[locale];
  function choose(state: "granted" | "denied") {
    writeConsentCookie(state);
    notifyConsentChanged();
  }
  return (
    <div
      className="consent-banner"
      data-shown={shown ? "true" : "false"}
      role="dialog"
      aria-label={text.label}
      dir={locale === "ar" ? "rtl" : "ltr"}
    >
      <p>{text.text}</p>
      <div className="consent-actions">
        <button type="button" className="consent-refuse" onClick={() => choose("denied")}>{text.refuse}</button>
        <button type="button" className="consent-accept" onClick={() => choose("granted")}>{text.accept}</button>
      </div>
    </div>
  );
}
