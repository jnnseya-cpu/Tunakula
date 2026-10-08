"use client";
import { useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api, type Money } from "../../lib/api";
import { money } from "../../lib/format";

interface Plan {
  id: string;
  name: string;
  description: string;
  price: Money;
  period: "MONTH" | "YEAR";
  benefits: { free_delivery: boolean; min_subtotal: Money; service_charge_off_bps: number };
  active: boolean;
  created_at: string;
  updated_at: string;
}

const BLANK = { name: "", description: "", price_minor: "", period: "MONTH", free_delivery: true, min_subtotal_minor: "0", service_charge_off_bps: "0", active: true };

export default function MembershipPage() {
  return <Shell title="membership"><Gate cap="membership"><Membership /></Gate></Shell>;
}

function Membership() {
  const { country, lang } = useConsole();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [form, setForm] = useState({ ...BLANK });
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);

  const load = () =>
    api<{ data: Plan[] }>("/v1/admin/membership/plans", { country })
      .then((r) => { setPlans(r.data); setError(null); })
      .catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [country]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => { setForm({ ...BLANK }); setEditing(null); };
  const edit = (p: Plan) => {
    setEditing(p.id);
    setForm({
      name: p.name,
      description: p.description,
      price_minor: p.price.amount_minor,
      period: p.period,
      free_delivery: p.benefits.free_delivery,
      min_subtotal_minor: p.benefits.min_subtotal.amount_minor,
      service_charge_off_bps: String(p.benefits.service_charge_off_bps),
      active: p.active,
    });
  };
  const save = async () => {
    const body = {
      name: form.name.trim(),
      description: form.description.trim(),
      price_minor: form.price_minor.trim() || "0",
      period: form.period,
      free_delivery: form.free_delivery,
      min_subtotal_minor: form.min_subtotal_minor.trim() || "0",
      service_charge_off_bps: Number(form.service_charge_off_bps) || 0,
      active: form.active,
    };
    try {
      await api(editing ? `/v1/admin/membership/plans/${editing}` : "/v1/admin/membership/plans", { method: "POST", country, body });
      setNotice(L(editing ? "Plan mis à jour." : "Plan créé.", editing ? "Plan updated." : "Plan created."));
      reset();
      void load();
    } catch (e) {
      setNotice((e as Error).message);
    }
  };

  if (error) return <div className="banner error">{error}</div>;
  return (
    <>
      <div className="scope-note">{L("L'abonnement Plus : livraison offerte et réductions, financées par le revenu d'abonnement. Le marchand et le livreur sont toujours payés en entier.", "The Plus membership: free delivery and discounts, funded from subscription revenue. The merchant and rider are always paid in full.")}</div>
      {notice ? <div className="banner">{notice}</div> : null}

      <section className="card">
        <div className="card-head"><div><h2>{L("Formules d'abonnement", "Membership plans")} · {country}</h2><p>{plans.length ? L(`${plans.length} formule(s)`, `${plans.length} plan(s)`) : L("Aucune formule", "No plans yet")}</p></div></div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{L("Nom", "Name")}</th><th>{L("Prix", "Price")}</th><th>{L("Période", "Period")}</th><th>{L("Avantages", "Benefits")}</th><th>{L("Actif", "Active")}</th><th></th></tr></thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.name}</b>{p.description ? <><br /><small className="muted">{p.description}</small></> : null}</td>
                  <td>{money(lang, p.price.amount_minor, p.price.currency)}</td>
                  <td>{p.period === "YEAR" ? L("an", "year") : L("mois", "month")}</td>
                  <td>
                    {p.benefits.free_delivery ? <span className="pill">{L("Livraison offerte", "Free delivery")}</span> : null}
                    {BigInt(p.benefits.min_subtotal.amount_minor) > 0n ? <span className="pill">{L("dès", "over")} {money(lang, p.benefits.min_subtotal.amount_minor, p.benefits.min_subtotal.currency)}</span> : null}
                    {p.benefits.service_charge_off_bps > 0 ? <span className="pill">−{(p.benefits.service_charge_off_bps / 100).toFixed(0)}% {L("frais de service", "service charge")}</span> : null}
                  </td>
                  <td>{p.active ? "✓" : "—"}</td>
                  <td><button className="link-btn" type="button" onClick={() => edit(p)}>{L("Modifier", "Edit")}</button></td>
                </tr>
              ))}
              {plans.length === 0 ? <tr><td colSpan={6} className="muted">{L("Créez la première formule ci-dessous.", "Create the first plan below.")}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><div><h2>{editing ? L("Modifier la formule", "Edit plan") : L("Nouvelle formule", "New plan")}</h2></div>{editing ? <button className="btn ghost" type="button" onClick={reset}>{L("Annuler", "Cancel")}</button> : null}</div>
        <div className="form-grid">
          <label>{L("Nom", "Name")}<input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Tunakula Plus" /></label>
          <label>{L("Description", "Description")}<input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={L("Livraison offerte sur chaque commande", "Free delivery on every order")} /></label>
          <label>{L("Prix (unités mineures)", "Price (minor units)")}<input className="input" inputMode="numeric" value={form.price_minor} onChange={(e) => setForm({ ...form, price_minor: e.target.value.replace(/[^0-9]/g, "") })} placeholder="999" /></label>
          <label>{L("Période", "Period")}<select className="select" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value as "MONTH" | "YEAR" })}><option value="MONTH">{L("Mensuel", "Monthly")}</option><option value="YEAR">{L("Annuel", "Yearly")}</option></select></label>
          <label className="check"><input type="checkbox" checked={form.free_delivery} onChange={(e) => setForm({ ...form, free_delivery: e.target.checked })} />{L("Livraison offerte", "Free delivery")}</label>
          <label>{L("Sous-total minimum (unités mineures)", "Minimum subtotal (minor units)")}<input className="input" inputMode="numeric" value={form.min_subtotal_minor} onChange={(e) => setForm({ ...form, min_subtotal_minor: e.target.value.replace(/[^0-9]/g, "") })} placeholder="0" /></label>
          <label>{L("Réduction frais de service (points de base, 10000 = 100%)", "Service-charge discount (bps, 10000 = 100%)")}<input className="input" inputMode="numeric" value={form.service_charge_off_bps} onChange={(e) => setForm({ ...form, service_charge_off_bps: e.target.value.replace(/[^0-9]/g, "") })} placeholder="0" /></label>
          <label className="check"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />{L("Proposé aux clients", "Offered to customers")}</label>
        </div>
        <div className="card-foot"><button className="btn" type="button" disabled={!form.name.trim()} onClick={save}>{editing ? L("Enregistrer", "Save") : L("Créer la formule", "Create plan")}</button></div>
      </section>
    </>
  );
}
