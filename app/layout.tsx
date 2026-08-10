import type { Metadata } from "next";
import "@fontsource/fredoka/600.css";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "./globals.css";
import "./admin-extra.css";
import MetaPixel from "./meta-pixel";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  verification: {
    other: {
      "facebook-domain-verification": "kpaqmnfezw4yiq07hpy3fuyx4q2207",
    },
  },
  title: { default: "Lovely Step | Vêtements enfants", template: "%s | Lovely Step" },
  description: "Des vêtements doux pour enfants, commandés en quelques clics et payés à la livraison.",
  keywords: ["vêtements enfants", "mode enfant", "paiement à la livraison", "Lovely Step"],
  openGraph: { type: "website", siteName: "Lovely Step", title: "Tiny Steps, Big Love", description: "Vêtements enfants doux et pratiques avec paiement à la livraison.", images: [{ url: "/og.png", width: 1732, height: 909, alt: "Lovely Step" }] },
  twitter: { card: "summary_large_image", title: "Lovely Step — Tiny Steps, Big Love", description: "Vêtements enfants avec paiement à la livraison.", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? "";
  return <html lang="fr"><body>{children}<MetaPixel pixelId={pixelId} /></body></html>;
}
