import type { Metadata, Viewport } from "next";
import { RiderApp } from "../../components/rider";

export const metadata: Metadata = { title: "Rider", robots: { index: false } };
export const viewport: Viewport = { themeColor: "#1f305d" };

export default function RiderPage() {
  return <RiderApp />;
}
