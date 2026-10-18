"use client";
/**
 * Kitchen Display (bump) — a large-screen, glance-and-tap board for a busy line. It shows the same live orders as
 * the full kitchen board but strips every card to the one gateless action a cook can bump with a single tap:
 * ACCEPT a new order, then START cooking. The moment an order needs the custody gates (pack: line check +
 * allergen acknowledgement; ready: labels, seals, pack photo; hand-over: the customer code), it moves to a
 * "Finish on the kitchen board" column that links to /kitchen/, where those modals live. No new API: this reuses
 * GET /v1/kitchen/orders and POST /v1/orders/:id/transitions, and the same cap="kitchen" + branch scoping.
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api, ApiError } from "../../lib/api";

interface Line { id: string; name: string; quantity: number; options: string[]; allergens: string[]; note?: string }
interface KOrder {
  order_id: string; ref: string; state: string; type: string; payment_mode: string; total: { amount_minor: string; currency: string };
  branch_id: string; customer: string | null; rider: { id: string; name: string } | null; lines: Line[]; times: Record<string, string>; created_at: string;
  packages: number | null; labels: string[]; confirmation_model: string; kitchen_note?: string; scheduled_for?: string;
}
interface Board { now: string; branches: { id: string; name: string; commune: string | null; status: string; can_pause: boolean }[]; orders: KOrder[] }

const RIDER_TYPES = ["DELIVERY", "SCHEDULED", "XBO"];
// Three bump lanes. "new" and "cook" carry one-tap actions; "finish" hands off to the full board for the gates.
const COLUMNS: { key: string; states: string[]; fr: string; en: string }[] = [
  { key: "new", states: ["PLACED"], fr: "À accepter", en: "To accept" },
  { key: "cook", states: ["ACCEPTED"], fr: "À lancer", en: "To start" },
  { key: "finish", states: ["PREPARING", "PACKED", "READY"], fr: "À finir (sur l'écran cuisine)", en: "To finish (on the kitchen board)" },
];
const TARGET_MIN: Record<string, number> = { PLACED: 3, ACCEPTED: 5, PREPARING: 20, PACKED: 5, READY: 10 };

const sinceMin = (iso: string | undefined, now: number) => (iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / 60000)) : 0);

/** A short two-tone chime, made in the browser (no sound file to load on a slow connection). */
function chime(ctx: AudioContext) {
  const t = ctx.currentTime;
  [880, 1320, 880, 1320].forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + i * 0.18);
    g.gain.exponentialRampToValueAtTime(0.35, t + i * 0.18 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.16);
    o.connect(g).connect(ctx.destination);
    o.start(t + i * 0.18);
    o.stop(t + i * 0.18 + 0.17);
  });
}

export default function KdsPage() {
  return <Shell title="kds"><Gate cap="kitchen"><Kds /></Gate></Shell>;
}

