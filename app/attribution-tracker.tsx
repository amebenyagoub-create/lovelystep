"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { loadAttribution, mergeAttribution, readTouch, saveAttribution } from "@/lib/meta/attribution";
import { marketingAllowed } from "@/lib/meta/consent";
import { useConsent } from "@/lib/meta/use-consent";

function Tracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const consent = useConsent();
  const allowed = marketingAllowed(consent);

  useEffect(() => {
    // No consent, no attribution capture. Nothing is written before "Accept".
    if (!allowed) return;
    const touch = readTouch(window.location.href, document.referrer);
    if (!touch) return;
    saveAttribution(mergeAttribution(loadAttribution(), touch));
  }, [pathname, searchParams, allowed]);

  return null;
}

/**
 * Records where a visitor came from, for store-side attribution.
 * useSearchParams needs a Suspense boundary so it cannot opt whole pages out of prerendering.
 */
export default function AttributionTracker() {
  return <Suspense fallback={null}><Tracker /></Suspense>;
}
