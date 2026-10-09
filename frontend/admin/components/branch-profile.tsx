"use client";
/**
 * The branch's business profile: logo, cover photo, street address, contact phone and email, an "about"
 * description per language, cuisine tags and a minimum order. Shown in the branch Details page, it is the
 * same information every storefront (and Tunakula Nzela) needs — the data the reference platforms collect.
 */
import { useEffect, useState } from "react";
import { api, fileToBase64, publicImageUrl } from "../lib/api";
import type { Lang } from "../lib/i18n";

interface Profile { address: string | null; phone: string | null; email: string | null; description: Record<string, string>; cuisines: string[]; min_order_minor: string | null; logo_id: string | null; cover_id: string | null }

const decimal = (minor: string, currency: string): string => {
  const digits = currency === "CDF" ? 0 : 2;
  if (digits === 0) return minor;
  const raw = minor.replace("-", "").padStart(digits + 1, "0");
  return `${raw.slice(0, -digits)}.${raw.slice(-digits)}`;
};

export function BusinessProfile({ branchId, country, lang, L }: { branchId: string; country: string; lang: Lang; L: (fr: string, en: string) => string }) {
  const [settlement, setSettlement] = useState("USD");
  const [form, setForm] = useState({ address: "", phone: "", email: "", desc_fr: "", desc_en: "", cuisines: "", min_order: "" });
  const [logoId, setLogoId] = useState<string | null>(null);
  const [coverId, setCoverId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api<{ money: { currencies: { settlement: string } } }>(`/v1/countries/${country}/config`, { country }).then((c) => setSettlement(c.money.currencies.settlement)).catch(() => undefined);
    api<{ branch: Profile }>(`/v1/branches/${branchId}/menu`, { country }).then(({ branch: b }) => {
      setForm({ address: b.address ?? "", phone: b.phone ?? "", email: b.email ?? "", desc_fr: b.description?.fr ?? "", desc_en: b.description?.en ?? "", cuisines: (b.cuisines ?? []).join(", "), min_order: b.min_order_minor ? decimal(b.min_order_minor, settlement) : "" });
      setLogoId(b.logo_id ?? null); setCoverId(b.cover_id ?? null);
    }).catch(() => undefined);
  }, [branchId, country]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true); setNotice(null);
    try {
      await api(`/v1/branches/${branchId}/profile`, { method: "POST", country, body: {
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        description: { ...(form.desc_fr.trim() ? { fr: form.desc_fr.trim() } : {}), ...(form.desc_en.trim() ? { en: form.desc_en.trim() } : {}) },
        cuisines: form.cuisines.split(",").map((c) => c.trim()).filter(Boolean),
        min_order: form.min_order.trim() || null,
        logo_id: logoId, cover_id: coverId,
      } });
      setNotice(L("Profil enregistré.", "Profile saved."));
    } catch (e) { setNotice((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <section className="card">
      <div className="card-head"><div><h2>{L("Profil de l'entreprise", "Business profile")}</h2><p>{L("Logo, couverture, adresse, contact et présentation — ce que voient vos clients.", "Logo, cover, address, contact and about — what your customers see.")}</p></div></div>
      <div className="bp-media">
        <ImageUpload label={L("Logo", "Logo")} purpose="BRANCH_LOGO" shape="logo" imageId={logoId} onChange={setLogoId} country={country} L={L} />
        <ImageUpload label={L("Photo de couverture", "Cover photo")} purpose="BRANCH_COVER" shape="cover" imageId={coverId} onChange={setCoverId} country={country} L={L} />
      </div>
      <div className="ff">
        <label className="wide">{L("Adresse", "Address")}<input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder={L("ex. 12 Avenue du Commerce, Gombe", "e.g. 12 Avenue du Commerce, Gombe")} /></label>
        <label>{L("Téléphone", "Phone")}<input className="input" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+243…" /></label>
        <label>{L("E-mail", "Email")}<input className="input" inputMode="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="contact@…" /></label>
        <label className="wide">{L("Présentation (FR)", "About (FR)")}<textarea className="input" rows={2} value={form.desc_fr} onChange={(e) => setForm({ ...form, desc_fr: e.target.value })} /></label>
        <label className="wide">{L("Présentation (EN)", "About (EN)")}<textarea className="input" rows={2} value={form.desc_en} onChange={(e) => setForm({ ...form, desc_en: e.target.value })} /></label>
        <label>{L("Cuisines (virgules)", "Cuisines (commas)")}<input className="input" value={form.cuisines} onChange={(e) => setForm({ ...form, cuisines: e.target.value })} placeholder={L("ex. congolais, grillades", "e.g. congolese, grills")} /></label>
        <label>{L("Commande minimum", "Minimum order")} ({settlement})<input className="input" inputMode="decimal" value={form.min_order} onChange={(e) => setForm({ ...form, min_order: e.target.value })} placeholder="0.00" /></label>
      </div>
      {notice ? <div className="banner" style={{ margin: "0 0 10px" }}>{notice}</div> : null}
      <div className="card-foot"><button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? "…" : L("Enregistrer le profil", "Save profile")}</button></div>
    </section>
  );
}

function ImageUpload({ label, purpose, shape, imageId, onChange, country, L }: { label: string; purpose: string; shape: "logo" | "cover"; imageId: string | null; onChange: (id: string | null) => void; country: string; L: (fr: string, en: string) => string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pick = async (file: File) => {
    setErr(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setErr(L("JPEG, PNG ou WebP.", "JPEG, PNG or WebP.")); return; }
    if (file.size > 600_000) { setErr(L("Max 600 Ko.", "Max 600 kB.")); return; }
    setBusy(true);
    try {
      const data_base64 = await fileToBase64(file);
      const r = await api<{ id: string }>("/v1/media", { method: "POST", country, body: { purpose, content_type: file.type, data_base64 } });
      onChange(r.id);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="bp-img">
      <span className="ff-label">{label}</span>
      {imageId ? <img className={`bp-${shape}`} src={publicImageUrl(imageId, country)} alt="" /> : <div className={`bp-${shape} empty`} aria-hidden>{shape === "logo" ? "🏪" : "🖼️"}</div>}
      <div className="bp-img-actions">
        <label className="btn ghost sm">{busy ? "…" : imageId ? L("Changer", "Change") : L("Téléverser", "Upload")}
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ""; }} />
        </label>
        {imageId ? <button type="button" className="btn ghost sm" onClick={() => onChange(null)}>{L("Retirer", "Remove")}</button> : null}
      </div>
      {err ? <p className="form-error small">{err}</p> : null}
    </div>
  );
}
