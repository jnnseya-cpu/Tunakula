"use client";
/**
 * Book a chef — the customer side of the private-chef marketplace. Browse approved chefs and what they offer
 * (advice/consultations and in-person engagements), see a live quote (the chef's fee + the 10% service charge),
 * and request a booking for a date. The chef keeps 100% of their fee; the platform is funded by the service
 * charge on top, the same principle as every order. A cook can also offer their own cooking from here.
 */
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, getSession, money, type MoneyWire } from "../lib/api";

interface Service { id: string; kind: string; title: string; description: string; pricing_model: "FIXED" | "PER_HEAD" | "HOURLY"; rate: MoneyWire; min_guests: number; max_guests: number | null; remote: boolean }
interface Chef { id: string; display_name: string; bio: string; cuisines: string[]; communes: string[]; services: Service[] }
interface Quote { fee: MoneyWire; service_charge: MoneyWire; total: MoneyWire }
interface Booking { id: string; status: string; scheduled_for: string; party_size: number; total: MoneyWire; decline_reason?: string }

const KIND_LABEL: Record<string, string> = { ADVICE: "Advice", PRIVATE_DINING: "Private dining", MEAL_PREP: "Meal prep", EVENT: "Event", CLASS: "Class" };
const priceLabel = (s: Service) => `${money(s.rate)}${s.pricing_model === "PER_HEAD" ? " / guest" : s.pricing_model === "HOURLY" ? " / hour" : ""}`;
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export function Chefs() {
  const [chefs, setChefs] = useState<Chef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<{ chef: Chef; service: Service } | null>(null);
  const [tab, setTab] = useState<"browse" | "mine">("browse");

  useEffect(() => { api<{ chefs: Chef[] }>("/v1/chefs", { auth: false }).then((r) => setChefs(r.chefs)).catch((e: Error) => setError(e.message)); }, []);

  return (
    <div className="chefs">
      <section className="chefs-hero">
        <p className="eyebrow"><b>Kinshasa</b> · private chefs</p>
        <h1 className="display">Book a chef</h1>
        <p className="lede">A chef at your table for a dinner, meal prep for the week, an event, a class — or a quick consultation. You pay the chef’s price plus a 10% service charge; the chef keeps every franc of their fee.</p>
        <div className="chefs-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "browse"} className={tab === "browse" ? "on" : ""} onClick={() => setTab("browse")}>Browse chefs</button>
          <button type="button" role="tab" aria-selected={tab === "mine"} className={tab === "mine" ? "on" : ""} onClick={() => setTab("mine")}>My bookings</button>
          <a className="chefs-offer" href="#offer">Offer your cooking →</a>
        </div>
      </section>

      {error ? <p className="form-error">{error}</p> : null}

      {tab === "browse" ? (
        !chefs ? <p className="muted">Loading chefs…</p>
        : chefs.length === 0 ? <p className="muted">No chefs yet in your market. Check back soon — or offer your own cooking below.</p>
        : <div className="chef-grid">{chefs.map((c) => <ChefCard key={c.id} chef={c} onBook={(service) => setBooking({ chef: c, service })} />)}</div>
      ) : <MyBookings />}

      <OfferCta />

      {booking ? <BookingModal chef={booking.chef} service={booking.service} onClose={() => setBooking(null)} /> : null}
    </div>
  );
}

