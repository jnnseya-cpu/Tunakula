"use client";
import { useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api, type Money } from "../../lib/api";
import { money } from "../../lib/format";

interface Coupon {
  id: string; code: string; description: string; kind: "PERCENT" | "FIXED" | "FREE_DELIVERY";
  value_bps: number; value: Money; min_subtotal: Money; max_discount: Money;
  usage_limit: number; per_customer_limit: number; starts_at: string; ends_at: string; active: boolean;
}
const BLANK = { code: "", description: "", kind: "PERCENT" as Coupon["kind"], value_bps: "20", value_minor: "", min_subtotal_minor: "0", max_discount_minor: "0", usage_limit: "0", per_customer_limit: "1", days: "30", active: true };

export default function CouponsPage() {
  return <Shell title="coupons"><Gate cap="markets"><Coupons /></Gate></Shell>;
}

function Coupons() {
  const { country, lang } = useConsole();
  const [rows, setRows] = useState<Coupon[] | null>(null);
  const [form, setForm] = useState({ ...BLANK });
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);

  const load = () => api<{ coupons: Coupon[] }>("/v1/admin/coupons", { country }).then((r) => { setRows(r.coupons); setError(null); }).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [country]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => { setForm({ ...BLANK }); setEditing(null); };
  const edit = (c: Coupon) => {
    setEditing(c.id);
    setForm({ code: c.code, description: c.description, kind: c.kind, value_bps: String(c.value_bps || 20), value_minor: c.value.amount_minor, min_subtotal_minor: c.min_subtotal.amount_minor, max_discount_minor: c.max_discount.amount_minor, usage_limit: String(c.usage_limit), per_customer_limit: String(c.per_customer_limit), days: "30", active: c.active });
  };
  const save = async () => {
    const body = {
      code: form.code.trim().toUpperCase(), description: form.description.trim(), kind: form.kind,
      value_bps: Number(form.value_bps) || 0, value_minor: form.value_minor.trim() || "0",
      min_subtotal_minor: form.min_subtotal_minor.trim() || "0", max_discount_minor: form.max_discount_minor.trim() || "0",
      usage_limit: Number(form.usage_limit) || 0, per_customer_limit: Number(form.per_customer_limit) || 1,
      days: Number(form.days) || 30, active: form.active,
    };
    try { await api(editing ? `/v1/admin/coupons/${editing}` : "/v1/admin/coupons", { method: "POST", country, body }); setNotice(L(editing ? "Code mis à jour." : "Code créé.", editing ? "Coupon updated." : "Coupon created.")); reset(); void load(); }
    catch (e) { setNotice((e as Error).message); }
  };
  const kindLabel = (c: Coupon) => c.kind === "PERCENT" ? `${c.value_bps / 100}%` : c.kind === "FIXED" ? money(lang, c.value.amount_minor, c.value.currency) : L("Livraison offerte", "Free delivery");

  if (error) return <div className="banner error">{error}</div>;
  return (
    <>
      <div className="scope-note">{L("Codes promo appliqués au paiement. La réduction est financée par la plateforme — le marchand et le livreur sont payés en entier.", "Promo codes applied at checkout. The discount is funded by the platform — the merchant and rider are paid in full.")}</div>
      {notice ? <div className="banner">{notice}</div> : null}
      <section className="card">
        <div className="card-head"><div><h2>{L("Codes promo", "Promo codes")} · {country}</h2><p>{rows ? `${rows.length}` : "…"}</p></div></div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Code</th><th>{L("Réduction", "Discount")}</th><th className="num">{L("Min", "Min")}</th><th className="num">{L("Limite", "Limit")}</th><th>{L("Fin", "Ends")}</th><th>{L("Actif", "Active")}</th><th></th></tr></thead>
            <tbody>
              {rows?.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.code}</b>{c.description ? <><br /><small className="muted">{c.description}</small></> : null}</td>
                  <td>{kindLabel(c)}</td>
                  <td className="num">{BigInt(c.min_subtotal.amount_minor) > 0n ? money(lang, c.min_subtotal.amount_minor, c.min_subtotal.currency) : "—"}</td>
                  <td className="num">{c.usage_limit || "∞"} · {c.per_customer_limit}/{L("pers", "cust")}</td>
                  <td>{new Date(c.ends_at).toLocaleDateString()}</td>
                  <td>{c.active ? "✓" : "—"}</td>
                  <td><button className="link-btn" type="button" onClick={() => edit(c)}>{L("Modifier", "Edit")}</button></td>
                </tr>
              ))}
              {rows && rows.length === 0 ? <tr><td colSpan={7} className="muted">{L("Aucun code", "No coupons")}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><div><h2>{editing ? L("Modifier le code", "Edit coupon") : L("Nouveau code", "New coupon")}</h2></div>{editing ? <button className="btn ghost" type="button" onClick={reset}>{L("Annuler", "Cancel")}</button> : null}</div>
        <div className="form-grid">
          <label>Code<input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} placeholder="WELCOME20" /></label>
          <label>{L("Description", "Description")}<input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <label>{L("Type", "Type")}<select className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Coupon["kind"] })}><option value="PERCENT">{L("Pourcentage", "Percent")}</option><option value="FIXED">{L("Montant fixe", "Fixed amount")}</option><option value="FREE_DELIVERY">{L("Livraison offerte", "Free delivery")}</option></select></label>
          {form.kind === "PERCENT" ? <label>{L("Pourcentage (points de base)", "Percent (bps, 2000 = 20%)")}<input className="input" inputMode="numeric" value={form.value_bps} onChange={(e) => setForm({ ...form, value_bps: e.target.value.replace(/[^0-9]/g, "") })} /></label> : null}
          {form.kind === "FIXED" ? <label>{L("Montant (unités mineures)", "Amount (minor units)")}<input className="input" inputMode="numeric" value={form.value_minor} onChange={(e) => setForm({ ...form, value_minor: e.target.value.replace(/[^0-9]/g, "") })} /></label> : null}
          <label>{L("Sous-total min (unités mineures)", "Min subtotal (minor units)")}<input className="input" inputMode="numeric" value={form.min_subtotal_minor} onChange={(e) => setForm({ ...form, min_subtotal_minor: e.target.value.replace(/[^0-9]/g, "") })} /></label>
          <label>{L("Réduction max (0 = aucune)", "Max discount (0 = none)")}<input className="input" inputMode="numeric" value={form.max_discount_minor} onChange={(e) => setForm({ ...form, max_discount_minor: e.target.value.replace(/[^0-9]/g, "") })} /></label>
          <label>{L("Limite totale (0 = illimitée)", "Total uses (0 = unlimited)")}<input className="input" inputMode="numeric" value={form.usage_limit} onChange={(e) => setForm({ ...form, usage_limit: e.target.value.replace(/[^0-9]/g, "") })} /></label>
          <label>{L("Limite par client", "Per customer")}<input className="input" inputMode="numeric" value={form.per_customer_limit} onChange={(e) => setForm({ ...form, per_customer_limit: e.target.value.replace(/[^0-9]/g, "") })} /></label>
          <label>{L("Durée (jours)", "Window (days)")}<input className="input" inputMode="numeric" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value.replace(/[^0-9]/g, "") })} /></label>
          <label className="check"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />{L("Actif", "Active")}</label>
        </div>
        <div className="card-foot"><button className="btn primary" type="button" disabled={!form.code.trim()} onClick={save}>{editing ? L("Enregistrer", "Save") : L("Créer le code", "Create coupon")}</button></div>
      </section>
    </>
  );
}
