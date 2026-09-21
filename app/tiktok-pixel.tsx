"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { marketingAllowed } from "@/lib/meta/consent";
import { useConsent } from "@/lib/meta/use-consent";
import { flushPendingTikTokEvents, type TikTokQueue } from "@/lib/tiktok-pixel";

const METHODS = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie", "holdConsent", "revokeConsent", "grantConsent"];

function installTikTokPixel(pixelId: string) {
  window.TiktokAnalyticsObject = "ttq";
  const queue = window.ttq ?? ([] as unknown as TikTokQueue);
  window.ttq = queue;

  if (!queue.methods) {
    queue.methods = METHODS;
    queue.setAndDefer = (target, method) => {
      (target as unknown as Record<string, (...args: unknown[]) => void>)[method] = (...args: unknown[]) => {
        target.push([method, ...args]);
      };
    };
    for (const method of METHODS) queue.setAndDefer(queue, method);
    queue.instance = (id) => {
      const instance = queue._i?.[id] ?? ([] as unknown as TikTokQueue);
      for (const method of METHODS) queue.setAndDefer?.(instance, method);
      return instance;
    };
  }

  queue.load = (id, options = {}) => {
    if (queue._i?.[id]) return;
    const source = "https://analytics.tiktok.com/i18n/pixel/events.js";
    queue._i ??= {};
    queue._i[id] = [] as unknown as TikTokQueue & { _u?: string };
    queue._i[id]._u = source;
    queue._t ??= {};
    queue._t[id] = Date.now();
    queue._o ??= {};
    queue._o[id] = options;
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.async = true;
    script.src = `${source}?sdkid=${encodeURIComponent(id)}&lib=ttq`;
    const firstScript = document.getElementsByTagName("script")[0];
    if (firstScript?.parentNode) firstScript.parentNode.insertBefore(script, firstScript);
    else document.head.appendChild(script);
  };

  if (!queue._i?.[pixelId]) queue.load(pixelId);
}

export default function TikTokPixel({ pixelId }: { pixelId: string }) {
  const pathname = usePathname();
  const allowed = marketingAllowed(useConsent());

  useEffect(() => {
    if (!/^[A-Z0-9]{10,40}$/i.test(pixelId) || !allowed) return;
    installTikTokPixel(pixelId);
    window._lovelyStepTikTokPixel = pixelId;
    window.ttq?.page();
    flushPendingTikTokEvents();
  }, [pathname, pixelId, allowed]);

  return null;
}
