import type { Metadata } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://lovelystep.store";

export const metadata: Metadata = {
    metadataBase: new URL(siteUrl),
    title: {
      default: "Lovelystep | Little clothes, big adventures",
      template: "%s | Lovelystep",
    },
    description:
      "Joyful, play-ready kids clothes delivered to your door. Order online and pay cash on delivery.",
    keywords: [
      "kids clothes",
      "children's clothing",
      "cash on delivery",
      "playwear",
      "Lovelystep",
    ],
    openGraph: {
      type: "website",
      siteName: "Lovelystep",
      title: "Little clothes. Big adventures.",
      description:
        "Soft, play-ready kidswear. Order in a few taps and pay only when it arrives.",
      images: [{ url: "/og.png", width: 1732, height: 909, alt: "Lovelystep — Little clothes. Big adventures." }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Lovelystep — Little clothes. Big adventures.",
      description: "Joyful kidswear with cash on delivery.",
      images: ["/og.png"],
    },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
