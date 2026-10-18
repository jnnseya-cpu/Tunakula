"use client";
/**
 * Chef review (ops): approve or suspend the cooks who applied to the private-chef marketplace. An approved chef
 * becomes discoverable and can take bookings; nobody reviews their own application.
 */
import { useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api } from "../../lib/api";

interface Chef { id: string; display_name: string; bio: string; cuisines: string[]; communes: string[]; status: string }

export default function ChefsOpsPage() {
  return <Shell title="chefs"><Gate cap="markets"><ChefsOps /></Gate></Shell>;
}

function ChefsOps() {
  const { country, lang } = useConsole();
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const [rows, setRows] = useState<Chef[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api<{ chefs: Chef[] }>("/v1/ops/chefs/pending", { country }).then((r) => { setRows(r.chefs); setError(null); }).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [country]); // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (id: string, approve: boolean) => {
    try { await api(`/v1/ops/chefs/${id}/decide`, { method: "POST", country, body: { approve } }); setNotice(L(approve ? "Chef approuvé." : "Chef suspendu.", approve ? "Chef approved." : "Chef suspended.")); void load(); }
    catch (e) { setNotice((e as Error).message); }
  };

  if (error) return <div className="banner error">{error}</div>;
  return (
    <>
      <div className="scope-note">{L("Cuisiniers qui ont demandé à rejoindre la place de marché « Réserver un chef ». Approuvez pour les rendre visibles et leur permettre de recevoir des réservations.", "Cooks who applied to the Book-a-chef marketplace. Approve to make them discoverable and able to take bookings.")}</div>
      {notice ? <div className="banner">{notice}</div> : null}
      <section className="card">
        <div className="card-head"><div><h2>{L("En attente de validation", "Pending review")}</h2><p>{rows ? `${rows.length}` : "…"}</p></div></div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{L("Chef", "Chef")}</th><th>{L("Cuisines", "Cuisines")}</th><th>{L("Communes", "Communes")}</th><th></th></tr></thead>
            <tbody>
              {rows?.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.display_name}</b>{c.bio ? <><br /><small className="muted">{c.bio}</small></> : null}</td>
                  <td className="muted">{c.cuisines.join(", ") || "—"}</td>
                  <td className="muted">{c.communes.join(", ") || "—"}</td>
                  <td>
                    <button className="btn primary sm" type="button" onClick={() => decide(c.id, true)}>{L("Approuver", "Approve")}</button>
                    <button className="link-btn danger" type="button" onClick={() => decide(c.id, false)}>{L("Refuser", "Reject")}</button>
                  </td>
                </tr>
              ))}
              {rows && rows.length === 0 ? <tr><td colSpan={4} className="muted">{L("Aucune demande en attente", "No pending applications")}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
