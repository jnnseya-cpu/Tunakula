import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteNav } from "../../components/site";
import { GroupOrder } from "../../components/group";

export const metadata: Metadata = { title: "Group order", description: "Order together — everyone adds their dishes and the bill splits per person.", robots: { index: false } };

export default function GroupPage() {
  return (
    <>
      <SiteNav current="/group/" />
      <main className="app-page"><Suspense fallback={<div className="skeleton-line" />}><GroupOrder /></Suspense></main>
    </>
  );
}
