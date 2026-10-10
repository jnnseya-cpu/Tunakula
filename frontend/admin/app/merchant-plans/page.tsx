"use client";
/**
 * Merchant subscription plans. Tunakula charges every merchant 0% commission; this screen lets a market admin offer
 * optional paid plans (billed monthly, netted from the merchant's payout) that unlock perks like featured placement,
 * and put each restaurant group on a plan. The default plan is FREE — no fee, no perks — so a merchant is unaffected
 * until moved onto a paid one. The platform never deducts a commission from a sale.
 */
import { useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api } from "../../lib/api";
import { minorToDecimal, money } from "../../lib/format";

interface MoneyWire { amount_minor: string; currency: string }
interface Plan { id: string; code: string; name: string; monthly_fee: MoneyWire; featured: boolean; active: boolean; sort: number }
interface Merchant { group_id: string; name: string; plan_code: string; plan_name: string; branches: number }
interface Overview { plans: Plan[]; merchants: Merchant[] }

const BLANK = { code: "", name: "", monthly_fee: "", featured: false, active: true, sort: "0" };

export default function MerchantPlansPage() {
  return <Shell title="merchantPlans"><Gate cap="merchant_plans"><MerchantPlans /></Gate></Shell>;
}

function MerchantPlans() {
  const { country, lang } = useConsole();
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const m = (w: MoneyWire) => money(lang, w.amount_minor, w.currency);
  const [data, setData] = useState<Overview | null>(null);
  const [form, setForm] = useState({ ...BLANK });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api<Overview>("/v1/admin/merchant-plans", { country }).then((d) => { setData(d); setError(null); }).catch((e: Error) => setError(e.message));
  useEffect(() => { setData(null); void load(); }, [country]); // eslint-disable-line react-hooks/exhaustive-deps

  const savePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api("/v1/admin/merchant-plans", { method: "POST", country, body: { code: form.code, name: form.name, monthly_fee: form.monthly_fee || "0", featured: form.featured, active: form.active, sort: Number(form.sort) || 0 } });
      setNotice(L("Forfait enregistré.", "Plan saved.")); setForm({ ...BLANK }); void load();
    } catch (err) { setNotice((err as Error).message); }
  };
  const editPlan = (p: Plan) => setForm({ code: p.code, name: p.name, monthly_fee: p.monthly_fee.amount_minor === "0" ? "" : minorToDecimal(p.monthly_fee.amount_minor, p.monthly_fee.currency), featured: p.featured, active: p.active, sort: String(p.sort) });
  const assign = async (groupId: string, planCode: string) => {
    try { await api("/v1/admin/merchant-plans/assign", { method: "POST", country, body: { group_id: groupId, plan_code: planCode } }); void load(); }
    catch (err) { setNotice((err as Error).message); }
  };

  if (error) return <div className="card"><p className="muted">{error}</p></div>;
  if (!data) return <div className="card"><p className="muted">{L("Chargement…", "Loading…")}</p></div>;
  const planOptions = [{ code: "FREE", name: L("Gratuit — 0 %", "Free — 0%") }, ...data.plans.filter((p) => p.active && p.code !== "FREE").map((p) => ({ code: p.code, name: p.name }))];

  return (
    <div className="mplans">
      <div className="scope-note">{L("Tunakula reste à 0 % de commission pour tous. Les forfaits payants sont optionnels et facturés mensuellement, déduits du décaissement.", "Tunakula stays 0% commission for everyone. Paid plans are optional, billed monthly and netted from the payout.")}</div>

      <section className="card">
        <div className="card-head"><div><h2>{L("Forfaits du marché", "Market plans")}</h2><p>{L("Définissez des forfaits optionnels. Le forfait FREE (0 $, aucun avantage) est implicite.", "Define optional plans. The FREE plan (0, no perks) is implicit.")}</p></div></div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{L("Code", "Code")}</th><th>{L("Nom", "Name")}</th><th className="num">{L("Frais / mois", "Fee / month")}</th><th>{L("Avantages", "Perks")}</th><th>{L("Statut", "Status")}</th><th></th></tr></thead>
            <tbody>
              {data.plans.length === 0 ? <tr><td colSpan={6} className="muted">{L("Aucun forfait payant. Seul FREE (0 %) est actif.", "No paid plans yet. Only FREE (0%) is active.")}</td></tr> : data.plans.map((p) => (
                <tr key={p.id}>
                  <td className="num">{p.code}</td><td><b>{p.name}</b></td><td className="num">{m(p.monthly_fee)}</td>
                  <td>{p.featured ? <span className="pill good">★ {L("En vedette", "Featured")}</span> : <span className="muted">—</span>}</td>
                  <td><span className={`pill ${p.active ? "good" : "warning"}`}>{p.active ? L("Actif", "Active") : L("Inactif", "Inactive")}</span></td>
                  <td><button type="button" className="btn ghost sm" onClick={() => editPlan(p)}>{L("Modifier", "Edit")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="filters" onSubmit={savePlan} style={{ marginTop: 12 }}>
          <input className="input" required placeholder={L("Code (ex. GROWTH)", "Code (e.g. GROWTH)")} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} style={{ width: 160 }} />
          <input className="input" required placeholder={L("Nom", "Name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input" inputMode="decimal" placeholder={L("Frais/mois", "Fee/month")} value={form.monthly_fee} onChange={(e) => setForm({ ...form, monthly_fee: e.target.value })} style={{ width: 120 }} />
          <label className="chk"><input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} /> {L("En vedette", "Featured")}</label>
          <label className="chk"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> {L("Actif", "Active")}</label>
          <button className="btn primary" type="submit">{L("Enregistrer le forfait", "Save plan")}</button>
          {form.code ? <button className="btn ghost" type="button" onClick={() => setForm({ ...BLANK })}>{L("Annuler", "Cancel")}</button> : null}
        </form>
        {notice ? <div className="banner" style={{ marginTop: 10 }}>{notice}</div> : null}
      </section>

      <section className="card">
        <div className="card-head"><div><h2>{L("Forfait par commerçant", "Plan per merchant")}</h2><p>{L("Choisissez le forfait de chaque groupe. Par défaut : FREE.", "Choose each group's plan. Default: FREE.")}</p></div></div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{L("Groupe", "Group")}</th><th className="num">{L("Établissements", "Branches")}</th><th>{L("Forfait", "Plan")}</th></tr></thead>
            <tbody>
              {data.merchants.length === 0 ? <tr><td colSpan={3} className="muted">{L("Aucun commerçant.", "No merchants.")}</td></tr> : data.merchants.map((g) => (
                <tr key={g.group_id}>
                  <td><b>{g.name}</b></td>
                  <td className="num">{g.branches}</td>
                  <td>
                    <select className="select" value={g.plan_code} onChange={(e) => assign(g.group_id, e.target.value)}>
                      {planOptions.concat(planOptions.some((o) => o.code === g.plan_code) ? [] : [{ code: g.plan_code, name: g.plan_name }]).map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
