import type { Metadata } from "next";
import { SiteNav } from "../../components/site";
import { OrderHistory } from "../../components/tracking";

export const metadata: Metadata = { title: "Your orders", robots: { index: false } };

export default function OrdersPage() {
  return (
    <>
      <SiteNav current="/orders/" />
      <main className="app-page"><OrderHistory /></main>
    </>
  );
}
