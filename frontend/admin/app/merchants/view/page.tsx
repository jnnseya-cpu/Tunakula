"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../../components/shell";
import { api, type Money } from "../../../lib/api";
import { money } from "../../../lib/format";
import { BusinessProfile } from "../../../components/branch-profile";

interface Item { id: string; names: Record<string, string>; prices: Record<string, Money>; tags: string[]; allergens: string[]; available: boolean }
interface Menu { branch: { id: string; name: string; commune: string | null; status: string }; items: Item[] }

export default function MerchantPage() {
  return <Shell title="merchants"><Gate cap="catalogue"><Suspense><MerchantMenu /></Suspense></Gate></Shell>;
}

function MerchantMenu() {
  const id = useSearchParams().get("id") ?? "";
  const { country, lang } = useConsole();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);

  const load = () => api<Menu>(`/v1/branches/${id}/menu`, { country }).then((m) => { setMenu(m); setError(null); }).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [id, country]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (item: Item) => {
    try {
      await api(`/v1/branches/${id}/items/${item.id}/availability`, { method: "POST", country, body: { available: !item.available } });
      void load();
    } catch (e) { setNotice((e as Error).message); }
  };
  if (error) return <div className="banner error">{error}</div>;
  if (!menu) return <div className="muted">…</div>;
  return (
    <>
      <p><Link className="link-btn" href="/merchants/">← {L("Restaurants et commerces", "Merchants")}</Link></p>
      <BusinessProfile branchId={id} country={country} lang={lang} L={L} />
      <section className="card">
        <div className="card-head">
          <div><h2>{menu.branch.name}</h2><p>{menu.branch.commune ?? ""} · {menu.items.length} {L("articles", "items")}</p></div>
          <Link className="btn primary" href={`/menu/?branch=${id}`}>{L("Gérer la carte", "Manage menu")}</Link>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{L("Article", "Item")}</th><th className="num">USD</th><th className="num">CDF</th><th>{L("Allergènes", "Allergens")}</th><th>{L("Disponible", "Available")}</th></tr></thead>
            <tbody>
              {menu.items.map((i) => (
                <tr key={i.id}>
                  <td><b>{i.names[lang] ?? i.names["fr"] ?? Object.values(i.names)[0]}</b>{i.names["en"] && lang === "fr" ? <span className="muted"> · {i.names["en"]}</span> : null}</td>
                  <td className="num">{i.prices["USD"] ? money(lang, i.prices["USD"].amount_minor, "USD") : "—"}</td>
                  <td className="num">{i.prices["CDF"] ? money(lang, i.prices["CDF"].amount_minor, "CDF") : "—"}</td>
                  <td>{i.allergens.join(", ") || <span className="muted">—</span>}</td>
                  <td><button className={`btn ${i.available ? "ghost" : "danger"}`} type="button" onClick={() => toggle(i)} aria-pressed={i.available}>{i.available ? L("Oui", "Yes") : L("Épuisé", "Sold out")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {notice ? <div className="banner" style={{ marginBottom: 12 }}>{notice}</div> : null}
      <Hours branchId={id} country={country} L={L} />
      <Reservations branchId={id} country={country} lang={lang} L={L} />
      <Reviews branchId={id} country={country} lang={lang} L={L} />
    </>
  );
}

type Booking = { id: string; status: string; party_size: number; seating_at: string; duration_min: number; customer: string; contact_phone: string | null; note: string | null };
const BOOKING_ACTIONS: Record<string, [string, string, string][]> = {
  REQUESTED: [["CONFIRMED", "Confirmer", "Confirm"], ["CANCELLED", "Refuser", "Decline"]],
  CONFIRMED: [["SEATED", "Installé", "Seated"], ["NO_SHOW", "Absent", "No-show"], ["CANCELLED", "Annuler", "Cancel"]],
  SEATED: [["COMPLETED", "Terminé", "Completed"]],
};
const BOOKING_STATUS: Record<string, [string, string]> = {
  REQUESTED: ["À confirmer", "To confirm"], CONFIRMED: ["Confirmé", "Confirmed"], SEATED: ["Installé", "Seated"],
  COMPLETED: ["Terminé", "Completed"], CANCELLED: ["Annulé", "Cancelled"], NO_SHOW: ["Absent", "No-show"],
};

function Reservations({ branchId, country, lang, L }: { branchId: string; country: string; lang: "fr" | "en"; L: (fr: string, en: string) => string }) {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => api<{ bookings: Booking[] }>(`/v1/admin/branches/${branchId}/reservations`, { country }).then((r) => setBookings(r.bookings)).catch(() => setBookings([]));
  useEffect(() => { load(); }, [branchId, country]);

  const move = async (id: string, status: string) => {
    setBusy(id);
    try { await api(`/v1/admin/reservations/${id}/status`, { method: "POST", country, body: { status } }); await load(); }
    catch (e) { setNotice((e as Error).message); } finally { setBusy(null); }
  };

  const upcoming = (bookings ?? []).filter((b) => !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(b.status));
  const past = (bookings ?? []).filter((b) => ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(b.status));

  return (
    <section className="card">
      <div className="card-head"><div><h2>{L("Réservations de table", "Table bookings")}</h2><p>{L("Les clients réservent une table pour une ou plusieurs personnes ; confirmez, installez ou refusez.", "Customers book a table for one or more people; confirm, seat or decline.")}</p></div></div>
      {notice ? <div className="banner" style={{ marginBottom: 10 }}>{notice}</div> : null}
      {bookings === null ? <p className="muted">{L("Chargement…", "Loading…")}</p> : !bookings.length ? <p className="muted">{L("Aucune réservation.", "No bookings yet.")}</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{L("Quand", "When")}</th><th>{L("Personnes", "People")}</th><th>{L("Client", "Customer")}</th><th>{L("Note", "Note")}</th><th>{L("Statut", "Status")}</th><th></th></tr></thead>
            <tbody>
              {[...upcoming, ...past].map((b) => {
                const when = new Date(b.seating_at);
                const actions = BOOKING_ACTIONS[b.status] ?? [];
                return (
                  <tr key={b.id}>
                    <td>{when.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", { weekday: "short", day: "numeric", month: "short" })} {when.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="num">{b.party_size}</td>
                    <td>{b.customer}{b.contact_phone ? <span className="muted"> · {b.contact_phone}</span> : null}</td>
                    <td>{b.note || <span className="muted">—</span>}</td>
                    <td><span className={`pill s-${b.status.toLowerCase()}`}>{(BOOKING_STATUS[b.status] ?? [b.status, b.status])[lang === "fr" ? 0 : 1]}</span></td>
                    <td>{actions.map(([s, fr, en]) => <button key={s} className={`btn ${s === "CANCELLED" || s === "NO_SHOW" ? "danger" : "ghost"}`} type="button" disabled={busy === b.id} onClick={() => move(b.id, s)} style={{ marginRight: 6 }}>{L(fr, en)}</button>)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const DAYS: [number, string, string][] = [[1, "Lundi", "Monday"], [2, "Mardi", "Tuesday"], [3, "Mercredi", "Wednesday"], [4, "Jeudi", "Thursday"], [5, "Vendredi", "Friday"], [6, "Samedi", "Saturday"], [0, "Dimanche", "Sunday"]];
type DayForm = { closed: boolean; open: string; close: string };

function Hours({ branchId, country, L }: { branchId: string; country: string; L: (fr: string, en: string) => string }) {
  const [days, setDays] = useState<Record<number, DayForm>>(() => Object.fromEntries(DAYS.map(([d]) => [d, { closed: false, open: "08:00", close: "22:00" }])));
  const [always, setAlways] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api<{ hours: Record<string, [string, string][]> }>(`/v1/admin/branches/${branchId}/hours`, { country }).then((r) => {
      const h = r.hours ?? {};
      if (Object.keys(h).length === 0) { setAlways(true); return; }
      setAlways(false);
      setDays((prev) => {
        const next = { ...prev };
        for (const [d] of DAYS) {
          const w = h[String(d)];
          next[d] = w && w.length ? { closed: false, open: w[0]![0], close: w[0]![1] } : { closed: true, open: "08:00", close: "22:00" };
        }
        return next;
      });
    }).catch(() => undefined);
  }, [branchId, country]);

  const save = async () => {
    const hours = always ? {} : Object.fromEntries(DAYS.filter(([d]) => !days[d]!.closed).map(([d]) => [String(d), [[days[d]!.open, days[d]!.close]]]));
    try { await api(`/v1/admin/branches/${branchId}/hours`, { method: "POST", country, body: { hours, special_hours: {} } }); setNotice(L("Horaires enregistrés.", "Hours saved.")); }
    catch (e) { setNotice((e as Error).message); }
  };
  const set = (d: number, patch: Partial<DayForm>) => setDays((prev) => ({ ...prev, [d]: { ...prev[d]!, ...patch } }));

  return (
    <section className="card">
      <div className="card-head"><div><h2>{L("Heures d'ouverture", "Opening hours")}</h2><p>{L("Les clients ne peuvent commander que pendant les heures d'ouverture.", "Customers can only order during opening hours.")}</p></div></div>
      {notice ? <div className="banner">{notice}</div> : null}
      <label className="check" style={{ padding: "0 16px" }}><input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} /> {L("Toujours ouvert", "Always open")}</label>
      {!always ? (
        <div className="hours-grid">
          {DAYS.map(([d, fr, en]) => (
            <div key={d} className="hours-row">
              <span className="hours-day">{L(fr, en)}</span>
              <label className="check"><input type="checkbox" checked={days[d]!.closed} onChange={(e) => set(d, { closed: e.target.checked })} /> {L("Fermé", "Closed")}</label>
              {!days[d]!.closed ? (
                <span className="hours-times">
                  <input type="time" className="input" value={days[d]!.open} onChange={(e) => set(d, { open: e.target.value })} />
                  <span>→</span>
                  <input type="time" className="input" value={days[d]!.close} onChange={(e) => set(d, { close: e.target.value })} />
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className="card-foot"><button type="button" className="btn primary" onClick={save}>{L("Enregistrer les horaires", "Save hours")}</button></div>
    </section>
  );
}

interface Review { id: string; restaurant_rating: number; rider_rating: number | null; comment: string | null; reviewer?: string; reply?: string | null; created_at: string }

function Reviews({ branchId, country, lang, L }: { branchId: string; country: string; lang: string; L: (fr: string, en: string) => string }) {
  const [rows, setRows] = useState<Review[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const load = () => api<{ reviews: Review[] }>(`/v1/admin/branches/${branchId}/reviews`, { country }).then((r) => setRows(r.reviews)).catch(() => setRows([]));
  useEffect(() => { void load(); }, [branchId, country]); // eslint-disable-line react-hooks/exhaustive-deps
  const reply = async (id: string) => {
    try { await api(`/v1/admin/reviews/${id}/reply`, { method: "POST", country, body: { reply: drafts[id] ?? "" } }); setNotice(L("Réponse publiée.", "Reply posted.")); void load(); }
    catch (e) { setNotice((e as Error).message); }
  };
  const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);
  return (
    <section className="card">
      <div className="card-head"><div><h2>{L("Avis clients", "Customer reviews")}</h2><p>{rows ? `${rows.length}` : "…"}</p></div></div>
      {notice ? <div className="banner">{notice}</div> : null}
      {rows && rows.length === 0 ? <p className="muted">{L("Aucun avis pour l'instant.", "No reviews yet.")}</p> : null}
      {rows?.map((r) => (
        <div key={r.id} className="review">
          <div className="review-head"><span className="review-stars" title={`${r.restaurant_rating}/5`}>{stars(r.restaurant_rating)}</span><b>{r.reviewer ?? "Client"}</b><span className="muted small">{new Date(r.created_at).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB")}</span></div>
          {r.comment ? <p className="review-comment">{r.comment}</p> : null}
          {r.reply ? <p className="review-reply"><b>{L("Votre réponse :", "Your reply:")}</b> {r.reply}</p> : (
            <div className="review-reply-form">
              <input className="input" placeholder={L("Répondre…", "Reply…")} value={drafts[r.id] ?? ""} onChange={(e) => setDrafts({ ...drafts, [r.id]: e.target.value })} />
              <button type="button" className="btn" disabled={!(drafts[r.id] ?? "").trim()} onClick={() => reply(r.id)}>{L("Répondre", "Reply")}</button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
