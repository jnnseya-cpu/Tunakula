"use client";
/**
 * Kitchen board: orders arrive live (sound and tab flash), and each card carries the one next step:
 * accept or reject → start cooking → pack (tick every line, acknowledge allergens, count bags) →
 * ready (labels, seals, pack photo) → hand over at the counter with the customer's code, or wait for the rider.
 * The custody rules themselves live in the API; this screen only asks for what each gate needs.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api, ApiError } from "../../lib/api";
import { money } from "../../lib/format";

interface Line { id: string; name: string; quantity: number; options: string[]; allergens: string[]; note?: string }
interface KOrder {
  order_id: string; ref: string; state: string; type: string; payment_mode: string; total: { amount_minor: string; currency: string };
  branch_id: string; customer: string | null; rider: { id: string; name: string } | null; lines: Line[]; times: Record<string, string>; created_at: string;
  packages: number | null; labels: string[]; confirmation_model: string;
}
interface Board { now: string; branches: { id: string; name: string; commune: string | null; status: string; can_pause: boolean }[]; orders: KOrder[] }

const RIDER_TYPES = ["DELIVERY", "SCHEDULED", "XBO"];
const COLUMNS: { key: string; states: string[]; fr: string; en: string }[] = [
  { key: "new", states: ["PLACED"], fr: "Nouvelles", en: "New" },
  { key: "cook", states: ["ACCEPTED", "PREPARING", "PACKED"], fr: "En cuisine", en: "Cooking" },
  { key: "ready", states: ["READY"], fr: "Prêtes", en: "Ready" },
];
const REASONS: [string, string, string][] = [
  ["ITEM_UNAVAILABLE", "Un plat n'est plus disponible", "An item is not available"],
  ["TOO_BUSY", "Trop de commandes en ce moment", "Too busy right now"],
  ["KITCHEN_CLOSED", "La cuisine ferme", "Kitchen is closing"],
  ["CANNOT_DELIVER_AREA", "Adresse trop loin", "Address too far"],
];
const TARGET_MIN: Record<string, number> = { PLACED: 3, ACCEPTED: 5, PREPARING: 20, PACKED: 5, READY: 10 };

const sinceMin = (iso: string | undefined, now: number) => (iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / 60000)) : 0);
const clock = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kinshasa" });

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

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function KitchenPage() {
  return <Shell title="kitchen"><Gate cap="kitchen"><Kitchen /></Gate></Shell>;
}

function Kitchen() {
  const { country, lang } = useConsole();
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const [board, setBoard] = useState<Board | null>(null);
  const [branch, setBranch] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [sound, setSound] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<{ kind: "reject" | "pack" | "ready" | "handover"; order: KOrder } | null>(null);
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
  // Tab title shows how many orders are waiting, so a kitchen sees it from across the room.
  useEffect(() => {
    const waiting = board?.orders.filter((o) => o.state === "PLACED").length ?? 0;
    document.title = waiting ? `(${waiting}) ${L("Nouvelle commande", "New order")} · Tunakula` : `${L("Cuisine", "Kitchen")} · Tunakula`;
    return () => { document.title = "Tunakula Admin"; };
  }, [board, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (o: KOrder, command: Record<string, unknown>) => {
    setBusy(o.order_id);
    try {
      await api(`/v1/orders/${o.order_id}/transitions`, { method: "POST", body: { command }, country });
      setModal(null);
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

  const setStatus = async (id: string, status: "OPEN" | "PAUSED") => {
    if (status === "PAUSED" && !window.confirm(L("Arrêter de recevoir de nouvelles commandes ? Les commandes en cours continuent.", "Stop taking new orders? Orders in progress continue."))) return;
    try { await api(`/v1/kitchen/branches/${id}/status`, { method: "POST", body: { status }, country }); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  if (!board) return error ? <div className="banner error">{error}</div> : <div className="muted">…</div>;
  const done = board.orders.filter((o) => ["PICKED_UP", "DELIVERED", "REJECTED", "CANCELLED"].includes(o.state)).reverse();

  return (
    <div className="kitchen">
      <div className="k-bar">
        {board.branches.length > 1 ? (
          <select className="select" value={branch} onChange={(e) => setBranch(e.target.value)} aria-label={L("Établissement", "Branch")}>
            <option value="">{L("Tous mes établissements", "All my branches")}</option>
            {board.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        ) : <b className="k-branch">{board.branches[0]?.name}</b>}
        {board.branches.filter((b) => !branch || b.id === branch).map((b) => (
          <span key={b.id} className={`k-status ${b.status === "OPEN" ? "on" : "off"}`}>
            {board.branches.length > 1 ? `${b.name} · ` : ""}{b.status === "OPEN" ? L("Reçoit des commandes", "Taking orders") : L("En pause", "Paused")}
            {b.can_pause ? <button type="button" className="btn ghost sm" onClick={() => setStatus(b.id, b.status === "OPEN" ? "PAUSED" : "OPEN")}>{b.status === "OPEN" ? L("Mettre en pause", "Pause") : L("Reprendre", "Resume")}</button> : null}
          </span>
        ))}
        <button type="button" className={`btn ${sound ? "primary" : "ghost"} k-sound`} onClick={toggleSound} aria-pressed={sound}>
          {sound ? "🔔 " + L("Son activé", "Sound on") : "🔕 " + L("Activer le son", "Turn sound on")}
        </button>
      </div>
      {fresh > 0 ? <div className="banner k-fresh" role="status">{L(`${fresh} nouvelle(s) commande(s)`, `${fresh} new order(s)`)}</div> : null}
      {error ? <div className="banner error" role="alert">{error} <button type="button" className="link-btn" onClick={() => setError(null)}>×</button></div> : null}

      <div className="k-cols">
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
                return (
                  <article key={o.order_id} className={`k-card ${late ? "late" : ""} ${o.state === "PLACED" ? "new" : ""}`}>
                    <header>
                      <span className="k-ref">#{o.ref}</span>
                      <span className={`k-type ${rider ? "del" : "col"}`}>{rider ? L("Livraison", "Delivery") : L("À emporter", "Collect")}</span>
                      <span className={`k-timer ${late ? "late" : ""}`} title={L("Depuis l'étape actuelle", "Time in this step")}>{sinceMin(stateAt, now)} min</span>
                    </header>
                    <ul className="k-lines">
                      {o.lines.map((l) => (
                        <li key={l.id}><b className="k-qty">{l.quantity}×</b> <span>{l.name}{l.options.length ? <small> · {l.options.join(", ")}</small> : null}{l.note ? <em className="k-note">“{l.note}”</em> : null}</span></li>
                      ))}
                    </ul>
                    {allergens.length ? <p className="k-allergen">⚠ {L("Allergènes", "Allergens")}: {allergens.join(", ")}</p> : null}
                    <p className="k-meta">
                      {o.customer ?? L("Client", "Customer")} · {L("passée à", "placed")} {clock(o.times.PLACED ?? o.created_at)}
                      {o.payment_mode === "CASH_ON_DELIVERY" ? <> · <b>{L("Espèces", "Cash")} {money(lang, o.total.amount_minor, o.total.currency)}</b></> : null}
                    </p>
                    {o.state === "READY" && o.labels.length ? <p className="k-meta">{L("Sacs", "Bags")}: {o.labels.join(" · ")}</p> : null}
                    {rider ? <p className="k-rider">{o.rider ? `🛵 ${o.rider.name}` : L("Recherche d'un livreur…", "Finding a rider…")}</p> : null}
                    {o.state === "PACKED" ? <p className="k-step">{L("Emballée", "Packed")} — {L("ajoutez étiquettes et scellés", "add labels and seals")}</p> : null}
                    {o.state === "PREPARING" ? <p className="k-step">{L("En préparation", "Cooking")}</p> : null}
                    <div className="k-actions">
                      {o.state === "PLACED" && rider && o.confirmation_model === "RIDER_FIRST" && !o.rider ? <>
                        <p className="k-wait">{L("Un livreur est d'abord réservé ; vous pourrez accepter dès qu'il est assigné.", "A rider is secured first; you can accept as soon as one is assigned.")}</p>
                        <button type="button" className="btn danger" disabled={busy === o.order_id} onClick={() => setModal({ kind: "reject", order: o })}>{L("Refuser", "Reject")}</button>
                      </> : o.state === "PLACED" ? <>
                        <button type="button" className="btn primary big" disabled={busy === o.order_id} onClick={() => act(o, { type: "ACCEPT" })}>{L("Accepter", "Accept")}</button>
                        <button type="button" className="btn danger" disabled={busy === o.order_id} onClick={() => setModal({ kind: "reject", order: o })}>{L("Refuser", "Reject")}</button>
                      </> : null}
                      {o.state === "ACCEPTED" ? <button type="button" className="btn primary big" disabled={busy === o.order_id} onClick={() => act(o, { type: "START_PREPARING" })}>{L("Commencer la cuisson", "Start cooking")}</button> : null}
                      {o.state === "PREPARING" ? <button type="button" className="btn primary big" onClick={() => setModal({ kind: "pack", order: o })}>{L("Emballer", "Pack")}</button> : null}
                      {o.state === "PACKED" ? <button type="button" className="btn primary big" onClick={() => setModal({ kind: "ready", order: o })}>{L("Prête", "Mark ready")}</button> : null}
                      {o.state === "READY" && !rider ? <button type="button" className="btn primary big" onClick={() => setModal({ kind: "handover", order: o })}>{L("Remettre au client", "Hand over")}</button> : null}
                      {o.state === "READY" && rider ? <p className="muted">{o.rider ? L("Le livreur scanne les sacs au retrait.", "The rider scans the bags at pickup.") : L("En attente d'un livreur.", "Waiting for a rider.")}</p> : null}
                    </div>
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>

      {done.length ? (
        <details className="k-done">
          <summary>{L("Terminées (2 dernières heures)", "Done (last 2 hours)")} · {done.length}</summary>
          <ul>{done.map((o) => <li key={o.order_id}><b>#{o.ref}</b> {o.lines.map((l) => `${l.quantity}× ${l.name}`).join(", ")} <span className={`k-end s-${o.state.toLowerCase()}`}>{o.state === "PICKED_UP" ? L("Partie avec le livreur", "Left with rider") : o.state === "DELIVERED" ? L("Remise", "Handed over") : o.state === "REJECTED" ? L("Refusée", "Rejected") : L("Annulée", "Cancelled")}</span></li>)}</ul>
        </details>
      ) : null}

      {modal ? <StepModal modal={modal} lang={lang} busy={busy === modal.order.order_id} onClose={() => setModal(null)} onSubmit={(cmd) => act(modal.order, cmd)} /> : null}
    </div>
  );
}

function StepModal({ modal, lang, busy, onClose, onSubmit }: { modal: { kind: "reject" | "pack" | "ready" | "handover"; order: KOrder }; lang: string; busy: boolean; onClose: () => void; onSubmit: (cmd: Record<string, unknown>) => void }) {
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const o = modal.order;
  const [reason, setReason] = useState(REASONS[0]![0]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [allergenOk, setAllergenOk] = useState(false);
  const [bags, setBags] = useState(1);
  const [sealed, setSealed] = useState(true);
  const [sealNote, setSealNote] = useState("");
  const [photo, setPhoto] = useState<{ name: string; ref: string; url: string } | null>(null);
  const [code, setCode] = useState("");
  const allergens = [...new Set(o.lines.flatMap((l) => l.allergens))];
  const labels = Array.from({ length: o.packages ?? bags }, (_, i) => `L-${o.ref}-${i + 1}`);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);

  let body: React.ReactNode = null;
  let submit: (() => void) | null = null;
  let ok = true;
  if (modal.kind === "reject") {
    body = <div className="k-form">{REASONS.map(([code, fr, en]) => <label key={code} className="k-radio"><input type="radio" name="reason" checked={reason === code} onChange={() => setReason(code)} /> {L(fr, en)}</label>)}<p className="muted">{L("Le client est prévenu et remboursé s'il a payé.", "The customer is told and refunded if they paid.")}</p></div>;
    submit = () => onSubmit({ type: "REJECT", reasonCode: reason });
  } else if (modal.kind === "pack") {
    ok = ticked.size === o.lines.length && (allergens.length === 0 || allergenOk) && bags >= 1;
    body = (
      <div className="k-form">
        <p className="muted">{L("Cochez chaque plat quand il est dans le sac.", "Tick each dish as it goes in the bag.")}</p>
        {o.lines.map((l) => (
          <label key={l.id} className="k-check"><input type="checkbox" checked={ticked.has(l.id)} onChange={(e) => { const n = new Set(ticked); if (e.target.checked) n.add(l.id); else n.delete(l.id); setTicked(n); }} /> <b>{l.quantity}×</b> {l.name}</label>
        ))}
        {allergens.length ? <label className="k-check warn"><input type="checkbox" checked={allergenOk} onChange={(e) => setAllergenOk(e.target.checked)} /> ⚠ {L(`J'ai vérifié les allergènes : ${allergens.join(", ")}`, `I checked the allergens: ${allergens.join(", ")}`)}</label> : null}
        <div className="k-bags"><span>{L("Nombre de sacs", "Bags")}</span><button type="button" className="btn ghost" onClick={() => setBags(Math.max(1, bags - 1))}>−</button><b>{bags}</b><button type="button" className="btn ghost" onClick={() => setBags(Math.min(9, bags + 1))}>+</button></div>
      </div>
    );
    submit = () => onSubmit({ type: "PACK", confirmedLineIds: o.lines.map((l) => l.id), packageCount: bags, allergenAcknowledged: allergens.length ? allergenOk : true });
  } else if (modal.kind === "ready") {
    ok = !!photo && (sealed || sealNote.trim().length > 3);
    body = (
      <div className="k-form">
        <p className="muted">{L("Collez une étiquette sur chaque sac, fermez avec un scellé, puis prenez une photo des sacs.", "Stick a label on each bag, close it with a seal, then take a photo of the bags.")}</p>
        <div className="k-labels">{labels.map((id) => <span key={id} className="k-label">{id}</span>)}</div>
        <button type="button" className="btn ghost" onClick={() => window.print()}>{L("Imprimer les étiquettes", "Print labels")}</button>
        <label className="k-check"><input type="checkbox" checked={sealed} onChange={(e) => setSealed(e.target.checked)} /> {L("Chaque sac est scellé", "Every bag is sealed")}</label>
        {!sealed ? <input className="input" placeholder={L("Pourquoi pas de scellé ?", "Why no seal?")} value={sealNote} onChange={(e) => setSealNote(e.target.value)} /> : null}
        <label className="k-photo">
          <input type="file" accept="image/*" capture="environment" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPhoto({ name: f.name, ref: `sha256:${await sha256(f)}`, url: URL.createObjectURL(f) }); }} />
          {photo ? <img src={photo.url} alt={L("Photo des sacs", "Photo of the bags")} /> : <span>📷 {L("Prendre la photo des sacs", "Take the photo of the bags")}</span>}
        </label>
      </div>
    );
    submit = () => onSubmit({
      type: "MARK_READY",
      packages: labels.map((labelId, i) => (sealed ? { labelId, sealId: `S-${o.ref}-${i + 1}` } : { labelId })),
      ...(sealed ? {} : { missingSealReason: sealNote.trim() }),
      packPhotoRef: photo?.ref ?? "",
    });
  } else {
    ok = /^\d{4}$/.test(code);
    body = (
      <div className="k-form">
        <p className="muted">{L("Demandez au client son code à 4 chiffres. Ne remettez la commande qu'avec le bon code.", "Ask the customer for their 4-digit code. Only hand over with the right code.")}</p>
        <input className="input k-code" inputMode="numeric" maxLength={4} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="0000" />
      </div>
    );
    submit = () => onSubmit({ type: "DELIVER", verification: { method: "CODE", code }, sealIntact: true });
  }
  const title = { reject: L("Refuser la commande", "Reject order"), pack: L("Emballer", "Pack"), ready: L("Prête pour le retrait", "Ready for pickup"), handover: L("Remise au comptoir", "Counter handover") }[modal.kind];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title} · #{o.ref}</h2>
        {body}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>{L("Annuler", "Cancel")}</button>
          <button type="button" className={`btn ${modal.kind === "reject" ? "danger" : "primary"}`} disabled={!ok || busy} onClick={() => submit?.()}>{busy ? "…" : modal.kind === "reject" ? L("Refuser", "Reject") : L("Confirmer", "Confirm")}</button>
        </div>
      </div>
    </div>
  );
}
