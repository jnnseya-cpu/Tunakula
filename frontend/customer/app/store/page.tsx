import type { Metadata } from "next";
import { SiteFooter, SiteNav } from "../../components/site";
import { LiveStore } from "../../components/live-store";

export const metadata: Metadata = { title: "Order", robots: { index: false } };

export default function StorePage() {
  return (
    <>
      <SiteNav current="/order/" />
      <LiveStore />
      <SiteFooter />
    </>
  );
}
