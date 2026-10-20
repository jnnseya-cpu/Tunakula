"use client";
/**
 * Self-serve merchant signup wizard (/restaurants/apply): a restaurant signs itself up end to end —
 * phone sign-in, register the business, add a branch, build a short menu, then publish to go live on the
 * storefront. It drives the same backend onboarding endpoints the admin's guided set-up uses
 * (/v1/merchant/register, /v1/merchant/branches, /v1/branches/:id/items, /v1/merchant/branches/:id/publish),
 * so a merchant onboards the same way whether an admin creates them or they come in off the landing page.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError, COUNTRY, getSession, live, setSession } from "../lib/api";

const KINSHASA = { lat: -4.3217, lng: 15.3125 };

type Step = "signin" | "business" | "branch" | "menu" | "done";
interface Dish { name: string; price: string; category: string }

export function MerchantApply() {
  const [step, setStep] = useState<Step>("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sign-in (phone + one-time code), reused from the customer sign-in flow.
  const [otpStep, setOtpStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("+243 ");
  const [code, setCode] = useState("");
  const clean = phone.replace(/[\s.-]/g, "");

  // Business + branch + menu.
  const [settlement, setSettlement] = useState("CDF");
  const [businessName, setBusinessName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [branchName, setBranchName] = useState("");
  const [commune, setCommune] = useState("");
  const [branchId, setBranchId] = useState("");
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [draft, setDraft] = useState<Dish>({ name: "", price: "", category: "" });

  // Already signed in? Skip straight to registering the business.
  useEffect(() => { if (getSession()) setStep("business"); }, []);
  useEffect(() => {
    api<{ money: { currencies: { settlement: string } } }>(`/v1/countries/${COUNTRY}/config`, { auth: false })
      .then((c) => setSettlement(c.money.currencies.settlement)).catch(() => undefined);
  }, []);

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : (e as Error).message);

  if (!live()) {
    return (
      <div className="app-card">
        <h1 className="app-title">Open a storefront on Tunakula</h1>
        <p className="muted">Sign-ups open at launch. You will register with your phone — no password, no commission, your prices.</p>
        <Link className="btn accent" href="/restaurants/">Back to For restaurants</Link>
      </div>
    );
  }

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api("/v1/auth/otp/request", { method: "POST", body: { phone: clean, channel: "SMS", locale: "fr" }, auth: false }); setOtpStep("code"); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = await api<{ token: string; user_id: string }>("/v1/auth/otp/verify", { method: "POST", body: { phone: clean, code: code.trim(), locale: "fr" }, auth: false });
      setSession({ token: r.token, userId: r.user_id, phone: clean });
      setStep("business");
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const register = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = await api<{ group_id: string; business_name: string }>("/v1/merchant/register", { method: "POST", body: { business_name: businessName.trim() } });
      setGroupId(r.group_id); setStep("branch");
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const addBranch = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = await api<{ branch_id: string; name: string }>("/v1/merchant/branches", {
        method: "POST",
        body: { group_id: groupId, name: branchName.trim(), lat: KINSHASA.lat, lng: KINSHASA.lng, ...(commune.trim() ? { commune: commune.trim().toLowerCase() } : {}) },
      });
      setBranchId(r.branch_id); setStep("menu");
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const addDish = async () => {
    if (!draft.name.trim() || !draft.price.trim()) return;
    setBusy(true); setError(null);
    try {
      await api(`/v1/branches/${branchId}/items`, {
        method: "POST",
        body: { names: { fr: draft.name.trim() }, prices: { [settlement]: draft.price.trim() }, ...(draft.category.trim() ? { category: draft.category.trim() } : {}) },
      });
      setDishes((d) => [...d, draft]); setDraft({ name: "", price: "", category: "" });
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const publish = async () => {
    setBusy(true); setError(null);
    try { await api(`/v1/merchant/branches/${branchId}/publish`, { method: "POST" }); setStep("done"); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };

  const STEPS: [Step, string][] = [["signin", "Sign in"], ["business", "Business"], ["branch", "Branch"], ["menu", "Menu"], ["done", "Live"]];
  const idx = STEPS.findIndex(([s]) => s === step);

  return (
    <div className="app-card" style={{ maxWidth: 560 }}>
      <ol className="apply-steps" aria-label="Signup steps">
        {STEPS.map(([s, label], i) => (
          <li key={s} className={i < idx ? "done" : i === idx ? "now" : ""}><span className="apply-num">{i + 1}</span><span className="apply-lbl">{label}</span></li>
        ))}
      </ol>

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      {step === "signin" ? (
        otpStep === "phone" ? (
          <form onSubmit={sendCode} className="stack">
            <h1 className="app-title">Open a storefront</h1>
            <p className="muted">0% commission, your counter prices, a till on the phone you already own. Start with your phone number — no password.</p>
            <label className="field"><span>Phone number</span><input inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required /></label>
            <button className="btn accent wide" disabled={busy || clean.length < 10}>{busy ? "Sending…" : "Send my code"}</button>
          </form>
        ) : (
          <form onSubmit={verifyCode} className="stack">
            <h1 className="app-title">Enter your code</h1>
            <p className="muted">We sent a 6-digit code to {clean} by SMS.</p>
            <label className="field"><span>6-digit code</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required autoFocus className="code-input" /></label>
            <button className="btn accent wide" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Continue"}</button>
            <button type="button" className="link-btn" onClick={() => { setOtpStep("phone"); setCode(""); }}>Use another number</button>
          </form>
        )
      ) : null}

      {step === "business" ? (
        <form onSubmit={register} className="stack">
          <h1 className="app-title">Your business</h1>
          <p className="muted">The name customers will see — your restaurant, malewa, bakery or shop.</p>
          <label className="field"><span>Business name</span><input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Mama Nkoyi" required /></label>
          <button className="btn accent wide" disabled={busy || businessName.trim().length < 2}>{busy ? "Saving…" : "Continue"}</button>
        </form>
      ) : null}

      {step === "branch" ? (
        <form onSubmit={addBranch} className="stack">
          <h1 className="app-title">Your branch</h1>
          <p className="muted">The place you cook and hand over orders from.</p>
          <label className="field"><span>Branch name</span><input value={branchName} onChange={(e) => setBranchName(e.target.value)} placeholder="e.g. Mama Nkoyi — Lemba" required /></label>
          <label className="field"><span>Commune</span><input value={commune} onChange={(e) => setCommune(e.target.value)} placeholder="e.g. gombe" /></label>
          <button className="btn accent wide" disabled={busy || branchName.trim().length < 2}>{busy ? "Saving…" : "Continue"}</button>
        </form>
      ) : null}

      {step === "menu" ? (
        <div className="stack">
          <h1 className="app-title">Your menu</h1>
          <p className="muted">Add a few dishes to start — you can add the rest later. At least one is needed to go live.</p>
          {dishes.length ? (
            <ul className="apply-dishes">
              {dishes.map((d, i) => (
                <li key={i}><span className="cl-name">{d.name}{d.category ? <small className="cl-opts">{d.category}</small> : null}</span><span className="num">{d.price} {settlement}</span></li>
              ))}
            </ul>
          ) : null}
          <div className="apply-dish-row">
            <input placeholder="Dish name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <input inputMode="decimal" placeholder={`Price (${settlement})`} value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
            <input placeholder="Category (optional)" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
            <button type="button" className="btn" disabled={busy || !draft.name.trim() || !draft.price.trim()} onClick={addDish}>+ Add</button>
          </div>
          <button type="button" className="btn accent wide" disabled={busy || dishes.length < 1} onClick={publish}>{busy ? "Publishing…" : "Publish — go live"}</button>
        </div>
      ) : null}

      {step === "done" ? (
        <div className="stack">
          <h1 className="app-title">🎉 You&rsquo;re live</h1>
          <p className="muted">{branchName || "Your storefront"} is published. Customers can find it on Tunakula now. You can manage your menu, prices and more any time.</p>
          <Link className="btn accent wide" href="/order/">See the storefront</Link>
        </div>
      ) : null}
    </div>
  );
}
