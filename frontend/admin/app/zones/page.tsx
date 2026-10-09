"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api } from "../../lib/api";
import { money } from "../../lib/format";

interface Config { money: { currencies: { settlement: string } } }
interface Branch { id: string; name: string; status: string }
interface Zone { id: string; name: string; centre_lat: number; centre_lng: number; radius_m: number; flat_fee_minor: string | null; min_order_minor: string | null; active: boolean }
interface BranchProfile { lat: number; lng: number }
const BLANK = { name: "", centre_lat: "", centre_lng: "", radius_km: "3", flat_fee: "", min_order: "" };

export default function ZonesPage() {
  return <Shell title="zones"><Gate cap="catalogue"><Zones /></Gate></Shell>;
}

function Zones() {
  const { country, lang } = useConsole();
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [branchId, setBranchId] = useState("");
  const [branchLoc, setBranchLoc] = useState<BranchProfile | null>(null);
  const [zones, setZones] = useState<Zone[] | null>(null);
  const [settlement, setSettlement] = useState("USD");
  const [form, setForm] = useState({ ...BLANK });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("branch");
    api<{ data: Branch[] }>("/v1/admin/branches", { country })
      .then((r) => { setBranches(r.data); const pick = (wanted && r.data.some((b) => b.id === wanted)) ? wanted : r.data[0]?.id; if (pick) setBranchId((b) => b || pick); })
      .catch((e: Error) => setError(e.message));
    api<Config>(`/v1/countries/${country}/config`, { country }).then((c) => setSettlement(c.money.currencies.settlement)).catch(() => undefined);
  }, [country]);

  const load = useCallback(() => {
    if (!branchId) return;
    api<{ zones: Zone[] }>(`/v1/branches/${branchId}/delivery-zones/manage`, { country }).then((r) => { setZones(r.zones); setError(null); }).catch((e: Error) => setError(e.message));
    api<{ branch: BranchProfile }>(`/v1/branches/${branchId}/menu`, { country }).then((r) => setBranchLoc({ lat: r.branch.lat, lng: r.branch.lng })).catch(() => setBranchLoc(null));
  }, [branchId, country]);
  useEffect(() => { void load(); }, [load]);

  const fee = (minor: string | null) => (minor === null ? L("Barème distance", "Distance ladder") : money(lang, minor, settlement));
  const min = (minor: string | null) => (minor === null ? "—" : money(lang, minor, settlement));

  const centreOnBranch = () => { if (branchLoc) setForm({ ...form, centre_lat: String(branchLoc.lat), centre_lng: String(branchLoc.lng) }); };

  const create = async () => {
    const body = {
      name: form.name.trim(),
      centre_lat: Number(form.centre_lat), centre_lng: Number(form.centre_lng),
      radius_m: Math.round((Number(form.radius_km) || 0) * 1000),
      ...(form.flat_fee.trim() ? { flat_fee: form.flat_fee.trim() } : {}),
      ...(form.min_order.trim() ? { min_order: form.min_order.trim() } : {}),
    };
    try { await api(`/v1/branches/${branchId}/delivery-zones`, { method: "POST", country, body }); setNotice(L("Zone ajoutée.", "Zone added.")); setForm({ ...BLANK }); load(); }
    catch (e) { setNotice((e as Error).message); }
  };
  const toggle = async (z: Zone) => { try { await api(`/v1/branches/${branchId}/delivery-zones/${z.id}`, { method: "POST", country, body: { active: !z.active } }); load(); } catch (e) { setNotice((e as Error).message); } };
  const remove = async (z: Zone) => { try { await api(`/v1/branches/${branchId}/delivery-zones/${z.id}`, { method: "DELETE", country }); load(); } catch (e) { setNotice((e as Error).message); } };

  const hasZones = useMemo(() => (zones ?? []).some((z) => z.active), [zones]);

  if (error && !branches) return <div className="banner error">{error}</div>;
  return (
    <>
      <div className="scope-note">{L("Définissez les quartiers que chaque établissement livre. Sans zone, l'établissement livre partout au tarif distance. Avec des zones, une adresse hors de toute zone active est refusée, et chaque zone peut fixer un tarif forfaitaire et un minimum de commande.", "Define the areas each branch delivers to. With no zones, a branch delivers everywhere at the distance rate. With zones, a drop outside every active zone is refused, and each zone can set a flat fee and an order minimum.")}</div>
      {notice ? <div className="banner">{notice}</div> : null}

      <section className="card">
        <div className="card-head">
          <div><h2>{L("Zones de livraison", "Delivery zones")}</h2><p>{hasZones ? L("Livraison limitée aux zones actives", "Delivery limited to the active zones") : L("Livraison partout (barème distance)", "Delivers everywhere (distance ladder)")}</p></div>
          <label className="field inline">{L("Établissement", "Branch")}
            <select className="select" value={branchId} onChange={(e) => { setBranchId(e.target.value); setZones(null); }}>
              {(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{L("Zone", "Zone")}</th><th className="num">{L("Rayon", "Radius")}</th><th>{L("Tarif livraison", "Delivery fee")}</th><th className="num">{L("Min. commande", "Order min")}</th><th>{L("Actif", "Active")}</th><th></th></tr></thead>
            <tbody>
              {zones?.map((z) => (
                <tr key={z.id} className={z.active ? "" : "muted-row"}>
                  <td><b>{z.name}</b><br /><small className="muted">{z.centre_lat.toFixed(4)}, {z.centre_lng.toFixed(4)}</small></td>
                  <td className="num">{(z.radius_m / 1000).toFixed(z.radius_m % 1000 ? 1 : 0)} km</td>
                  <td>{fee(z.flat_fee_minor)}</td>
                  <td className="num">{min(z.min_order_minor)}</td>
                  <td><button className="link-btn" type="button" onClick={() => toggle(z)}>{z.active ? "✓" : "—"}</button></td>
                  <td><button className="link-btn danger" type="button" onClick={() => remove(z)}>{L("Supprimer", "Delete")}</button></td>
                </tr>
              ))}
              {zones && zones.length === 0 ? <tr><td colSpan={6} className="muted">{L("Aucune zone — l'établissement livre partout.", "No zones — this branch delivers everywhere.")}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><div><h2>{L("Nouvelle zone", "New zone")}</h2></div></div>
        <div className="form-grid">
          <label>{L("Nom", "Name")}<input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={L("Gombe centre", "Gombe centre")} /></label>
          <label>{L("Latitude du centre", "Centre latitude")}<input className="input" inputMode="decimal" value={form.centre_lat} onChange={(e) => setForm({ ...form, centre_lat: e.target.value })} placeholder="-4.3125" /></label>
          <label>{L("Longitude du centre", "Centre longitude")}<input className="input" inputMode="decimal" value={form.centre_lng} onChange={(e) => setForm({ ...form, centre_lng: e.target.value })} placeholder="15.2847" /></label>
          <label>{L("Rayon (km)", "Radius (km)")}<input className="input" inputMode="decimal" value={form.radius_km} onChange={(e) => setForm({ ...form, radius_km: e.target.value })} /></label>
          <label>{L("Tarif forfaitaire (optionnel)", "Flat fee (optional)")}<input className="input" inputMode="decimal" value={form.flat_fee} onChange={(e) => setForm({ ...form, flat_fee: e.target.value })} placeholder={L("sinon barème distance", "else distance ladder")} /></label>
          <label>{L("Minimum de commande (optionnel)", "Order minimum (optional)")}<input className="input" inputMode="decimal" value={form.min_order} onChange={(e) => setForm({ ...form, min_order: e.target.value })} /></label>
        </div>
        <div className="card-foot">
          <button className="btn ghost" type="button" disabled={!branchLoc} onClick={centreOnBranch}>{L("Centrer sur l'établissement", "Centre on branch")}</button>
          <button className="btn primary" type="button" disabled={!form.name.trim() || !form.centre_lat || !form.centre_lng} onClick={create}>{L("Ajouter la zone", "Add zone")}</button>
        </div>
      </section>
    </>
  );
}
