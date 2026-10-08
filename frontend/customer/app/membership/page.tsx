import type { Metadata } from "next";
import { SiteNav } from "../../components/site";
import { Membership } from "../../components/membership";

export const metadata: Metadata = { title: "Tunakula Plus", description: "Free delivery and member savings on every order with Tunakula Plus." };

export default function MembershipPage() {
  return (
    <>
      <SiteNav current="/membership/" />
      <main className="app-page"><Membership /></main>
    </>
  );
}
