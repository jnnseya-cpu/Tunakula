import type { Metadata } from "next";
import "@fontsource/anton/400.css";
import "@fontsource-variable/inter";
import "./globals.css";
import { SITE_URL } from "../lib/site";
import { MERCHANTS } from "../lib/catalogue";
import { LocationProvider } from "../components/location";
import { Reveal } from "../components/motion";


export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: "/" },
  openGraph: { siteName: "Tunakula", url: SITE_URL, type: "website" },
  title: { default: "Tunakula — the food of Kinshasa, delivered", template: "%s · Tunakula" },
  description:
    "Order from the kitchens you already love, pay with mobile money in francs or dollars, and send a meal home from anywhere. Zero commission for restaurants.",
};

const STORES = MERCHANTS.map((m) => ({ slug: m.slug, name: m.name, lat: m.location.lat, lng: m.location.lng, prep: m.prep, hours: m.hours, rating: m.rating }));

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <LocationProvider stores={STORES}>{children}</LocationProvider>
        <Reveal />
      </body>
    </html>
  );
}
