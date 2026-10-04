"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api } from "../../lib/api";
import { count } from "../../lib/format";

interface Branch { id: string; name: string; restaurant_group_id: string; city: string | null; commune: string | null; status: string; items: number; available_items: number; orders_30d: number }

export default function MerchantsPage() {
  return <Shell title="merchants"><Gate cap="catalogue"><Merchants /></Gate></Shell>;
}

function Merchants() {
  const { country, lang } = useConsole();
  const router = useRouter();
  const [data, setData] = useState<{ can_create: boolean; data: Branch[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", restaurant_group_id: "", city: "kinshasa", commune: "", lat: "", lng: "" });
  const [notice, setNotice] = useState<string | null>(null);
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);

  const load = () => api<{ can_create: boolean; data: Branch[] }>("/v1/admin/branches", { country }).then(setData).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [country]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const b = await api<{ id: string }>("/v1/branches", { method: "POST", country, body: { ...form, lat: Number(form.lat), lng: Number(form.lng) } });
      setNotice(L("Établissement créé.", "Branch created.")); void load();
      router.push(`/merchants/view/?id=${b.id}`);
    } catch (err) { setNotice((err as Error).message); }
  };

  if (error) return <div className="banner error">{error}</div>;
  if (!data) return <div className="muted">…</div>;
  return (
    <>
      <section className="card">
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{L("Établissement", "Branch")}</th><th>{L("Groupe", "Group")}</th><th>{L("Commune", "Commune")}</th><th>{L("Statut", "Status")}</th><th className="num">{L("Articles disponibles", "Items available")}</th><th className="num">{L("Commandes 30 j", "Orders 30 d")}</th></tr></thead>
            <tbody>
              {data.data.map((b) => (
                <tr key={b.id} className="clickable" onClick={() => router.push(`/merchants/view/?id=${b.id}`)}>
                  <td><b>{b.name}</b></td><td className="muted">{b.restaurant_group_id}</td><td>{[b.commune, b.city].filter(Boolean).join(", ")}</td>
                  <td><span className={`pill ${b.status === "OPEN" ? "good" : "warning"}`}>{b.status === "OPEN" ? L("Ouvert", "Open") : b.status}</span></td>
                  <td className="num">{count(lang, b.available_items)} / {count(lang, b.items)}</td><td className="num">{count(lang, b.orders_30d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {data.can_create ? (
        <section className="card">
          <div className="card-head"><div><h2>{L("Ajouter un établissement", "Add a branch")}</h2><p>{L("Le commerçant reçoit ensuite son rôle de propriétaire dans Équipe et rôles.", "Then give the merchant their owner role in Team and roles.")}</p></div></div>
          <form className="filters" onSubmit={create}>
            <input className="input" required placeholder={L("Nom", "Name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input" required placeholder={L("Identifiant du groupe (ex. rg-chez-mama)", "Group id (e.g. rg-chez-mama)")} value={form.restaurant_group_id} onChange={(e) => setForm({ ...form, restaurant_group_id: e.target.value })} />
            <input className="input" placeholder={L("Ville", "City")} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            <input className="input" placeholder={L("Commune", "Commune")} value={form.commune} onChange={(e) => setForm({ ...form, commune: e.target.value })} />
            <input className="input" required inputMode="decimal" placeholder="Latitude" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} style={{ width: 120 }} />
            <input className="input" required inputMode="decimal" placeholder="Longitude" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} style={{ width: 120 }} />
            <button className="btn primary" type="submit">{L("Créer", "Create")}</button>
          </form>
          {notice ? <div className="banner" style={{ marginTop: 10 }}>{notice}</div> : null}
        </section>
      ) : null}
    </>
  );
}
