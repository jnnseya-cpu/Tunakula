import type { Metadata } from "next";
import { SiteFooter, SiteNav } from "../../../components/site";
import { RiderApply } from "../../../components/rider-apply";

export const metadata: Metadata = { title: "Apply to ride", description: "Ride with Tunakula: apply with your phone, your ID and a selfie. Paid the same day." };

export default function ApplyPage() {
  return (
    <>
      <SiteNav current="/riders/" />
      <main className="app-page narrow-wide"><RiderApply /></main>
      <SiteFooter />
    </>
  );
}
