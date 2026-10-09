"use client";
/**
 * Merchants: the single place a business is set up and managed — the same console screen for everyone,
 * no separate onboarding wizard. A market admin sees and adds every branch. A self-serve owner is guided
 * from the top: register the business, add a branch, build the menu, then publish to go live (on the web
 * and on Tunakula Nzela, the WhatsApp channel, which read the same catalogue).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Shell, useConsole } from "../../components/shell";
import { api } from "../../lib/api";
import { count } from "../../lib/format";

interface Branch { id: string; name: string; restaurant_group_id: string; city: string | null; commune: string | null; status: string; items: number; available_items: number; orders_30d: number; published: boolean }
interface Data { can_create: boolean; has_business: boolean; group_id?: string; data: Branch[] }

export default function MerchantsPage() {
  return <Shell title="merchants"><Merchants /></Shell>;
}

const KINSHASA = { lat: -4.3217, lng: 15.3125 };

function Merchants() {
  const { country, lang } = useConsole();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);

  const load = () => api<Data>("/v1/admin/branches", { country }).then((d) => { setData(d); setError(null); }).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [country]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="banner error">{error}</div>;
  if (!data) return <div className="muted">…</div>;
  if (data.can_create) return <AdminBranches data={data} country={country} lang={lang} L={L} reload={load} />;
  if (data.has_business) return <MerchantHub data={data} isOwner country={country} lang={lang} L={L} reload={load} />;
  if (data.data.length > 0) return <MerchantHub data={data} isOwner={false} country={country} lang={lang} L={L} reload={load} />;
  return <GetStarted country={country} L={L} onDone={load} />;
}

/** Market admin: see and add every branch (published immediately), then manage each one. */
function AdminBranches({ data, country, lang, L, reload }: { data: Data; country: string; lang: "fr" | "en"; L: (fr: string, en: string) => string; reload: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", restaurant_group_id: "", city: "kinshasa", commune: "", lat: "", lng: "" });
  const [notice, setNotice] = useState<string | null>(null);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const b = await api<{ id: string }>("/v1/branches", { method: "POST", country, body: { ...form, lat: Number(form.lat), lng: Number(form.lng) } });
      setNotice(L("Établissement créé.", "Branch created.")); reload();
      router.push(`/merchants/view/?id=${b.id}`);
    } catch (err) { setNotice((err as Error).message); }
  };
  return (
    <>
      <BranchTable rows={data.data} lang={lang} L={L} onOpen={(id) => router.push(`/merchants/view/?id=${id}`)} />
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
    </>
  );
}

