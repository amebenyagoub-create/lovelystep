"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { marketingAllowed } from "@/lib/meta/consent";
import { useConsent } from "@/lib/meta/use-consent";
import { randomEventId } from "@/lib/meta/events";
import { flushPendingMetaEvents } from "@/lib/meta-pixel";

type MetaQueue = NonNullable<Window["fbq"]> & {
  callMethod?: (...args: unknown[]) => void;
  loaded: boolean;
  push: (...args: unknown[]) => void;
  queue: unknown[][];
  version: string;
};

function installMetaPixel() {
  if (window.fbq) return;

  const fbq = ((...args: unknown[]) => {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue.push(args);
  }) as MetaQueue;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.queue = [];
  window.fbq = fbq;
  (window as Window & { _fbq?: MetaQueue })._fbq = fbq;

  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(script);
}

/**
 * Loads the Meta Pixel only once marketing consent is granted.
 *
 * The script tag is not rendered at all before consent, so no Meta request is made and no
 * _fbp cookie is written. Revoking consent stops all further events (the already-loaded
 * script cannot be unloaded, so `trackMeta` re-checks consent on every call).
 */
export default function MetaPixel({ pixelId }: { pixelId: string }) {
  const pathname = usePathname();
  const consent = useConsent();
  const allowed = marketingAllowed(consent);

  useEffect(() => {
    if (!/^\d{5,30}$/.test(pixelId) || !allowed) return;
    installMetaPixel();
    if (window._lovelyStepMetaPixel !== pixelId) {
      window.fbq!("init", pixelId);
      window._lovelyStepMetaPixel = pixelId;
    }
    // A unique eventID per PageView keeps client-side navigations from collapsing into one event.
    window.fbq!("track", "PageView", {}, { eventID: randomEventId() });
    flushPendingMetaEvents();
  }, [pathname, pixelId, allowed]);

  return null;
}
