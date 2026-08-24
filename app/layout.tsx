import type { Metadata } from "next";
// Latin subsets only. The full files declare five subsets each (cyrillic, greek,
// vietnamese and two latin ranges) — twenty @font-face rules of render-blocking
// CSS for ranges this store never renders. Arabic is unaffected: neither Fredoka
// nor Nunito ships an Arabic subset, so Arabic already falls back to the system
// font either way.
import "@fontsource/fredoka/latin-600.css";
import "@fontsource/nunito/latin-400.css";
import "@fontsource/nunito/latin-700.css";
import "@fontsource/nunito/latin-800.css";
import "./globals.css";
import "./admin-extra.css";
// Tracking lives in app/store-tracking.tsx, mounted by the public store pages only.
// It must not be mounted here: the root layout wraps prerendered routes, so any database
// read in it runs during `next build`.

import { siteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl() || "http://localhost:3000"),
  verification: {
    other: {
      "facebook-domain-verification": "kpaqmnfezw4yiq07hpy3fuyx4q2207",
    },
  },
  title: { default: "Lovely Step | Vêtements enfants", template: "%s | Lovely Step" },
  description: "Des vêtements doux pour enfants, commandés en quelques clics et payés à la livraison.",
  keywords: ["vêtements enfants", "mode enfant", "paiement à la livraison", "Lovely Step"],
  icons: {
    icon: [{ url: "/favicon.png", type: "image/png", sizes: "512x512" }],
    apple: [{ url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
  },
  openGraph: { type: "website", siteName: "Lovely Step", title: "Tiny Steps, Big Love", description: "Vêtements enfants doux et pratiques avec paiement à la livraison.", images: [{ url: "/og.png", width: 1200, height: 630, alt: "Lovely Step" }] },
  twitter: { card: "summary_large_image", title: "Lovely Step — Tiny Steps, Big Love", description: "Vêtements enfants avec paiement à la livraison.", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body>{children}</body></html>;
}
