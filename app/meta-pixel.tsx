"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { marketingAllowed } from "@/lib/meta/consent";
import { useConsent } from "@/lib/meta/use-consent";
import { randomEventId } from "@/lib/meta/events";

/**
 * Loads the Meta Pixel only once marketing consent is granted.
 *
 * The script tag is not rendered at all before consent, so no Meta request is made and no
 * _fbp cookie is written. Revoking consent stops all further events (the already-loaded
 * script cannot be unloaded, so `trackMeta` re-checks consent on every call).
 */
export default function MetaPixel({ pixelId }: { pixelId: string }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const consent = useConsent();
  const allowed = marketingAllowed(consent);

  useEffect(() => {
    if (!ready || !allowed || !window.fbq) return;
    // A unique eventID per PageView keeps client-side navigations from collapsing into one event.
    window.fbq("track", "PageView", {}, { eventID: randomEventId() });
  }, [pathname, ready, allowed]);

  if (!/^\d{5,30}$/.test(pixelId) || !allowed) return null;
  return <Script id="lovelystep-meta-pixel" strategy="afterInteractive" onReady={() => {
    if (!window.fbq) return;
    if (window._lovelyStepMetaPixel !== pixelId) {
      window.fbq("init", pixelId);
      window._lovelyStepMetaPixel = pixelId;
    }
    setReady(true);
  }}>{`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');`}</Script>;
}