function Kds() {
  const { country, lang } = useConsole();
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const [board, setBoard] = useState<Board | null>(null);
  const [branch, setBranch] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [sound, setSound] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const [fresh, setFresh] = useState(0);

  const load = useCallback(async () => {
    try {
      const b = await api<Board>(`/v1/kitchen/orders${branch ? `?branch_id=${branch}` : ""}`, { country });
      const newOnes = b.orders.filter((o) => o.state === "PLACED" && seen.current && !seen.current.has(o.order_id));
      if (seen.current === null) seen.current = new Set();
      b.orders.forEach((o) => seen.current!.add(o.order_id));
      if (newOnes.length) {
        setFresh((n) => n + newOnes.length);
        if (audio.current) chime(audio.current);
        if ("vibrate" in navigator) navigator.vibrate?.([200, 100, 200]);
      }
      setBoard(b);
      setError(null);
    } catch (e) { setError((e as Error).message); }
  }, [country, branch]);

  useEffect(() => { seen.current = null; void load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const waiting = board?.orders.filter((o) => o.state === "PLACED").length ?? 0;
    document.title = waiting ? `(${waiting}) ${L("À accepter", "To accept")} · Tunakula` : `${L("Écran cuisine", "Kitchen display")} · Tunakula`;
    return () => { document.title = "Tunakula Admin"; };
  }, [board, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (o: KOrder, command: Record<string, unknown>) => {
    setBusy(o.order_id);
    try {
      await api(`/v1/orders/${o.order_id}/transitions`, { method: "POST", body: { command }, country });
      setFresh(0);
      await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const toggleSound = () => {
    if (!sound) {
      audio.current = audio.current ?? new AudioContext();
      void audio.current.resume();
      chime(audio.current);
    }
    setSound(!sound);
    if (sound) audio.current = null;
  };

  if (!board) return error ? <div className="banner error">{error}</div> : <div className="muted">…</div>;

  return (
    <div className="kitchen kds">
      <div className="k-bar">
        {board.branches.length > 1 ? (
          <select className="select" value={branch} onChange={(e) => setBranch(e.target.value)} aria-label={L("Établissement", "Branch")}>
            <option value="">{L("Tous mes établissements", "All my branches")}</option>
            {board.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        ) : <b className="k-branch">{board.branches[0]?.name}</b>}
        <Link className="btn ghost sm" href="/kitchen/">{L("Écran cuisine complet →", "Full kitchen board →")}</Link>
        <button type="button" className={`btn ${sound ? "primary" : "ghost"} k-sound`} onClick={toggleSound} aria-pressed={sound}>
          {sound ? "🔔 " + L("Son activé", "Sound on") : "🔕 " + L("Activer le son", "Turn sound on")}
        </button>
      </div>
      {fresh > 0 ? <div className="banner k-fresh" role="status">{L(`${fresh} nouvelle(s) commande(s)`, `${fresh} new order(s)`)}</div> : null}
      {error ? <div className="banner error" role="alert">{error} <button type="button" className="link-btn" onClick={() => setError(null)}>×</button></div> : null}

      <div className="k-cols kds-cols">
        {COLUMNS.map((col) => {
          const list = board.orders.filter((o) => col.states.includes(o.state));
          return (
            <section key={col.key} className={`k-col k-${col.key}`} aria-label={L(col.fr, col.en)}>
              <h2>{L(col.fr, col.en)} <span className="k-count">{list.length}</span></h2>
              {list.length === 0 ? <p className="muted k-empty">{col.key === "new" ? L("Aucune nouvelle commande. Elles apparaissent ici avec un son.", "No new orders. They appear here with a sound.") : "—"}</p> : null}
              {list.map((o) => {
                const stateAt = o.times[o.state] ?? o.created_at;
                const late = sinceMin(stateAt, now) > (TARGET_MIN[o.state] ?? 15);
                const rider = RIDER_TYPES.includes(o.type);
                const allergens = [...new Set(o.lines.flatMap((l) => l.allergens))];
                const waitingRider = o.state === "PLACED" && rider && o.confirmation_model === "RIDER_FIRST" && !o.rider;
                return (
                  <article key={o.order_id} className={`k-card kds-card ${late ? "late" : ""} ${o.state === "PLACED" ? "new" : ""}`}>
                    <header>
                      <span className="k-ref">#{o.ref}</span>
                      <span className={`k-type ${rider ? "del" : "col"}`}>{rider ? L("Livraison", "Delivery") : L("À emporter", "Collect")}</span>
                      <span className={`k-timer ${late ? "late" : ""}`} title={L("Depuis l'étape actuelle", "Time in this step")}>{sinceMin(stateAt, now)} min</span>
                    </header>
                    {o.scheduled_for ? <p className="k-sched">⏰ {L("Prévue pour", "Scheduled for")} {new Date(o.scheduled_for).toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</p> : null}
                    <ul className="k-lines">
                      {o.lines.map((l) => (
                        <li key={l.id}><b className="k-qty">{l.quantity}×</b> <span>{l.name}{l.options.length ? <small> · {l.options.join(", ")}</small> : null}{l.note ? <em className="k-note">“{l.note}”</em> : null}</span></li>
                      ))}
                    </ul>
                    {allergens.length ? <p className="k-allergen">⚠ {L("Allergènes", "Allergens")}: {allergens.join(", ")}</p> : null}
                    {o.kitchen_note ? <p className="k-kitchen-note">📝 {o.kitchen_note}</p> : null}
                    {rider ? <p className="k-rider">{o.rider ? `🛵 ${o.rider.name}` : L("Recherche d'un livreur…", "Finding a rider…")}</p> : null}
                    <div className="k-actions">
                      {waitingRider ? (
                        <p className="k-wait">{L("Un livreur est d'abord réservé ; l'ordre s'accepte dès qu'il est assigné.", "A rider is secured first; this can be accepted as soon as one is assigned.")}</p>
                      ) : o.state === "PLACED" ? (
                        <button type="button" className="btn primary big kds-bump" disabled={busy === o.order_id} onClick={() => act(o, { type: "ACCEPT" })}>{busy === o.order_id ? "…" : "✓ " + L("Accepter", "Accept")}</button>
                      ) : o.state === "ACCEPTED" ? (
                        <button type="button" className="btn primary big kds-bump" disabled={busy === o.order_id} onClick={() => act(o, { type: "START_PREPARING" })}>{busy === o.order_id ? "…" : "🔥 " + L("Lancer la cuisson", "Start cooking")}</button>
                      ) : (
                        <Link className="btn ghost big" href="/kitchen/">
                          {o.state === "PREPARING" ? L("En cuisson — emballer sur l'écran cuisine →", "Cooking — pack on the kitchen board →")
                            : o.state === "PACKED" ? L("Emballée — étiqueter & finir →", "Packed — label & finish →")
                            : L("Prête — remise / retrait →", "Ready — hand over / pickup →")}
                        </Link>
                      )}
                    </div>
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
      <p className="muted kds-foot">{L("Astuce : acceptez et lancez la cuisson d'une seule touche ici ; emballage, étiquettes, photo et remise se font sur l'écran cuisine complet (les contrôles de sécurité y sont obligatoires).", "Tip: accept and start cooking with one tap here; packing, labels, photo and hand-over are done on the full kitchen board, where the safety checks are enforced.")}</p>
    </div>
  );
}
