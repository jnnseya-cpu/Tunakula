"use client";
/**
 * The rider app (/rider): go online, get offers with the distance and what you earn shown before you accept,
 * then pick up (bags scanned or typed) and drop (the customer's code, position and a photo).
 * Built for a cheap Android phone in the sun: big type, big buttons, few steps, works on 3G.
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, getSession, live, money, setSession, type MoneyWire } from "../lib/api";
import { TileMap, type MapPin } from "./map";

interface Job {
  order_id: string; ref: string; state: string; type: string; items: number; labels: string[];
  pickup: { branch_id: string; name: string; commune: string | null; lat: number; lng: number };
  drop: { lat: number; lng: number; note: string | null; customer: string | null } | null;
  collect: MoneyWire | null; earnings: MoneyWire | null;
}
interface Jobs {
  presence: { online: boolean; lat: number | null; lng: number | null; online_since: string | null };
  offer: { id: string; seconds_left: number; expires_at: string; pickup_km: string; drop_km: string; earnings: MoneyWire; job: Job } | null;
  active: Job[];
  today: { deliveries: number; earnings: MoneyWire };
  cash_in_hand: MoneyWire;
}
type Pos = { lat: number; lng: number };

const nav = (p: { lat: number; lng: number }) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=two-wheeler`;
const FAIL_REASONS: [string, string][] = [["NOBODY_PRESENT", "Nobody there"], ["ADDRESS_WRONG", "Wrong address"], ["REFUSED", "Customer refused"], ["UNSAFE", "Not safe"], ["WRONG_RECIPIENT", "Wrong person"]];

function jobPins(job: Job, me: Pos | null): MapPin[] {
  return [
    { lat: job.pickup.lat, lng: job.pickup.lng, kind: "kitchen", label: "🍲", title: job.pickup.name },
    ...(job.drop ? [{ lat: job.drop.lat, lng: job.drop.lng, kind: "drop" as const, label: "📍", title: job.drop.customer ?? "Customer" }] : []),
    ...(me ? [{ lat: me.lat, lng: me.lng, kind: "me" as const, label: "Me", title: "You" }] : []),
  ];
}
function jobRoutes(job: Job, me: Pos | null, toKitchen: boolean) {
  const r = [] as { from: Pos; to: Pos; done?: boolean }[];
  if (me && toKitchen) r.push({ from: me, to: job.pickup });
  if (job.drop) r.push({ from: toKitchen ? job.pickup : me ?? job.pickup, to: job.drop });
  return r;
}

function chime() {
  try {
    const ctx = new AudioContext();
    const t = ctx.currentTime;
    [660, 990, 1320].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; g.gain.setValueAtTime(0.0001, t + i * 0.15);
      g.gain.exponentialRampToValueAtTime(0.4, t + i * 0.15 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.15 + 0.14);
      o.connect(g).connect(ctx.destination); o.start(t + i * 0.15); o.stop(t + i * 0.15 + 0.15);
    });
  } catch { /* no audio */ }
}
async function sha256(file: File) {
  const d = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return `sha256:${[...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function RiderApp() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [jobs, setJobs] = useState<Jobs | null>(null);
  const [notRider, setNotRider] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const watch = useRef<number | null>(null);
  const lastSent = useRef<{ at: number; pos: Pos } | null>(null);
  const lastOffer = useRef<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => { setSignedIn(!!getSession()); }, []);

  const load = useCallback(async () => {
    try {
      const j = await api<Jobs>("/v1/rider/jobs");
      setJobs(j); setError(null);
      if (j.offer && j.offer.id !== lastOffer.current) {
        lastOffer.current = j.offer.id;
        chime();
        navigator.vibrate?.([300, 120, 300, 120, 300]);
      }
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 403) setNotRider(true);
      else if (err.status === 401) setSignedIn(false);
      else setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (!signedIn || !live()) return;
    void load();
    const t = setInterval(load, 4000);
    const c = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(t); clearInterval(c); };
  }, [signedIn, load]);

  // While online, share position: every 15 s, or sooner after moving 50 m.
  const send = useCallback(async (p: Pos, online = true) => {
    lastSent.current = { at: Date.now(), pos: p };
    try { await api("/v1/rider/presence", { method: "POST", body: { online, lat: p.lat, lng: p.lng } }); } catch (e) { setError((e as ApiError).message); }
  }, []);
  const startGps = useCallback(() => {
    if (!navigator.geolocation) { setGpsError("This phone has no GPS available to the browser."); return; }
    if (watch.current !== null) return;
    watch.current = navigator.geolocation.watchPosition(
      (g) => {
        const p = { lat: g.coords.latitude, lng: g.coords.longitude };
        setPos(p); setGpsError(null);
        const l = lastSent.current;
        const moved = l ? Math.hypot((p.lat - l.pos.lat) * 111_000, (p.lng - l.pos.lng) * 111_000) : Infinity;
        if (!l || Date.now() - l.at > 15_000 || moved > 50) void send(p);
      },
      () => setGpsError("Turn on location for this site so we can send you nearby jobs."),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
  }, [send]);
  const stopGps = () => { if (watch.current !== null) navigator.geolocation.clearWatch(watch.current); watch.current = null; };
  useEffect(() => { if (jobs?.presence.online) startGps(); }, [jobs?.presence.online, startGps]);
  useEffect(() => () => stopGps(), []);

  const goOnline = async () => {
    setBusy(true); setError(null);
    if (!navigator.geolocation) { setGpsError("No GPS available."); setBusy(false); return; }
    navigator.geolocation.getCurrentPosition(async (g) => {
      const p = { lat: g.coords.latitude, lng: g.coords.longitude };
      setPos(p);
      await send(p, true);
      startGps();
      try { await (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<unknown> } }).wakeLock?.request("screen"); } catch { /* optional */ }
      await load(); setBusy(false);
    }, () => { setGpsError("Turn on location for this site to go online."); setBusy(false); }, { enableHighAccuracy: true, timeout: 20_000 });
  };
  const goOffline = async () => {
    setBusy(true);
    try { await api("/v1/rider/presence", { method: "POST", body: { online: false } }); stopGps(); await load(); } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  const answer = async (accept: boolean) => {
    if (!jobs?.offer) return;
    setBusy(true);
    try { await api(`/v1/rider/offers/${jobs.offer.id}/${accept ? "accept" : "decline"}`, { method: "POST", body: {} }); await load(); }
    catch (e) { setError((e as ApiError).message); await load(); } finally { setBusy(false); }
  };

  if (!live()) return <Frame><div className="r-card"><h1>Ride with Tunakula</h1><p>The rider app opens at launch.</p><Link className="r-btn" href="/riders/">How riding works</Link></div></Frame>;
  if (signedIn === null) return <Frame><div className="skeleton-line" /></Frame>;
  if (!signedIn) return <Frame><div className="r-card"><h1>Rider sign-in</h1><p>Use the phone number Tunakula registered for you.</p><Link className="r-btn go" href="/signin/?next=/rider/">Sign in with my phone</Link></div></Frame>;
  if (notRider) return <Frame><div className="r-card"><h1>Not a rider yet</h1><p>This number is not registered as a rider. Your fleet or Tunakula operations adds you after the checks.</p><Link className="r-btn go" href="/riders/apply/">Apply to ride</Link><button type="button" className="r-link" onClick={() => { setSession(null); window.location.reload(); }}>Use another number</button></div></Frame>;
  if (!jobs) return <Frame><div className="skeleton-line" /></Frame>;

  const job = jobs.active[0];
  const offer = jobs.offer;
  const left = offer ? Math.max(0, Math.round((Date.parse(offer.expires_at) - now) / 1000)) : 0;
  return (
    <Frame online={jobs.presence.online} onToggle={jobs.presence.online ? goOffline : goOnline} busy={busy} canGoOffline={!job}>
      {error ? <p className="r-error" role="alert">{error}</p> : null}
      {gpsError ? <p className="r-error" role="alert">{gpsError}</p> : null}

      {offer && left > 0 ? (
        <div className="r-offer" role="alertdialog" aria-label="New delivery offer">
          <div className="r-ring" style={{ ["--p" as string]: `${(left / 30) * 100}%` }}><b>{left}</b><small>s</small></div>
          <p className="r-label">You earn</p>
          <p className="r-earn">{money(offer.earnings)}</p>
          <TileMap height={150} pins={jobPins(offer.job, pos)} routes={jobRoutes(offer.job, pos, true)} />
          <div className="r-legs">
            <div><span className="dot a" /><b>{offer.job.pickup.name}</b><small>{offer.pickup_km} km to the kitchen · {offer.job.pickup.commune ?? ""}</small></div>
            <div><span className="dot b" /><b>Customer</b><small>{offer.drop_km} km to deliver · {offer.job.items} item{offer.job.items > 1 ? "s" : ""}</small></div>
          </div>
          {offer.job.collect ? <p className="r-cash">Collect {money(offer.job.collect)} in cash</p> : null}
          <div className="r-actions">
            <button type="button" className="r-btn ghost" disabled={busy} onClick={() => answer(false)}>No thanks</button>
            <button type="button" className="r-btn go" disabled={busy} onClick={() => answer(true)}>Accept</button>
          </div>
          <p className="r-small">Saying no never lowers your rank or your jobs.</p>
        </div>
      ) : job ? (
        <ActiveJob job={job} pos={pos} onDone={load} />
      ) : jobs.presence.online ? (
        <div className="r-card r-waiting">
          <div className="r-radar" aria-hidden><span /><span /><span /></div>
          <h1>You are online</h1>
          <p>Stay near busy kitchens. A job appears here with a sound, and you have 30 seconds to say yes or no.</p>
        </div>
      ) : (
        <div className="r-card">
          <h1>You are offline</h1>
          <p>Go online when you are ready to ride. We only share your position while you are online or carrying an order.</p>
          <button type="button" className="r-btn go" onClick={goOnline} disabled={busy}>Go online</button>
        </div>
      )}

      <div className="r-stats">
        <div><small>Today</small><b>{money(jobs.today.earnings)}</b><span>{jobs.today.deliveries} deliver{jobs.today.deliveries === 1 ? "y" : "ies"}</span></div>
        <div><small>Cash in hand</small><b>{money(jobs.cash_in_hand)}</b><span>hand in at the hub</span></div>
      </div>
    </Frame>
  );
}

function Frame({ children, online, onToggle, busy, canGoOffline = true }: { children: React.ReactNode; online?: boolean; onToggle?: () => void; busy?: boolean; canGoOffline?: boolean }) {
  return (
    <div className="r-app">
      <header className="r-top">
        <Link href="/" className="r-logo"><img src="/brand/tunakula-logo.jpg" alt="Tunakula" width={40} height={40} /><span>Rider</span></Link>
        {onToggle ? (
          <button type="button" className={`r-switch ${online ? "on" : ""}`} onClick={onToggle} disabled={busy || (online && !canGoOffline)} aria-pressed={!!online} title={online && !canGoOffline ? "Finish your delivery first" : undefined}>
            <span className="knob" />{online ? "Online" : "Offline"}
          </button>
        ) : null}
      </header>
      <main className="r-main">{children}</main>
    </div>
  );
}

function ActiveJob({ job, pos, onDone }: { job: Job; pos: Pos | null; onDone: () => Promise<void> }) {
  const [scanned, setScanned] = useState<Set<string>>(new Set());
  const [typed, setTyped] = useState("");
  const [code, setCode] = useState("");
  const [photo, setPhoto] = useState<{ ref: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState(FAIL_REASONS[0]![0]);
  const [farReason, setFarReason] = useState("");
  const atKitchen = job.state !== "PICKED_UP";
  const ready = job.state === "READY";

  const act = async (command: Record<string, unknown>) => {
    setBusy(true); setError(null);
    try { await api(`/v1/orders/${job.order_id}/transitions`, { method: "POST", body: { command } }); setCode(""); setPhoto(null); await onDone(); }
    catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  const addTyped = () => {
    const t = typed.trim().toUpperCase();
    if (!t) return;
    if (!job.labels.includes(t)) { setError(`${t} is not a bag of this order — check the label`); return; }
    setScanned(new Set([...scanned, t])); setTyped(""); setError(null);
  };
  const here = pos ?? job.pickup;

  return (
    <div className="r-job">
      <div className="r-job-head">
        <span className="r-ref">#{job.ref}</span>
        <span className="r-phase">{atKitchen ? "Go to the kitchen" : "Deliver to the customer"}</span>
        {job.earnings ? <span className="r-earn-sm">{money(job.earnings)}</span> : null}
      </div>
      <TileMap height={210} pins={jobPins(job, pos)} routes={jobRoutes(job, pos, job.state !== "PICKED_UP")} />
      <ol className="r-steps">
        <li className={atKitchen ? "now" : "done"}>Pick up at {job.pickup.name}</li>
        <li className={atKitchen ? "" : "now"}>Deliver{job.drop?.customer ? ` to ${job.drop.customer}` : ""}</li>
      </ol>

      {atKitchen ? (
        <div className="r-card">
          <h2>{job.pickup.name}</h2>
          <p className="r-sub">{job.pickup.commune ?? "Kinshasa"} · {job.items} item{job.items > 1 ? "s" : ""}</p>
          <a className="r-btn nav" href={nav(job.pickup)} target="_blank" rel="noreferrer">Navigate to the kitchen</a>
          {!ready ? (
            <p className="r-wait">The kitchen is {job.state === "PLACED" ? "confirming" : "cooking"}. Bags appear here when they are ready.</p>
          ) : (
            <>
              <h3>Check every bag</h3>
              <p className="r-sub">Type the code on each bag label (it starts with L-).</p>
              <ul className="r-bags">{job.labels.map((l) => <li key={l} className={scanned.has(l) ? "ok" : ""}>{scanned.has(l) ? "✓" : "○"} {l}</li>)}</ul>
              <div className="r-row">
                <input className="r-input" placeholder="L-XXXXX-1" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addTyped(); }} autoCapitalize="characters" />
                <button type="button" className="r-btn ghost" onClick={addTyped}>Add</button>
              </div>
              <button type="button" className="r-btn go" disabled={busy || scanned.size !== job.labels.length}
                onClick={() => act({ type: "PICK_UP", scannedLabelIds: [...scanned], restaurantConfirmed: true, sealsIntact: true, location: { lat: here.lat, lng: here.lng } })}>
                {scanned.size === job.labels.length ? "Picked up — seals intact" : `${scanned.size} of ${job.labels.length} bags checked`}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="r-card">
          <h2>{job.drop?.customer ?? "Customer"}</h2>
          {job.drop?.note ? <p className="r-note">“{job.drop.note}”</p> : null}
          {job.drop ? <a className="r-btn nav" href={nav(job.drop)} target="_blank" rel="noreferrer">Navigate to the customer</a> : null}
          {job.collect ? <p className="r-cash">Collect {money(job.collect)} in cash before you hand over</p> : null}
          {!failing ? (
            <>
              <h3>Customer's 4-digit code</h3>
              <input className="r-input code" inputMode="numeric" maxLength={4} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="0000" />
              <label className="r-photo">
                <input type="file" accept="image/*" capture="environment" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPhoto({ ref: await sha256(f), url: URL.createObjectURL(f) }); }} />
                {photo ? <img src={photo.url} alt="Proof of delivery" /> : <span>📷 Photo at the door (optional)</span>}
              </label>
              {error?.includes("from the drop point") ? <input className="r-input" placeholder="Why are you not at the pin? (e.g. gate closed, met at the corner)" value={farReason} onChange={(e) => setFarReason(e.target.value)} /> : null}
              <button type="button" className="r-btn go" disabled={busy || code.length !== 4 || !pos}
                onClick={() => act({ type: "DELIVER", scannedLabelId: job.labels[0], location: pos, verification: { method: "CODE", code }, sealIntact: true, ...(photo ? { proofPhotoRef: photo.ref } : {}), ...(farReason.trim() ? { outsideGeofenceReason: farReason.trim() } : {}) })}>
                {pos ? "Delivered" : "Waiting for GPS…"}
              </button>
              <button type="button" className="r-link" onClick={() => setFailing(true)}>Can't deliver?</button>
            </>
          ) : (
            <>
              <h3>Why can't you deliver?</h3>
              <div className="r-reasons">{FAIL_REASONS.map(([k, l]) => <button type="button" key={k} className={reason === k ? "on" : ""} onClick={() => setReason(k)}>{l}</button>)}</div>
              <label className="r-photo">
                <input type="file" accept="image/*" capture="environment" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPhoto({ ref: await sha256(f), url: URL.createObjectURL(f) }); }} />
                {photo ? <img src={photo.url} alt="Evidence" /> : <span>📷 Photo of the place (required)</span>}
              </label>
              <button type="button" className="r-btn danger" disabled={busy || !photo} onClick={() => act({ type: "FAIL_DELIVERY", reason, evidenceRefs: [photo!.ref] })}>Report failed delivery</button>
              <button type="button" className="r-link" onClick={() => setFailing(false)}>Back</button>
            </>
          )}
        </div>
      )}
      {error ? <p className="r-error" role="alert">{error}</p> : null}
    </div>
  );
}
