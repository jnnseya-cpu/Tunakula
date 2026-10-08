"use client";
/**
 * Live dispatch: every rider on a map and in a list (available, offered, busy, offline, signal lost), every
 * order that needs or has a rider, kitchens running late, and the two things ops do by hand: give an order
 * to a specific rider, and record cash a rider hands in at the hub.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { TileMap, type MapPin } from "../../components/map";
import { api, ApiError } from "../../lib/api";
import { money } from "../../lib/format";
import type { Lang } from "../../lib/i18n";

interface Incident { id: string; rider: { id: string; name: string }; order_id: string | null; kind: string; location: { lat: number; lng: number } | null; note: string | null; status: string; created_at: string }
interface Rider {
  id: string; name: string; phone: string | null; zones: string[]; vehicle: string; status: "AVAILABLE" | "OFFERED" | "BUSY" | "OFFLINE" | "SIGNAL_LOST";
  position: { lat: number; lng: number } | null; last_seen: string | null; online_minutes: number;
  job: { order_id: string; ref: string; state: string } | null; delivered_today: number; cash_in_hand: { amount_minor: string; currency: string };
}
interface Order {
  order_id: string; ref: string; state: string; pickup: { name: string; lat: number; lng: number }; drop: { lat: number; lng: number } | null;
  rider: { id: string; name: string } | null; offer: { rider_id: string; rider_name: string; seconds_left: number } | null;
  tries: number; waiting_min: number; kitchen_late: boolean; cash: { amount_minor: string; currency: string } | null;
}
interface Board {
  now: string; kitchen_timeout_min: number; riders: Rider[]; orders: Order[];
  refunds_failing: { order_id: string; ref: string; amount: { amount_minor: string; currency: string }; failure: string | null; attempts: number; given_up: boolean }[];
}

const STATUS: Record<Rider["status"], [string, string, string]> = {
  AVAILABLE: ["Disponible", "Available", "rider"], OFFERED: ["Offre en cours", "Offer out", "rider-offer"], BUSY: ["En course", "On a job", "rider-busy"],
  SIGNAL_LOST: ["Signal perdu", "Signal lost", "rider-off"], OFFLINE: ["Hors ligne", "Offline", "rider-off"],
};
const STATE: Record<string, [string, string]> = {
  PLACED: ["Attente cuisine", "Waiting for kitchen"], ACCEPTED: ["Acceptée", "Accepted"], PREPARING: ["En cuisine", "Cooking"], PACKED: ["Emballée", "Packed"],
  READY: ["Prête", "Ready"], PICKED_UP: ["En route", "On the way"],
};
const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h)) * 1.3;
};

export default function DispatchPage() {
  return <Shell title="dispatch"><Gate cap="dispatch"><Dispatch /></Gate></Shell>;
}

function Dispatch() {
  const { country, lang } = useConsole();
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [assign, setAssign] = useState<Order | null>(null);
  const [cashIn, setCashIn] = useState<Rider | null>(null);
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [incidents, setIncidents] = useState<Incident[]>([]);

  const load = useCallback(async () => {
    try {
      setBoard(await api<Board>("/v1/ops/dispatch", { country }));
      setError(null);
      api<{ incidents: Incident[] }>("/v1/ops/incidents", { country }).then((r) => setIncidents(r.incidents)).catch(() => undefined);
    } catch (e) { setError((e as Error).message); }
  }, [country]);
  const resolveIncident = async (id: string, status: "ACKNOWLEDGED" | "RESOLVED") => {
    try { await api(`/v1/ops/incidents/${id}`, { method: "POST", country, body: { status } }); void load(); } catch { /* shown next poll */ }
  };
  useEffect(() => { void load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  const pins = useMemo<MapPin[]>(() => {
    if (!board) return [];
    const riders = board.riders.filter((r) => r.position && (filter === "all" || r.status !== "OFFLINE")).map((r) => ({
      id: `r:${r.id}`, lat: r.position!.lat, lng: r.position!.lng, kind: STATUS[r.status][2] as MapPin["kind"], label: r.name.slice(0, 1), title: `${r.name} · ${L(STATUS[r.status][0], STATUS[r.status][1])}`,
    }));
    const kitchens = board.orders.map((o) => ({ id: `o:${o.order_id}`, lat: o.pickup.lat, lng: o.pickup.lng, kind: "kitchen" as const, label: o.ref.slice(0, 3), title: `#${o.ref} · ${o.pickup.name}` }));
    return [...kitchens, ...riders];
  }, [board, filter, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const sel = board?.orders.find((o) => `o:${o.order_id}` === selected);
  const routes = sel?.drop ? [{ from: sel.pickup, to: sel.drop }] : [];

  if (!board) return error ? <div className="banner error">{error}</div> : <div className="muted">…</div>;
  const count = (s: Rider["status"]) => board.riders.filter((r) => r.status === s).length;
  const waiting = board.orders.filter((o) => !o.rider);
  const late = board.orders.filter((o) => o.kitchen_late);

  return (
    <div className="dsp">
      <div className="dsp-kpis">
        <div className="tile"><div className="label">{L("Livreurs disponibles", "Riders available")}</div><div className="value">{count("AVAILABLE")}</div></div>
        <div className="tile"><div className="label">{L("En course", "On a job")}</div><div className="value">{count("BUSY") + count("OFFERED")}</div></div>
        <div className={`tile ${waiting.length ? "warn" : ""}`}><div className="label">{L("Commandes sans livreur", "Orders without a rider")}</div><div className="value">{waiting.length}</div></div>
        <div className={`tile ${late.length ? "bad" : ""}`}><div className="label">{L("Cuisines en retard", "Kitchens running late")}</div><div className="value">{late.length}</div></div>
        <div className="tile"><div className="label">{L("Signal perdu", "Signal lost")}</div><div className="value">{count("SIGNAL_LOST")}</div></div>
      </div>
      {error ? <div className="banner error">{error}</div> : null}
      {incidents.length ? (
        <div className="banner error dsp-safety">
          <b>🆘 {L("Alertes sécurité livreur", "Rider safety alerts")} ({incidents.length})</b>
          <ul>
            {incidents.map((i) => (
              <li key={i.id}>
                <span><b>{i.rider.name}</b> · {i.kind}{i.note ? ` — ${i.note}` : ""} · <span className="muted">{new Date(i.created_at).toLocaleTimeString()}</span> · {i.status}</span>
                <span className="dsp-safety-act">
                  {i.location ? <a className="link-btn" href={`https://www.google.com/maps?q=${i.location.lat},${i.location.lng}`} target="_blank" rel="noreferrer">{L("Carte", "Map")}</a> : null}
                  {i.status === "OPEN" ? <button type="button" className="link-btn" onClick={() => resolveIncident(i.id, "ACKNOWLEDGED")}>{L("Pris en charge", "Acknowledge")}</button> : null}
                  <button type="button" className="link-btn" onClick={() => resolveIncident(i.id, "RESOLVED")}>{L("Résolu", "Resolve")}</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {board.refunds_failing?.length ? (
        <details className="banner error dsp-refunds">
          <summary>{L(`${board.refunds_failing.length} remboursement(s) refusé(s) par le prestataire de paiement`, `${board.refunds_failing.length} refund(s) refused by the payment provider`)} · {L("relance automatique 5 fois, puis action manuelle", "retried automatically 5 times, then a person must act")}</summary>
          <ul>{board.refunds_failing.slice(0, 12).map((r) => <li key={r.order_id}><b>#{r.ref}</b> {money(lang, r.amount.amount_minor, r.amount.currency)} — {r.failure} ({r.attempts}/5{r.given_up ? L(", abandonné", ", stopped") : ""})</li>)}</ul>
        </details>
      ) : null}

      <div className="dsp-grid">
        <section className="card dsp-map">
          <div className="card-head"><div><h2>{L("Carte en direct", "Live map")}</h2><p>{L("Cuisines avec commande en cours et livreurs", "Kitchens with live orders, and riders")}</p></div>
            <div className="seg sm">{(["active", "all"] as const).map((f) => <button key={f} type="button" className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f === "active" ? L("En ligne", "Online") : L("Tous", "All")}</button>)}</div>
          </div>
          <TileMap height={430} pins={pins} routes={routes} selected={selected} onPin={(p) => setSelected(p.id ?? null)} />
          <div className="dsp-legend">
            {(["AVAILABLE", "OFFERED", "BUSY", "OFFLINE"] as const).map((s) => <span key={s}><i className={`lg ${STATUS[s][2]}`} />{L(STATUS[s][0], STATUS[s][1])}</span>)}
            <span><i className="lg kitchen" />{L("Cuisine", "Kitchen")}</span>
          </div>
        </section>

        <section className="card dsp-orders">
          <div className="card-head"><div><h2>{L("Commandes livrées par un livreur", "Rider orders")}</h2><p>{L("Sans livreur en premier", "Unassigned first")}</p></div></div>
          {board.orders.length === 0 ? <p className="muted">{L("Aucune commande en cours.", "No orders in progress.")}</p> : null}
          <ul className="dsp-list">
            {[...board.orders].sort((a, b) => Number(!!a.rider) - Number(!!b.rider) || b.waiting_min - a.waiting_min).map((o) => (
              <li key={o.order_id} className={`${selected === `o:${o.order_id}` ? "sel" : ""} ${!o.rider ? "open" : ""} ${o.kitchen_late ? "late" : ""}`} onClick={() => setSelected(`o:${o.order_id}`)}>
                <div className="dl-top"><b>#{o.ref}</b><span className="pill">{L(...(STATE[o.state] ?? [o.state, o.state]))}</span><span className={`dl-wait ${o.waiting_min >= 20 ? "bad" : ""}`}>{o.waiting_min} min</span></div>
                <div className="dl-mid">{o.pickup.name}{o.cash ? <> · <b>{L("Espèces", "Cash")} {money(lang, o.cash.amount_minor, o.cash.currency)}</b></> : null}</div>
                <div className="dl-bot">
                  {o.rider ? <span>🛵 {o.rider.name}</span> : o.offer ? <span className="muted">{L("Proposée à", "Offered to")} {o.offer.rider_name} · {o.offer.seconds_left}s</span> : <span className="warn-txt">{o.tries ? L(`${o.tries} livreur(s) sollicité(s), aucun n'a accepté`, `${o.tries} rider(s) asked, none accepted`) : L("Recherche d'un livreur", "Looking for a rider")}</span>}
                  {o.kitchen_late ? <span className="bad-txt">{L(`Cuisine sans réponse — annulation à ${board.kitchen_timeout_min} min`, `Kitchen not answering — cancels at ${board.kitchen_timeout_min} min`)}</span> : null}
                  {o.state !== "PICKED_UP" ? <button type="button" className="btn sm" onClick={(e) => { e.stopPropagation(); setAssign(o); }}>{o.rider ? L("Réassigner", "Reassign") : L("Assigner", "Assign")}</button> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card">
        <div className="card-head"><div><h2>{L("Livreurs", "Riders")}</h2><p>{L("Statut, course en cours, espèces à remettre", "Status, current job, cash to hand in")}</p></div></div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{L("Livreur", "Rider")}</th><th>{L("Statut", "Status")}</th><th>{L("Communes", "Communes")}</th><th>{L("Course", "Job")}</th><th className="num">{L("Livrées aujourd'hui", "Delivered today")}</th><th className="num">{L("Espèces en main", "Cash in hand")}</th><th>{L("Vu", "Seen")}</th><th /></tr></thead>
            <tbody>
              {board.riders.map((r) => (
                <tr key={r.id} className={selected === `r:${r.id}` ? "sel" : ""} onClick={() => setSelected(`r:${r.id}`)}>
                  <td><b>{r.name}</b><div className="muted small">{r.phone} · {r.vehicle.toLowerCase()}</div></td>
                  <td><span className={`st ${r.status.toLowerCase()}`}>{L(STATUS[r.status][0], STATUS[r.status][1])}</span></td>
                  <td className="muted">{r.zones.length > 3 ? `${r.zones.slice(0, 3).join(", ")} +${r.zones.length - 3}` : r.zones.join(", ")}</td>
                  <td>{r.job ? <>#{r.job.ref} · {L(...(STATE[r.job.state] ?? [r.job.state, r.job.state]))}</> : "—"}</td>
                  <td className="num">{r.delivered_today}</td>
                  <td className="num">{BigInt(r.cash_in_hand.amount_minor) > 0n ? <b>{money(lang, r.cash_in_hand.amount_minor, r.cash_in_hand.currency)}</b> : money(lang, r.cash_in_hand.amount_minor, r.cash_in_hand.currency)}</td>
                  <td className="muted">{r.last_seen ? new Date(r.last_seen).toLocaleTimeString(lang === "fr" ? "fr-FR" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kinshasa" }) : "—"}</td>
                  <td>{BigInt(r.cash_in_hand.amount_minor) > 0n ? <button type="button" className="btn ghost sm" onClick={(e) => { e.stopPropagation(); setCashIn(r); }}>{L("Encaisser", "Cash in")}</button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {assign ? <AssignModal order={assign} riders={board.riders} lang={lang} country={country} onClose={() => setAssign(null)} onDone={async () => { setAssign(null); await load(); }} /> : null}
      {cashIn ? <CashModal rider={cashIn} lang={lang} country={country} onClose={() => setCashIn(null)} onDone={async () => { setCashIn(null); await load(); }} /> : null}
    </div>
  );
}

function AssignModal({ order, riders, lang, country, onClose, onDone }: { order: Order; riders: Rider[]; lang: Lang; country: string; onClose: () => void; onDone: () => Promise<void> }) {
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState<string | null>(null);
  const ranked = riders.filter((r) => r.id !== order.rider?.id && r.status !== "OFFLINE")
    .map((r) => ({ r, d: r.position ? km(r.position, order.pickup) : Infinity }))
    .sort((a, b) => Number(a.r.status !== "AVAILABLE") - Number(b.r.status !== "AVAILABLE") || a.d - b.d);
  const go = async (r: Rider, override = false) => {
    setBusy(true); setError(null);
    try { await api(`/v1/ops/orders/${order.order_id}/assign`, { method: "POST", body: { rider_id: r.id, override }, country }); await onDone(); }
    catch (e) { const err = e as ApiError; if (err.code === "RIDER_BUSY") setConfirmBusy(r.id); else setError(err.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={L("Assigner un livreur", "Assign a rider")} onClick={(e) => e.stopPropagation()}>
        <h2>{order.rider ? L("Réassigner", "Reassign") : L("Assigner", "Assign")} #{order.ref} · {order.pickup.name}</h2>
        <p className="muted">{L("Les plus proches de la cuisine d'abord. L'offre en cours est retirée.", "Nearest to the kitchen first. Any live offer is withdrawn.")}</p>
        {ranked.length === 0 ? <p className="muted">{L("Aucun livreur en ligne.", "No riders online.")}</p> : null}
        <ul className="dsp-pick">
          {ranked.map(({ r, d }) => (
            <li key={r.id}>
              <span><b>{r.name}</b> <span className={`st ${r.status.toLowerCase()}`}>{L(STATUS[r.status][0], STATUS[r.status][1])}</span><small className="muted"> {Number.isFinite(d) ? `${d.toFixed(1)} km` : L("position inconnue", "no position")}</small></span>
              {confirmBusy === r.id
                ? <button type="button" className="btn danger sm" disabled={busy} onClick={() => go(r, true)}>{L("Confirmer une 2e course", "Confirm a second job")}</button>
                : <button type="button" className="btn primary sm" disabled={busy} onClick={() => go(r)}>{L("Choisir", "Choose")}</button>}
            </li>
          ))}
        </ul>
        {error ? <div className="banner error">{error}</div> : null}
        <div className="modal-actions"><button type="button" className="btn ghost" onClick={onClose}>{L("Fermer", "Close")}</button></div>
      </div>
    </div>
  );
}

function CashModal({ rider, lang, country, onClose, onDone }: { rider: Rider; lang: Lang; country: string; onClose: () => void; onDone: () => Promise<void> }) {
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const ccy = rider.cash_in_hand.currency;
  const digits = new Intl.NumberFormat("en", { style: "currency", currency: ccy }).resolvedOptions().maximumFractionDigits ?? 2;
  const held = rider.cash_in_hand.amount_minor;
  const asDecimal = (m: string) => (digits ? `${m.slice(0, -digits) || "0"}.${m.slice(-digits).padStart(digits, "0")}` : m);
  const [amount, setAmount] = useState(asDecimal(held.padStart(digits + 1, "0")));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toMinor = (v: string) => {
    const m = v.trim().replace(",", ".").match(/^(\d+)(?:\.(\d{0,6}))?$/);
    if (!m) return null;
    const frac = (m[2] ?? "").padEnd(digits, "0");
    if (frac.length > digits && /[1-9]/.test(frac.slice(digits))) return null;
    return (BigInt(m[1]!) * 10n ** BigInt(digits) + BigInt(frac.slice(0, digits) || "0")).toString();
  };
  const minor = toMinor(amount);
  const submit = async () => {
    if (!minor) return;
    setBusy(true); setError(null);
    try { await api(`/v1/ops/riders/${rider.id}/cash-in`, { method: "POST", body: { amount_minor: minor, note }, country }); await onDone(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={L("Encaisser", "Cash in")} onClick={(e) => e.stopPropagation()}>
        <h2>{L("Espèces remises par", "Cash handed in by")} {rider.name}</h2>
        <p className="muted">{L("En main", "In hand")}: <b>{money(lang, held, ccy)}</b>. {L("Comptez les billets, puis saisissez le montant reçu. L'écriture est passée au grand livre.", "Count the notes, then enter what you received. It is posted to the ledger.")}</p>
        <div className="k-form">
          <label className="field-a"><span>{L("Montant reçu", "Amount received")} ({ccy})</span><input className="input k-code" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <input className="input" placeholder={L("Note (hub, reçu n°…)", "Note (hub, receipt no.…)")} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error ? <div className="banner error">{error}</div> : null}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>{L("Annuler", "Cancel")}</button>
          <button type="button" className="btn primary" disabled={busy || !minor || minor === "0"} onClick={submit}>{L("Enregistrer", "Record")} {minor ? money(lang, minor, ccy) : ""}</button>
        </div>
      </div>
    </div>
  );
}
