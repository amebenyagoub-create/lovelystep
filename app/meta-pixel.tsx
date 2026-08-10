"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export default function MetaPixel({ pixelId }: { pixelId: string }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready && window.fbq) window.fbq("track", "PageView");
  }, [pathname, ready]);

  if (!/^\d{5,30}$/.test(pixelId)) return null;
  return <Script id="lovelystep-meta-pixel" strategy="afterInteractive" onReady={() => {
    if (!window.fbq) return;
    if (window._lovelyStepMetaPixel !== pixelId) {
      window.fbq("init", pixelId);
      window._lovelyStepMetaPixel = pixelId;
    }
    setReady(true);
  }}>{`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');`}</Script>;
}