/** First run: create a new brand, or join an existing one with its invite code (as a franchisee). */
function GetStarted({ country, L, onDone }: { country: string; L: (fr: string, en: string) => string; onDone: () => void }) {
  const [mode, setMode] = useState<"CREATE" | "JOIN">("CREATE");
  const [name, setName] = useState("");
  const [join, setJoin] = useState({ code: "", branch: "", commune: "", lat: KINSHASA.lat, lng: KINSHASA.lng });
  const [locMsg, setLocMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const useMyLocation = () => {
    setLocMsg(L("Localisation…", "Locating…"));
    navigator.geolocation?.getCurrentPosition(
      (p) => { setJoin((j) => ({ ...j, lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) })); setLocMsg(L("Position enregistrée ✓", "Location set ✓")); },
      () => setLocMsg(L("Impossible de localiser — saisissez les coordonnées.", "Could not locate — enter coordinates.")),
    );
  };
  const create = async () => {
    setBusy(true); setError(null);
    try { await api("/v1/merchant/register", { method: "POST", country, body: { business_name: name.trim() } }); onDone(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const doJoin = async () => {
    setBusy(true); setError(null);
    try { await api("/v1/merchant/join", { method: "POST", country, body: { code: join.code.trim(), name: join.branch.trim(), lat: join.lat, lng: join.lng, ...(join.commune.trim() ? { commune: join.commune.trim().toLowerCase() } : {}) } }); onDone(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="card">
      <div className="card-head"><div><h2>{L("Mettez votre commerce en ligne 👋", "Get your business online 👋")}</h2><p>{L("Créez une nouvelle marque, ou rejoignez une marque existante avec son code d'invitation.", "Create a new brand, or join an existing one with its invite code.")}</p></div></div>
      <div className="seg2" role="radiogroup" style={{ margin: "0 0 14px", maxWidth: 420 }}>
        <button type="button" role="radio" aria-checked={mode === "CREATE"} className={mode === "CREATE" ? "on" : ""} onClick={() => setMode("CREATE")}>{L("Créer une marque", "Create a brand")}</button>
        <button type="button" role="radio" aria-checked={mode === "JOIN"} className={mode === "JOIN" ? "on" : ""} onClick={() => setMode("JOIN")}>{L("Rejoindre une marque", "Join a brand")}</button>
      </div>
      {error ? <div className="banner error" style={{ marginBottom: 12 }}>{error}</div> : null}
      {mode === "CREATE" ? (
        <>
          <label className="field"><span>{L("Nom de l'entreprise", "Business name")}</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={L("ex. Mama Nkoyi Kitchen", "e.g. Mama Nkoyi Kitchen")} /></label>
          <button className="btn primary" type="button" disabled={busy || name.trim().length < 2} onClick={create} style={{ marginTop: 10 }}>{L("Créer mon entreprise", "Create my business")}</button>
        </>
      ) : (
        <>
          <p className="muted" style={{ margin: "0 4px 8px" }}>{L("Demandez le code d'invitation au propriétaire de la marque. Vous gérerez votre propre établissement.", "Ask the brand owner for the invite code. You'll run your own branch.")}</p>
          <label className="field"><span>{L("Code d'invitation", "Invite code")}</span><input className="input" value={join.code} onChange={(e) => setJoin({ ...join, code: e.target.value.toUpperCase() })} placeholder="ABCD2345" style={{ maxWidth: 220, letterSpacing: "0.12em" }} /></label>
          <label className="field"><span>{L("Nom de votre établissement", "Your branch name")}</span><input className="input" value={join.branch} onChange={(e) => setJoin({ ...join, branch: e.target.value })} placeholder={L("ex. Mama Nkoyi — Lemba", "e.g. Mama Nkoyi — Lemba")} /></label>
          <label className="field"><span>{L("Commune", "Commune")}</span><input className="input" value={join.commune} onChange={(e) => setJoin({ ...join, commune: e.target.value })} placeholder="ex. lemba" /></label>
          <div className="wiz-loc">
            <button className="btn" type="button" onClick={useMyLocation}>📍 {L("Utiliser ma position", "Use my location")}</button>
            <input className="input" inputMode="decimal" value={join.lat} onChange={(e) => setJoin({ ...join, lat: Number(e.target.value) })} style={{ width: 130 }} aria-label="lat" />
            <input className="input" inputMode="decimal" value={join.lng} onChange={(e) => setJoin({ ...join, lng: Number(e.target.value) })} style={{ width: 130 }} aria-label="lng" />
          </div>
          {locMsg ? <p className="muted">{locMsg}</p> : null}
          <button className="btn primary" type="button" disabled={busy || join.code.trim().length < 4 || join.branch.trim().length < 2} onClick={doJoin} style={{ marginTop: 10 }}>{L("Rejoindre la marque", "Join the brand")}</button>
        </>
      )}
    </section>
  );
}

/** Brand owner: share an invite code so franchisees can join and run their own branches under the brand. */
function InviteFranchisees({ country, L }: { country: string; L: (fr: string, en: string) => string }) {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const reveal = async () => {
    setBusy(true);
    try { const r = await api<{ invite_code: string }>("/v1/merchant/brand/invite", { method: "POST", country }); setCode(r.invite_code); }
    catch { /* ignore */ } finally { setBusy(false); }
  };
  const copy = () => { if (code) { navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => undefined); } };
  return (
    <section className="card">
      <div className="card-head"><div><h2>{L("Inviter des franchisés", "Invite franchisees")}</h2><p>{L("Partagez ce code. Chaque franchisé s'inscrit de son côté, rejoint votre marque et gère son propre établissement.", "Share this code. Each franchisee signs up on their own, joins your brand and runs their own branch.")}</p></div></div>
      {code ? (
        <div className="invite-code-row">
          <code className="invite-code">{code}</code>
          <button type="button" className="btn" onClick={copy}>{copied ? L("Copié ✓", "Copied ✓") : L("Copier", "Copy")}</button>
        </div>
      ) : (
        <button type="button" className="btn primary" disabled={busy} onClick={reveal}>{busy ? "…" : L("Afficher le code d'invitation", "Show invite code")}</button>
      )}
    </section>
  );
}

/** Self-serve owner or franchisee: guided set-up and management of their own branches. */
function MerchantHub({ data, isOwner, country, lang, L, reload }: { data: Data; isOwner: boolean; country: string; lang: "fr" | "en"; L: (fr: string, en: string) => string; reload: () => void }) {
  const router = useRouter();
  const groupId = data.group_id ?? "";
  const [form, setForm] = useState({ name: "", commune: "", lat: KINSHASA.lat, lng: KINSHASA.lng });
  const [locMsg, setLocMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const anyPublished = data.data.some((b) => b.published);
  const step = data.data.length === 0 ? 2 : !data.data.some((b) => b.available_items > 0) ? 3 : !anyPublished ? 4 : 0;
  const steps: [number, string][] = [[1, L("Entreprise", "Business")], [2, L("Établissement", "Branch")], [3, L("Carte", "Menu")], [4, L("Publier", "Publish")]];

  const useMyLocation = () => {
    setLocMsg(L("Localisation…", "Locating…"));
    navigator.geolocation?.getCurrentPosition(
      (p) => { setForm((f) => ({ ...f, lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) })); setLocMsg(L("Position enregistrée ✓", "Location set ✓")); },
      () => setLocMsg(L("Impossible de localiser — saisissez les coordonnées.", "Could not locate — enter coordinates.")),
    );
  };
  const addBranch = async () => {
    setBusy(true); setNotice(null);
    try {
      await api("/v1/merchant/branches", { method: "POST", country, body: { group_id: groupId, name: form.name.trim(), lat: form.lat, lng: form.lng, ...(form.commune.trim() ? { commune: form.commune.trim().toLowerCase() } : {}) } });
      setForm({ name: "", commune: "", lat: KINSHASA.lat, lng: KINSHASA.lng }); setLocMsg(null); reload();
    } catch (e) { setNotice((e as Error).message); } finally { setBusy(false); }
  };
  const publish = async (id: string) => {
    setBusy(true); setNotice(null);
    try { await api(`/v1/merchant/branches/${id}/publish`, { method: "POST", country }); reload(); }
    catch (e) { setNotice((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <>
      <ol className="wiz-steps">
        {steps.map(([n, label]) => <li key={n} className={step === 0 || n < step ? "done" : n === step ? "now" : ""}><span>{n}</span>{label}</li>)}
      </ol>
      {notice ? <div className="banner" style={{ marginBottom: 12 }}>{notice}</div> : null}

      <section className="card">
        <div className="card-head"><div><h2>{isOwner ? L("Vos établissements", "Your branches") : L("Votre établissement", "Your branch")}</h2><p>{L("Ajoutez vos plats dans la carte, puis publiez pour être visible (web et Tunakula Nzela).", "Add your dishes in the menu, then publish to be visible (web and Tunakula Nzela).")}</p></div></div>
        {data.data.length === 0 ? <p className="muted" style={{ padding: "0 4px 8px" }}>{L("Aucun établissement pour l'instant — ajoutez-en un ci-dessous.", "No branch yet — add one below.")}</p> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>{L("Établissement", "Branch")}</th><th>{L("Commune", "Commune")}</th><th>{L("Statut", "Status")}</th><th className="num">{L("Articles disponibles", "Items available")}</th><th></th></tr></thead>
              <tbody>
                {data.data.map((b) => (
                  <tr key={b.id}>
                    <td><b>{b.name}</b></td>
                    <td>{b.commune ?? "—"}</td>
                    <td><span className={`pill ${b.published ? "good" : "warning"}`}>{b.published ? L("Publié", "Published") : L("Brouillon", "Draft")}</span></td>
                    <td className="num">{count(lang, b.available_items)} / {count(lang, b.items)}</td>
                    <td className="row-actions">
                      <Link className="btn ghost sm" href={`/menu/?branch=${b.id}`}>{L("Gérer la carte", "Manage menu")}</Link>
                      <Link className="btn ghost sm" href={`/merchants/view/?id=${b.id}`}>{L("Détails", "Details")}</Link>
                      {!b.published ? <button type="button" className="btn primary sm" disabled={busy || b.available_items < 1} title={b.available_items < 1 ? L("Ajoutez un plat disponible pour publier", "Add an available dish to publish") : ""} onClick={() => publish(b.id)}>{L("Publier", "Publish")}</button> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isOwner ? <InviteFranchisees country={country} L={L} /> : null}

      {isOwner ? (
        <section className="card">
          <div className="card-head"><div><h2>{L("Ajouter un établissement", "Add a branch")}</h2><p>{L("Le lieu d'où vous préparez et remettez les commandes.", "The place you cook and hand over orders from.")}</p></div></div>
          <label className="field"><span>{L("Nom de l'établissement", "Branch name")}</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={L("ex. Mama Nkoyi — Lemba", "e.g. Mama Nkoyi — Lemba")} /></label>
          <label className="field"><span>{L("Commune", "Commune")}</span><input className="input" value={form.commune} onChange={(e) => setForm({ ...form, commune: e.target.value })} placeholder="ex. gombe" /></label>
          <div className="wiz-loc">
            <button className="btn" type="button" onClick={useMyLocation}>📍 {L("Utiliser ma position", "Use my location")}</button>
            <input className="input" inputMode="decimal" value={form.lat} onChange={(e) => setForm({ ...form, lat: Number(e.target.value) })} style={{ width: 130 }} aria-label="lat" />
            <input className="input" inputMode="decimal" value={form.lng} onChange={(e) => setForm({ ...form, lng: Number(e.target.value) })} style={{ width: 130 }} aria-label="lng" />
          </div>
          {locMsg ? <p className="muted">{locMsg}</p> : null}
          <button className="btn primary" type="button" disabled={busy || form.name.trim().length < 2} onClick={addBranch} style={{ marginTop: 10 }}>{L("Ajouter l'établissement", "Add branch")}</button>
        </section>
      ) : null}
    </>
  );
}

function BranchTable({ rows, lang, L, onOpen }: { rows: Branch[]; lang: "fr" | "en"; L: (fr: string, en: string) => string; onOpen: (id: string) => void }) {
  return (
    <section className="card">
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>{L("Établissement", "Branch")}</th><th>{L("Groupe", "Group")}</th><th>{L("Commune", "Commune")}</th><th>{L("Statut", "Status")}</th><th className="num">{L("Articles disponibles", "Items available")}</th><th className="num">{L("Commandes 30 j", "Orders 30 d")}</th></tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} className="clickable" onClick={() => onOpen(b.id)}>
                <td><b>{b.name}</b>{!b.published ? <span className="pill warning" style={{ marginLeft: 8 }}>{L("Brouillon", "Draft")}</span> : null}</td>
                <td className="muted">{b.restaurant_group_id}</td><td>{[b.commune, b.city].filter(Boolean).join(", ")}</td>
                <td><span className={`pill ${b.status === "OPEN" ? "good" : "warning"}`}>{b.status === "OPEN" ? L("Ouvert", "Open") : b.status}</span></td>
                <td className="num">{count(lang, b.available_items)} / {count(lang, b.items)}</td><td className="num">{count(lang, b.orders_30d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
