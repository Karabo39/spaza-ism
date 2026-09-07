import * as React from "react";
import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { Providers } from "@/components/providers";
import { BRAND_NAME, BRAND_DESCRIPTION, BRAND_URL } from "@/lib/brand";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(BRAND_URL),
  title: BRAND_NAME,
  description: BRAND_DESCRIPTION,
  manifest: "/manifest.webmanifest",
  applicationName: BRAND_NAME,
  appleWebApp: { capable: true, title: BRAND_NAME, statusBarStyle: "black-translucent" },
  openGraph: {
    type: "website",
    title: BRAND_NAME,
    siteName: BRAND_NAME,
    description: BRAND_DESCRIPTION,
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630, alt: BRAND_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    title: BRAND_NAME,
    description: BRAND_DESCRIPTION,
    images: [{ url: "/brand/twitter-card.png", alt: BRAND_NAME }],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a1120",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
