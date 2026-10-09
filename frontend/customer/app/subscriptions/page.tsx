import type { Metadata } from "next";
import { SiteNav } from "../../components/site";
import { Subscriptions } from "../../components/subscriptions";

export const metadata: Metadata = { title: "Repeat orders", robots: { index: false } };

export default function SubscriptionsPage() {
  return (
    <>
      <SiteNav current="/subscriptions/" />
      <main className="app-page"><Subscriptions /></main>
    </>
  );
}