function ChefCard({ chef, onBook }: { chef: Chef; onBook: (s: Service) => void }) {
  const initials = chef.display_name.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase();
  return (
    <article className="chef-card" data-reveal>
      <header className="chef-head">
        <span className="chef-avatar" aria-hidden>{initials}</span>
        <div><h3>{chef.display_name}</h3><p className="muted small">{chef.cuisines.join(" · ") || "Chef"}{chef.communes.length ? ` · ${chef.communes.join(", ")}` : ""}</p></div>
      </header>
      {chef.bio ? <p className="chef-bio">{chef.bio}</p> : null}
      <ul className="chef-services">
        {chef.services.map((s) => (
          <li key={s.id}>
            <div className="chef-svc-main">
              <span className="chef-svc-kind">{KIND_LABEL[s.kind] ?? s.kind}{s.remote ? " · remote" : ""}</span>
              <b>{s.title}</b>
              {s.description ? <span className="muted small">{s.description}</span> : null}
            </div>
            <div className="chef-svc-price"><b>{priceLabel(s)}</b><button type="button" className="btn accent sm" onClick={() => onBook(s)}>{s.kind === "ADVICE" ? "Get advice" : "Book"}</button></div>
          </li>
        ))}
      </ul>
    </article>
  );
}

function BookingModal({ chef, service, onClose }: { chef: Chef; service: Service; onClose: () => void }) {
  const perHead = service.pricing_model === "PER_HEAD";
  const hourly = service.pricing_model === "HOURLY";
  const [party, setParty] = useState(Math.max(service.min_guests, perHead ? 2 : 1));
  const [hours, setHours] = useState(2);
  const [when, setWhen] = useState(localInput(new Date(Date.now() + 2 * 86400000)));
  const [place, setPlace] = useState("");
  const [note, setNote] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reQuote = useCallback(() => {
    api<Quote>("/v1/chefs/quote", { method: "POST", auth: false, body: { service_id: service.id, party_size: party, hours } }).then(setQuote).catch(() => setQuote(null));
  }, [service.id, party, hours]);
  useEffect(() => { reQuote(); }, [reQuote]);

  const submit = async () => {
    if (!getSession()) { window.location.href = `/signin/?next=/chefs/`; return; }
    setBusy(true); setError(null);
    try {
      await api("/v1/chef-bookings", { method: "POST", body: { service_id: service.id, scheduled_for: new Date(when).toISOString(), party_size: party, hours, ...(place.trim() ? { location_label: place.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) } });
      setDone(true);
    } catch (e) { setError(e instanceof ApiError ? e.message : (e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="app-card chef-modal" role="dialog" aria-modal="true" aria-label={`Book ${chef.display_name}`} onClick={(e) => e.stopPropagation()}>
        {done ? (
          <div className="chef-done">
            <div className="chef-tick" aria-hidden>✓</div>
            <h2 className="app-title">Request sent to {chef.display_name}</h2>
            <p className="muted">They’ll confirm your booking shortly. You’ll see it under “My bookings”, and you pay once the chef confirms.</p>
            <button type="button" className="btn accent wide" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <h2 className="app-title">{service.kind === "ADVICE" ? "Request advice from" : "Book"} {chef.display_name}</h2>
            <p className="muted small">{KIND_LABEL[service.kind] ?? service.kind} · {service.title}</p>
            <div className="chef-form">
              <label className="field"><span>When</span><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
              {perHead ? <label className="field"><span>Guests</span><input type="number" min={service.min_guests} max={service.max_guests ?? 99} value={party} onChange={(e) => setParty(Math.max(service.min_guests, Number(e.target.value) || service.min_guests))} /></label> : null}
              {hourly ? <label className="field"><span>Hours</span><input type="number" min={1} max={24} value={hours} onChange={(e) => setHours(Math.max(1, Number(e.target.value) || 1))} /></label> : null}
              {!service.remote ? <label className="field"><span>Where</span><input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Your address or venue" /></label> : null}
              <label className="field"><span>Anything the chef should know? (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Allergies, occasion, dishes you’d love…" /></label>
            </div>
            {quote ? (
              <dl className="chef-quote">
                <div><dt>Chef’s fee</dt><dd>{money(quote.fee)}</dd></div>
                <div><dt>Service charge (10%)</dt><dd>{money(quote.service_charge)}</dd></div>
                <div className="chef-quote-total"><dt>You pay</dt><dd>{money(quote.total)}</dd></div>
              </dl>
            ) : null}
            {error ? <p className="form-error">{error}</p> : null}
            <button type="button" className="btn accent wide" disabled={busy} onClick={submit}>{busy ? "Sending…" : quote ? `Request · ${money(quote.total)}` : "Request booking"}</button>
          </>
        )}
      </div>
    </div>
  );
}

function MyBookings() {
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!getSession()) { setRows([]); return; }
    api<{ bookings: Booking[] }>("/v1/me/chef-bookings").then((r) => setRows(r.bookings)).catch((e: Error) => setError(e.message));
  }, []);
  if (!getSession()) return <p className="muted">Sign in to see your chef bookings.</p>;
  if (error) return <p className="form-error">{error}</p>;
  if (!rows) return <p className="muted">Loading…</p>;
  if (rows.length === 0) return <p className="muted">No chef bookings yet.</p>;
  const cancel = async (id: string) => { try { await api(`/v1/chef-bookings/${id}/cancel`, { method: "POST" }); setRows((rs) => rs?.map((b) => (b.id === id ? { ...b, status: "CANCELLED" } : b)) ?? null); } catch { /* ignore */ } };
  return (
    <ul className="chef-bookings">
      {rows.map((b) => (
        <li key={b.id} className="app-card">
          <div><b className={`chef-status s-${b.status.toLowerCase()}`}>{b.status.toLowerCase()}</b><span className="muted small"> · {new Date(b.scheduled_for).toLocaleString()} · {b.party_size} guest(s)</span>{b.decline_reason ? <p className="muted small">“{b.decline_reason}”</p> : null}</div>
          <div className="chef-booking-right"><b>{money(b.total)}</b>{b.status === "REQUESTED" || b.status === "CONFIRMED" ? <button type="button" className="link-btn" onClick={() => cancel(b.id)}>Cancel</button> : null}</div>
        </li>
      ))}
    </ul>
  );
}

function OfferCta() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [cuisines, setCuisines] = useState("");
  const [communes, setCommunes] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const apply = async () => {
    if (!getSession()) { window.location.href = `/signin/?next=/chefs/`; return; }
    setBusy(true); setMsg(null);
    try {
      await api("/v1/chef/apply", { method: "POST", body: { display_name: name.trim(), bio: bio.trim(), cuisines: cuisines.split(",").map((s) => s.trim()).filter(Boolean), communes: communes.split(",").map((s) => s.trim()).filter(Boolean) } });
      setMsg("Thanks! Your chef profile is in review. We’ll let you know when it’s live, then you can add your services.");
    } catch (e) { setMsg(e instanceof ApiError ? e.message : (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="chef-offer app-card" id="offer">
      <div className="chef-offer-text"><h2 className="app-title">Cook for Kinshasa</h2><p className="muted">Offer private dining, meal prep, events, classes or advice. You set your prices and keep 100% of your fee — we just add the service charge the customer pays.</p></div>
      {!open ? <button type="button" className="btn accent" onClick={() => setOpen(true)}>Offer your cooking</button> : (
        <div className="chef-form">
          <label className="field"><span>Your chef name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Chef Maman Nadège" /></label>
          <label className="field"><span>About you</span><input value={bio} onChange={(e) => setBio(e.target.value)} placeholder="20 years cooking Congolese classics…" /></label>
          <label className="field"><span>Cuisines (comma-separated)</span><input value={cuisines} onChange={(e) => setCuisines(e.target.value)} placeholder="Congolese, Grill, Pastry" /></label>
          <label className="field"><span>Communes you serve</span><input value={communes} onChange={(e) => setCommunes(e.target.value)} placeholder="Gombe, Limete, Ngaliema" /></label>
          {msg ? <p className="form-notice">{msg}</p> : null}
          <button type="button" className="btn accent wide" disabled={busy || !name.trim()} onClick={apply}>{busy ? "Sending…" : "Apply to cook"}</button>
        </div>
      )}
    </section>
  );
}
