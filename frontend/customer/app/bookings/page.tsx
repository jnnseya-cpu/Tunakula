import type { Metadata } from "next";
import { SiteNav } from "../../components/site";
import { MyBookings } from "../../components/book-table";

export const metadata: Metadata = { title: "Your table bookings", robots: { index: false } };

export default function BookingsPage() {
  return (
    <>
      <SiteNav current="/bookings/" />
      <main className="app-page"><MyBookings /></main>
    </>
  );
}
