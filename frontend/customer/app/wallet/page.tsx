import type { Metadata } from "next";
import { SiteNav } from "../../components/site";
import { Wallet } from "../../components/wallet";

export const metadata: Metadata = { title: "Your wallet", robots: { index: false } };

export default function WalletPage() {
  return (
    <>
      <SiteNav current="/wallet/" />
      <main className="app-page"><Wallet /></main>
    </>
  );
}
