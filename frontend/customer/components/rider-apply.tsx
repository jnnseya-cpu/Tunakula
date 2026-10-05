"use client";
/**
 * Apply to ride (/riders/apply): phone sign-in, details, ID and selfie photos taken with the phone camera
 * (shrunk on the phone before upload, so it works on 3G), then automatic checks and a person's review.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError, getSession, live } from "../lib/api";

interface Check { code: string; ok: boolean; detail: string }
interface Application { id: string; status: "PENDING" | "APPROVED" | "REJECTED"; zones: string[]; created_at: string; decision_note: string | null }
type Photo = { blob: Blob; url: string };

const ID_TYPES: [string, string, string][] = [
  ["VOTER_CARD", "Voter card", "Digits only"],
  ["NATIONAL_ID", "National ID", "Letters and digits"],
  ["PASSPORT", "Passport", "e.g. OP1234567"],
  ["DRIVING_LICENCE", "Driving licence", "Letters and digits"],
];
const VEHICLES: [string, string][] = [["MOTO", "Motorbike"], ["BICYCLE", "Bicycle"], ["CAR", "Car"], ["FOOT", "On foot"]];
const CHECK_LABEL: Record<string, string> = { AGE: "Age 18 or over", ID_FORMAT: "ID number format", PHOTOS: "ID and selfie", PHOTOS_DISTINCT: "Selfie is a separate photo", DUPLICATE_ID: "ID not used by someone else", LICENCE: "Licence and plate" };

/** Shrinks a camera photo to at most 1280 px and ~450 kB of JPEG, so it uploads on a slow connection. */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  for (const q of [0.8, 0.65, 0.5, 0.4]) {
    const b = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", q));
    if (b && b.size <= 450_000) return b;
  }
  throw new Error("This photo is too large even after shrinking; try again closer, in good light.");
}
const toBase64 = async (b: Blob) => {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

function PhotoField({ label, hint, capture, value, onChange }: { label: string; hint: string; capture: "user" | "environment"; value: Photo | null; onChange: (p: Photo | null) => void }) {
  const [err, setErr] = useState<string | null>(null);
  return (
    <label className="ap-photo">
      <input type="file" accept="image/*" capture={capture} onChange={async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        try { setErr(null); const blob = await shrink(f); onChange({ blob, url: URL.createObjectURL(blob) }); } catch (x) { setErr((x as Error).message); onChange(null); }
      }} />
      {value ? <img src={value.url} alt={label} /> : <span className="ap-ph">📷</span>}
      <span className="ap-txt"><b>{label}</b><small>{err ?? hint}</small></span>
    </label>
  );
}

