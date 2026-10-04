import type { Metadata } from "next";
import { SiteNav } from "../../components/site";
import { Checkout } from "../../components/checkout";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default function CheckoutPage() {
  return (
    <>
      <SiteNav current="/checkout/" />
      <main className="app-page"><Checkout /></main>
    </>
  );
}
