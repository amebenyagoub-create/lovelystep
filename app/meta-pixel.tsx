"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { marketingAllowed, readConsentCookie } from "@/lib/meta/consent";
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

const META_SCRIPT_URL = "https://connect.facebook.net/en_US/fbevents.js";

function installMetaQueue() {
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
}

function deferMetaScript() {
  const shouldLoad = () => marketingAllowed(readConsentCookie())
    && !(window.fbq as MetaQueue | undefined)?.callMethod
    && !document.querySelector(`script[src="${META_SCRIPT_URL}"]`);
  if (!shouldLoad()) return;

  let cancelIdle: (() => void) | undefined;

  function loadScript() {
    cleanup();
    if (!shouldLoad()) return;
    const script = document.createElement("script");
    script.async = true;
    script.src = META_SCRIPT_URL;
    document.head.appendChild(script);
  }

  function afterLoad() {
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(loadScript, { timeout: 1000 });
      cancelIdle = () => window.cancelIdleCallback(id);
    } else {
      const id = window.setTimeout(loadScript, 0);
      cancelIdle = () => window.clearTimeout(id);
    }
  }

  function cleanup() {
    window.removeEventListener("load", afterLoad);
    window.removeEventListener("pointerdown", loadScript);
    window.removeEventListener("keydown", loadScript);
    cancelIdle?.();
  }

  window.addEventListener("pointerdown", loadScript, { once: true, passive: true });
  window.addEventListener("keydown", loadScript, { once: true });
  if (document.readyState === "complete") afterLoad();
  else window.addEventListener("load", afterLoad, { once: true });
  return cleanup;
}

export default function MetaPixel({ pixelId }: { pixelId: string }) {
  const pathname = usePathname();
  const consent = useConsent();
  const allowed = marketingAllowed(consent);

  useEffect(() => {
    if (!/^\d{5,30}$/.test(pixelId) || !allowed || !marketingAllowed(readConsentCookie())) return;
    // Queue events immediately so browser and CAPI events keep their original IDs and order.
    installMetaQueue();
    if (window._lovelyStepMetaPixel !== pixelId) {
      window.fbq!("init", pixelId);
      window._lovelyStepMetaPixel = pixelId;
    }
    // A unique eventID per PageView keeps client-side navigations from collapsing into one event.
    window.fbq!("track", "PageView", {}, { eventID: randomEventId() });
    flushPendingMetaEvents();
    return deferMetaScript();
  }, [pathname, pixelId, allowed]);

  return null;
}
