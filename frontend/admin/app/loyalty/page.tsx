"use client";
import { useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api } from "../../lib/api";

interface LoyaltyConfig { enabled: boolean; earn_bps: number; redeem_minor_per_point: number; min_redeem_points: number }
const BLANK = { enabled: true, earn_bps: "100", redeem_minor_per_point: "1", min_redeem_points: "100" };

export default function LoyaltyPage() {
  return <Shell title="loyalty"><Gate cap="markets"><Loyalty /></Gate></Shell>;
}

function Loyalty() {
  const { country, lang } = useConsole();
  const [form, setForm] = useState({ ...BLANK });
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);

  const load = () => api<LoyaltyConfig>("/v1/admin/loyalty", { country })
    .then((c) => { setForm({ enabled: c.enabled, earn_bps: String(c.earn_bps), redeem_minor_per_point: String(c.redeem_minor_per_point), min_redeem_points: String(c.min_redeem_points) }); setLoaded(true); setError(null); })
    .catch((e: Error) => { setError(e.message); setLoaded(true); });
  useEffect(() => { setLoaded(false); void load(); }, [country]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const body = {
      enabled: form.enabled,
      earn_bps: Number(form.earn_bps) || 0,
      redeem_minor_per_point: Number(form.redeem_minor_per_point) || 1,
      min_redeem_points: Number(form.min_redeem_points) || 1,
    };
    try { await api("/v1/admin/loyalty", { method: "POST", country, body }); setNotice(L("Réglages enregistrés.", "Settings saved.")); void load(); }
    catch (e) { setNotice((e as Error).message); }
  };

  // A worked example at the current rates, so the effect of the numbers is legible.
  const pctBack = (Number(form.earn_bps) || 0) / 100;
  const example = Math.floor((1000 * (Number(form.earn_bps) || 0)) / 10000); // points earned on a $10 order

  if (error && !loaded) return <div className="banner error">{error}</div>;
  return (
    <>
      <div className="scope-note">{L("Les clients gagnent des points à chaque commande livrée et les échangent contre du crédit portefeuille. La plateforme finance le crédit à l'échange — le marchand et le livreur sont payés en entier.", "Customers earn points on every delivered order and redeem them for wallet credit. The platform funds the credit at redemption — the merchant and rider are paid in full.")}</div>
      {notice ? <div className="banner">{notice}</div> : null}
      <section className="card">
        <div className="card-head"><div><h2>{L("Points de fidélité", "Loyalty points")} · {country}</h2><p>{form.enabled ? L("Actif", "Live") : L("Désactivé", "Off")}</p></div></div>
        <div className="form-grid">
          <label className="check"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />{L("Programme actif", "Programme enabled")}</label>
          <label>{L("Taux de gain (points de base, 100 = 1%)", "Earn rate (bps, 100 = 1%)")}<input className="input" inputMode="numeric" value={form.earn_bps} onChange={(e) => setForm({ ...form, earn_bps: e.target.value.replace(/[^0-9]/g, "") })} /></label>
          <label>{L("Valeur d'un point (unités mineures)", "Value per point (minor units)")}<input className="input" inputMode="numeric" value={form.redeem_minor_per_point} onChange={(e) => setForm({ ...form, redeem_minor_per_point: e.target.value.replace(/[^0-9]/g, "") })} /></label>
          <label>{L("Échange minimum (points)", "Minimum to redeem (points)")}<input className="input" inputMode="numeric" value={form.min_redeem_points} onChange={(e) => setForm({ ...form, min_redeem_points: e.target.value.replace(/[^0-9]/g, "") })} /></label>
        </div>
        <div className="scope-note" style={{ marginTop: 12 }}>
          {L(`À ces réglages : environ ${pctBack}% de points sur chaque commande. Une commande de 10,00 rapporte ${example} points, échangeables contre ${example * (Number(form.redeem_minor_per_point) || 1)} unités mineures de crédit.`,
             `At these settings: about ${pctBack}% back on every order. A 10.00 order earns ${example} points, worth ${example * (Number(form.redeem_minor_per_point) || 1)} minor units of credit when redeemed.`)}
        </div>
        <div className="card-foot"><button className="btn primary" type="button" onClick={save}>{L("Enregistrer", "Save settings")}</button></div>
      </section>
    </>
  );
}
