import type { Metadata } from "next";
import { SiteNav } from "../../components/site";
import { Tracking } from "../../components/tracking";

export const metadata: Metadata = { title: "Your order", robots: { index: false } };

export default function TrackPage() {
  return (
    <>
      <SiteNav current="/orders/" />
      <main className="app-page"><Tracking /></main>
    </>
  );
}
