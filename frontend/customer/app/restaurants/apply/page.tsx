import type { Metadata } from "next";
import { SiteFooter, SiteNav } from "../../../components/site";
import { MerchantApply } from "../../../components/merchant-apply";

export const metadata: Metadata = { title: "Open a storefront", description: "Register your restaurant, malewa, bakery or shop on Tunakula — 0% commission, your prices.", robots: { index: false } };

export default function ApplyPage() {
  return (
    <>
      <SiteNav current="/restaurants/" />
      <main className="app-page narrow"><MerchantApply /></main>
      <SiteFooter />
    </>
  );
}
