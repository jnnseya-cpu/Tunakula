import type { Metadata } from "next";
import { SiteNav } from "../../components/site";
import { OrderHistory } from "../../components/tracking";
import { PushToggle } from "../../components/push-toggle";

export const metadata: Metadata = { title: "Your orders", robots: { index: false } };

export default function OrdersPage() {
  return (
    <>
      <SiteNav current="/orders/" />
      <main className="app-page"><PushToggle /><OrderHistory /></main>
    </>
  );
}
