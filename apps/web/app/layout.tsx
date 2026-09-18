import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SITE } from "../components/Shell";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "Holder Atlas — where a token's holders actually are",
  description:
    "Type a token. One world map of the countries its holders reach exchanges from, inferred from Nansen exchange entity labels, with the honest % of supply the map covers.",
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Holder Atlas",
    title: "Holder Atlas",
    description: "Type a token. See where its holders actually are — and how much of the supply the map can honestly place.",
    images: [
      {
        url: "/api/og?q=PEPE&chain=ethereum&v=1",
        width: 1200,
        height: 675,
        alt: "Holder Atlas poster for PEPE: 40% of analysed supply placed on a country — US, KR, GB, TR, NL — with global exchanges and untraced wallets in grey",
      },
    ],
  },
  twitter: { card: "summary_large_image", creator: "@edycutjong", title: "Holder Atlas", description: "Type a token. See where its holders actually are." },
  authors: [{ name: "Edy Cu Tjong", url: "https://github.com/edycutjong" }],
  creator: "Edy Cu Tjong",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: "#0a0e13", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
