"use client";
/**
 * Book a table (dine-in reservation) at a restaurant, for a party of one or more people.
 * A small inline panel on the store page: pick a day, a time, how many people, and leave a note.
 * The restaurant confirms it; the customer tracks and cancels bookings on /bookings.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { bookTable, cancelBooking, getSession, myBookings, type Booking, type BookingStatus } from "../lib/api";

/** The next half-hour slots from `start`, as [value, label] for the chosen day. */
function slots(day: string): [string, string][] {
  const out: [string, string][] = [];
  const base = new Date(`${day}T00:00:00`);
  const now = Date.now();
  for (let m = 11 * 60; m <= 22 * 60; m += 30) {
    const d = new Date(base.getTime() + m * 60_000);
    if (d.getTime() < now + 30 * 60_000) continue;
    out.push([d.toISOString(), d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })]);
  }
  return out;
}
const today = () => new Date().toISOString().slice(0, 10);

export function BookTable({ branchId, branchName }: { branchId: string; branchName: string }) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(today());
  const [at, setAt] = useState("");
  const [party, setParty] = useState(2);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ status: BookingStatus } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const times = slots(day);

  const submit = async () => {
    if (!getSession()) { setError("Sign in to book a table."); return; }
    const when = at || times[0]?.[0];
    if (!when) { setError("Pick a time."); return; }
    setBusy(true); setError(null);
    try {
      const r = await bookTable({ branch_id: branchId, party_size: party, at: when, ...(note.trim() ? { note: note.trim() } : {}) });
      setDone({ status: r.status });
    } catch (e) {
      setError((e as { message?: string }).message ?? "Could not book the table.");
    } finally { setBusy(false); }
  };

  if (!open) return <button type="button" className="group-cta book-cta" onClick={() => setOpen(true)}>🍽️ Book a table at {branchName}</button>;

  if (done) {
    return (
      <div className="book-panel">
        <p className="book-ok">✓ Requested for {party} {party > 1 ? "people" : "person"}. The restaurant will confirm shortly.</p>
        <Link className="btn ghost" href="/bookings/">See my bookings</Link>
      </div>
    );
  }

  return (
    <div className="book-panel">
      <div className="book-head"><b>Book a table</b><button type="button" className="x" aria-label="Close" onClick={() => setOpen(false)}>×</button></div>
      <div className="book-grid">
        <label className="field"><span>Day</span><input type="date" min={today()} value={day} onChange={(e) => { setDay(e.target.value); setAt(""); }} /></label>
        <label className="field"><span>Time</span>
          <select value={at || times[0]?.[0] || ""} onChange={(e) => setAt(e.target.value)}>
            {times.length ? times.map(([v, l]) => <option key={v} value={v}>{l}</option>) : <option value="">No times left today</option>}
          </select>
        </label>
        <label className="field"><span>People</span>
          <div className="party">
            <button type="button" onClick={() => setParty((p) => Math.max(1, p - 1))} aria-label="Fewer people">−</button>
            <b>{party}</b>
            <button type="button" onClick={() => setParty((p) => Math.min(50, p + 1))} aria-label="More people">+</button>
          </div>
        </label>
      </div>
      <label className="field"><span>Note (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="High chair, window seat, birthday…" maxLength={500} /></label>
      {error ? <p className="book-error" role="alert">{error}</p> : null}
      <button type="button" className="btn accent wide" disabled={busy || !times.length} onClick={submit}>{busy ? "Booking…" : `Request a table for ${party}`}</button>
    </div>
  );
}

const STATUS_LABEL: Record<BookingStatus, string> = {
  REQUESTED: "Awaiting confirmation", CONFIRMED: "Confirmed", SEATED: "Seated",
  COMPLETED: "Completed", CANCELLED: "Cancelled", NO_SHOW: "No-show",
};
const CANCELLABLE: BookingStatus[] = ["REQUESTED", "CONFIRMED"];

/** The customer's own table bookings, newest first, with a cancel button while still ahead of them. */
export function MyBookings() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => myBookings().then(setBookings).catch((e) => setError((e as { message?: string }).message ?? "Could not load your bookings."));
  useEffect(() => { if (!getSession()) { setError("Sign in to see your bookings."); return; } load(); }, []);

  const cancel = async (id: string) => {
    setBusy(id);
    try { await cancelBooking(id); await load(); } catch (e) { setError((e as { message?: string }).message ?? "Could not cancel."); } finally { setBusy(null); }
  };

  if (error) return <div className="app-wrap"><p className="book-error">{error}</p><Link className="btn" href="/signin/">Sign in</Link></div>;
  if (!bookings) return <div className="app-wrap"><p>Loading…</p></div>;
  if (!bookings.length) return <div className="app-wrap"><h1>Your table bookings</h1><p className="muted">No bookings yet. Open a restaurant and tap “Book a table”.</p><Link className="btn accent" href="/restaurants/">Find a restaurant</Link></div>;

  return (
    <div className="app-wrap">
      <h1>Your table bookings</h1>
      <ul className="booking-list">
        {bookings.map((b) => {
          const when = new Date(b.seating_at);
          return (
            <li key={b.id} className={`booking-card s-${b.status.toLowerCase()}`}>
              <div className="booking-main">
                <b>{b.branch?.name ?? "Restaurant"}</b>
                <span className="muted">{when.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} · {when.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · {b.party_size} {b.party_size > 1 ? "people" : "person"}</span>
              </div>
              <span className={`booking-status s-${b.status.toLowerCase()}`}>{STATUS_LABEL[b.status]}</span>
              {CANCELLABLE.includes(b.status) ? <button type="button" className="btn ghost small" disabled={busy === b.id} onClick={() => cancel(b.id)}>Cancel</button> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
