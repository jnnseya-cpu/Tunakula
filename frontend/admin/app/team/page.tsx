"use client";
import { useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api, type Scope } from "../../lib/api";
import { dateTime } from "../../lib/format";

interface Binding { id: string; user: { id: string; display_name: string; phone: string | null }; role: string; scope: Scope; since: string }
interface Team { data: Binding[]; roles: { role: string; scopes: string[] }[] }

const ROLE_FR: Record<string, string> = {
  SUPER_ADMIN: "Super administrateur", GROUP_FINANCE: "Finance groupe", COMPLIANCE_OFFICER: "Conformité", COUNTRY_ADMIN: "Administrateur pays",
  CITY_OPS: "Opérations ville", COUNTRY_FINANCE: "Finance pays", SUPPORT_AGENT: "Agent support", RESTAURANT_OWNER: "Propriétaire",
  BRANCH_MANAGER: "Gérant d'établissement", KITCHEN_STAFF: "Cuisine", FLEET_PARTNER: "Partenaire flotte", RIDER: "Livreur",
};

export default function TeamPage() {
  return <Shell title="team"><Gate cap="team"><TeamView /></Gate></Shell>;
}

function TeamView() {
  const { country, lang } = useConsole();
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ phone: "+243", display_name: "", role: "RIDER", scope_type: "ZONE", scope_id: "" });
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const roleName = (r: string) => (lang === "fr" ? ROLE_FR[r] ?? r : r.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()));

  const load = () => api<Team>("/v1/admin/team", { country }).then((t) => { setTeam(t); setError(null); }).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [country]); // eslint-disable-line react-hooks/exhaustive-deps
  const scopes = team?.roles.find((r) => r.role === form.role)?.scopes ?? [];

  const grant = async (e: React.FormEvent) => {
    e.preventDefault();
    const scope = form.scope_type === "GROUP" ? { type: "GROUP" } : { type: form.scope_type, id: form.scope_type === "COUNTRY" ? country : form.scope_id };
    try {
      await api("/v1/admin/role-bindings", { method: "POST", country, body: { phone: form.phone.replace(/\s/g, ""), display_name: form.display_name, role: form.role, scope } });
      setNotice(L("Rôle accordé. La personne se connecte avec ce numéro.", "Role granted. They sign in with this phone number.")); void load();
    } catch (err) { setNotice((err as Error).message); }
  };
  const revoke = async (b: Binding) => {
    if (!window.confirm(L(`Retirer le rôle ${roleName(b.role)} à ${b.user.display_name} ?`, `Remove ${roleName(b.role)} from ${b.user.display_name}?`))) return;
    try { await api(`/v1/admin/role-bindings/${b.id}`, { method: "DELETE", country }); void load(); } catch (err) { setNotice((err as Error).message); }
  };

  if (error) return <div className="banner error">{error}</div>;
  if (!team) return <div className="muted">…</div>;
  // One row per person and role; scopes (zones, branches…) as removable chips.
  const groups: { user: Binding["user"]; role: string; bindings: Binding[] }[] = [];
  for (const b of team.data) {
    const g = groups.find((x) => x.user.id === b.user.id && x.role === b.role);
    if (g) g.bindings.push(b); else groups.push({ user: b.user, role: b.role, bindings: [b] });
  }
  return (
    <>
      <div className="scope-note">{L("Vous voyez les rôles que vous pouvez accorder. Personne ne peut donner plus de droits qu'il n'en a.", "You see the roles you can grant. Nobody can give out more than they hold.")}</div>
      <section className="card">
        <div className="card-head"><div><h2>{L("Inviter ou accorder un rôle", "Invite or grant a role")}</h2><p>{L("Un nouveau numéro crée le compte ; la personne se connecte par SMS.", "A new number creates the account; they sign in by SMS code.")}</p></div></div>
        <form className="filters" onSubmit={grant}>
          <input className="input" required inputMode="tel" placeholder="+243…" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={{ width: 160 }} />
          <input className="input" placeholder={L("Nom affiché", "Display name")} value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          <select className="select" value={form.role} onChange={(e) => { const role = e.target.value; setForm({ ...form, role, scope_type: team.roles.find((r) => r.role === role)?.scopes.at(0) ?? "COUNTRY" }); }}>
            {team.roles.map((r) => <option key={r.role} value={r.role}>{roleName(r.role)}</option>)}
          </select>
          <select className="select" value={form.scope_type} onChange={(e) => setForm({ ...form, scope_type: e.target.value })}>
            {scopes.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {!["GROUP", "COUNTRY"].includes(form.scope_type) ? <input className="input" required placeholder={form.scope_type === "BRANCH" ? L("Identifiant de l'établissement", "Branch id") : form.scope_type === "ZONE" ? L("Zone (ex. gombe)", "Zone (e.g. gombe)") : L("Identifiant", "Id")} value={form.scope_id} onChange={(e) => setForm({ ...form, scope_id: e.target.value })} /> : null}
          <button className="btn primary" type="submit">{L("Accorder", "Grant")}</button>
        </form>
        {notice ? <div className="banner" style={{ marginTop: 10 }}>{notice}</div> : null}
      </section>
      <section className="card">
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{L("Personne", "Person")}</th><th>{L("Téléphone", "Phone")}</th><th>{L("Rôle", "Role")}</th><th>{L("Portée", "Scope")}</th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={`${g.user.id}-${g.role}`}>
                  <td><b>{g.user.display_name}</b></td><td className="num">{g.user.phone ?? "—"}</td><td>{roleName(g.role)}</td>
                  <td><div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{g.bindings.map((b) => (
                    <span key={b.id} className="pill" title={`${L("Depuis", "Since")} ${dateTime(lang, b.since)}`}>
                      {b.scope.type}{b.scope.id ? ` · ${b.scope.id.length > 20 ? `${b.scope.id.slice(0, 8)}…` : b.scope.id}` : ""}
                      <button className="link-btn" type="button" aria-label={L("Retirer", "Remove")} onClick={() => revoke(b)} style={{ marginLeft: 4 }}>×</button>
                    </span>
                  ))}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
