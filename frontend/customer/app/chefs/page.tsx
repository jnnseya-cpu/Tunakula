import type { Metadata } from "next";
import { SiteFooter, SiteNav } from "../../components/site";
import { Chefs } from "../../components/chefs";

export const metadata: Metadata = { title: "Book a chef in Kinshasa", description: "Hire a private chef for a dinner at home, meal prep, an event, a class — or a quick cooking consultation. Kinshasa chefs, booked by the date." };

export default function ChefsPage() {
  return (
    <>
      <SiteNav current="/chefs/" />
      <main className="app-page"><Chefs /></main>
      <SiteFooter />
    </>
  );
}
