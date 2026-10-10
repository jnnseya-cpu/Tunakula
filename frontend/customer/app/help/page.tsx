import type { Metadata } from "next";
import { SiteFooter, SiteNav } from "../../components/site";
import { Assistant } from "../../components/assistant";

export const metadata: Metadata = { title: "Help — Tunakula assistant", description: "Get help instantly from the Tunakula assistant: track an order, understand a charge, sort out a problem — grounded in your orders and our policies, with a specialist a step away.", alternates: { canonical: "/help/" } };

export default function HelpPage() {
  return (
    <>
      <SiteNav current="/help/" />
      <section className="tight" style={{ paddingBottom: 48 }}>
        <div className="wrap asst-wrap">
          <Assistant />
        </div>
      </section>
      <SiteFooter />
    </>
  );
}