export function RiderApply() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [mine, setMine] = useState<{ is_rider: boolean; data: Application[] } | null>(null);
  const [communes, setCommunes] = useState<string[]>([]);
  const [f, setF] = useState({ full_name: "", date_of_birth: "", vehicle: "MOTO", plate: "", id_type: "VOTER_CARD", id_number: "" });
  const [zones, setZones] = useState<string[]>([]);
  const [idPhoto, setIdPhoto] = useState<Photo | null>(null);
  const [selfie, setSelfie] = useState<Photo | null>(null);
  const [licence, setLicence] = useState<Photo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const motor = f.vehicle === "MOTO" || f.vehicle === "CAR";

  useEffect(() => { setSignedIn(!!getSession()); }, []);
  useEffect(() => {
    if (!signedIn || !live()) return;
    api<{ is_rider: boolean; data: Application[] }>("/v1/rider-applications/mine").then(setMine).catch(() => setMine({ is_rider: false, data: [] }));
    api<{ data: { commune: string | null }[] }>("/v1/branches/nearby?lat=-4.33&lng=15.31&radius_km=50&limit=100", { auth: false })
      .then((r) => setCommunes([...new Set(r.data.map((b) => b.commune).filter((c): c is string => !!c))].sort()))
      .catch(() => undefined);
  }, [signedIn]);

  if (!live()) return <div className="app-card"><h1 className="app-title">Apply to ride</h1><p className="muted">Applications open at launch.</p></div>;
  if (signedIn === null) return <div className="skeleton-line" />;
  if (!signedIn) return (
    <div className="app-card">
      <h1 className="app-title">Ride with Tunakula</h1>
      <p className="muted">Apply in five minutes with your phone, your ID and a selfie. See what you earn before every job; paid the same day.</p>
      <Link className="btn accent" href="/signin/?next=/riders/apply/">Start with my phone number</Link>
    </div>
  );
  if (!mine) return <div className="skeleton-line" />;
  if (mine.is_rider) return <div className="app-card"><h1 className="app-title">You are a Tunakula rider</h1><p className="muted">Open the rider app and go online when you are ready.</p><Link className="btn accent" href="/rider/">Open the rider app</Link></div>;
  const open = mine.data.find((a) => a.status === "PENDING");
  const last = mine.data[0];
  if (open) return (
    <div className="app-card ap-status">
      <span className="ap-badge pending">Being reviewed</span>
      <h1 className="app-title">Thank you — we are checking your documents</h1>
      <p className="muted">Applied for {open.zones.join(", ")}. A member of the operations team compares your ID and selfie, usually the same day. You will be able to go online as soon as you are approved.</p>
      {checks ? <ul className="ap-checks">{checks.map((c) => <li key={c.code} className={c.ok ? "ok" : "flag"}>{c.ok ? "✓" : "!"} {CHECK_LABEL[c.code] ?? c.code}{c.ok ? "" : ` — ${c.detail}`}</li>)}</ul> : null}
    </div>
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setChecks(null);
    if (!idPhoto || !selfie || (motor && !licence)) { setError("Add the photos asked for below."); return; }
    try {
      const up = async (p: Photo, purpose: string) => (await api<{ id: string }>("/v1/media", { method: "POST", body: { purpose, content_type: "image/jpeg", data_base64: await toBase64(p.blob) } })).id;
      setBusy("Sending your ID…"); const id = await up(idPhoto, "RIDER_ID");
      setBusy("Sending your selfie…"); const sf = await up(selfie, "RIDER_SELFIE");
      const lic = motor && licence ? (setBusy("Sending your licence…"), await up(licence, "RIDER_LICENCE")) : undefined;
      setBusy("Checking…");
      const r = await api<{ status: string; checks: Check[] }>("/v1/rider-applications", { method: "POST", body: { ...f, plate: motor ? f.plate : undefined, zones, id_photo: id, selfie: sf, ...(lic ? { licence_photo: lic } : {}) } });
      setChecks(r.checks);
      setMine(await api("/v1/rider-applications/mine"));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) { setError((err as ApiError).message); } finally { setBusy(null); }
  };

  return (
    <form className="apply" onSubmit={submit}>
      <div className="ap-hero">
        <h1 className="app-title">Apply to ride</h1>
        <p className="muted">Your details are checked automatically, then by a person. Documents are private: only the review team sees them.</p>
        {last?.status === "REJECTED" ? <p className="form-notice">Your last application was not approved: “{last.decision_note}”. You can apply again.</p> : null}
      </div>

      <section className="co-sec">
        <h2>About you</h2>
        <label className="field"><span>Full name, as on your ID</span><input required autoComplete="name" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></label>
        <label className="field"><span>Date of birth</span><input required type="date" value={f.date_of_birth} onChange={(e) => setF({ ...f, date_of_birth: e.target.value })} /></label>
      </section>

      <section className="co-sec">
        <h2>Where and how you ride</h2>
        <div className="ap-chips" role="group" aria-label="Communes">
          {communes.map((c) => <button type="button" key={c} className={zones.includes(c) ? "on" : ""} aria-pressed={zones.includes(c)} onClick={() => setZones(zones.includes(c) ? zones.filter((z) => z !== c) : [...zones, c])}>{c}</button>)}
        </div>
        <div className="seg2 four" role="radiogroup" aria-label="Vehicle">
          {VEHICLES.map(([k, l]) => <button type="button" key={k} role="radio" aria-checked={f.vehicle === k} className={f.vehicle === k ? "on" : ""} onClick={() => setF({ ...f, vehicle: k })}>{l}</button>)}
        </div>
        {motor ? <label className="field"><span>Number plate</span><input required value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} placeholder="e.g. 1234AB01" /></label> : null}
      </section>

      <section className="co-sec">
        <h2>Your ID</h2>
        <div className="seg2 four" role="radiogroup" aria-label="ID type">
          {ID_TYPES.map(([k, l]) => <button type="button" key={k} role="radio" aria-checked={f.id_type === k} className={f.id_type === k ? "on" : ""} onClick={() => setF({ ...f, id_type: k })}>{l}</button>)}
        </div>
        <label className="field"><span>ID number <small>({ID_TYPES.find((t) => t[0] === f.id_type)?.[2]})</small></span><input required value={f.id_number} onChange={(e) => setF({ ...f, id_number: e.target.value })} /></label>
        <div className="ap-photos">
          <PhotoField label="Photo of your ID" hint="Flat, all four corners, no glare" capture="environment" value={idPhoto} onChange={setIdPhoto} />
          <PhotoField label="Selfie" hint="Your face, no hat or sunglasses" capture="user" value={selfie} onChange={setSelfie} />
          {motor ? <PhotoField label="Driving licence" hint="Front side" capture="environment" value={licence} onChange={setLicence} /> : null}
        </div>
      </section>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {checks ? <ul className="ap-checks">{checks.map((c) => <li key={c.code} className={c.ok ? "ok" : "flag"}>{c.ok ? "✓" : "!"} {CHECK_LABEL[c.code] ?? c.code}</li>)}</ul> : null}
      <button className="btn accent wide big" disabled={!!busy || zones.length === 0}>{busy ?? (zones.length ? "Send my application" : "Choose at least one commune")}</button>
      <p className="muted small">By applying you agree to the <Link href="/legal/rider-terms/">rider terms</Link>. We keep your documents only as long as the law requires.</p>
    </form>
  );
}
