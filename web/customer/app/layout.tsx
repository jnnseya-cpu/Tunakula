import type { Metadata } from "next";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource-variable/inter";
import "./globals.css";

export const SITE_URL = "https://www.tunakula.com";
export const CONTACT_EMAIL = "info@tunakula.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: "/" },
  openGraph: { siteName: "Tunakula", url: SITE_URL, type: "website" },
  title: { default: "Tunakula — the food of Kinshasa, delivered", template: "%s · Tunakula" },
  description:
    "Order from the kitchens you already love, pay with mobile money in francs or dollars, and send a meal home from anywhere. Zero commission for restaurants.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
