"use client";
/**
 * Tunakula Plus: the paid membership. Shows the plans on offer, lets a signed-in customer subscribe,
 * and shows their current membership with the option to cancel (which keeps benefits until the period ends).
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, cancelMembership, getSession, listPlans, live, money, myMembership, subscribePlan, type MembershipPlan, type MyMembership } from "../lib/api";

const periodLabel = (p: "MONTH" | "YEAR") => (p === "YEAR" ? "year" : "month");

function benefitList(plan: MembershipPlan): string[] {
  const out: string[] = [];
  if (plan.benefits.free_delivery) {
    const min = BigInt(plan.benefits.min_subtotal.amount_minor);
    out.push(min > 0n ? `Free delivery on orders over ${money(plan.benefits.min_subtotal)}` : "Free delivery on every order");
  }
  if (plan.benefits.service_charge_off_bps > 0) out.push(`${(plan.benefits.service_charge_off_bps / 100).toFixed(0)}% off the service charge`);
  return out;
}

export function Membership() {
  const [plans, setPlans] = useState<MembershipPlan[] | null>(null);
  const [mine, setMine] = useState<MyMembership | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => {
    listPlans().then(setPlans).catch((e: ApiError) => setError(e.message));
    if (getSession()) myMembership().then(setMine).catch(() => undefined);
  };
  useEffect(() => {
    setSignedIn(!!getSession());
    if (live()) refresh();
    else setPlans([]);
  }, []);

  const subscribe = async (planId: string) => {
    setError(null); setNotice(null); setBusy(planId);
    try {
      const m = await subscribePlan(planId);
      setMine(m);
      setNotice(`You're a ${m.plan.name} member. Your benefits apply at checkout right away.`);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  };
  const cancel = async () => {
    if (!window.confirm("Cancel auto-renewal? Your benefits stay until the current period ends.")) return;
    setError(null); setNotice(null); setBusy("cancel");
    try {
      const m = await cancelMembership();
      setMine(m);
      setNotice("Auto-renewal is off. You keep your benefits until the period ends.");
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  };

  if (!live()) return <div className="app-card"><h1 className="app-title">Tunakula Plus</h1><p className="muted">Membership opens at launch.</p></div>;

  return (
    <div className="app-card plus">
      <h1 className="app-title">Tunakula Plus</h1>
      <p className="muted">Free delivery and member savings, every order. The restaurant and your rider are always paid in full — Tunakula funds the benefit.</p>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}

      {mine && mine.status !== "EXPIRED" ? (
        <section className="plus-current">
          <div className="pill on">{mine.status === "ACTIVE" && mine.auto_renew ? "Active" : "Active until period ends"}</div>
          <h2>{mine.plan.name}</h2>
          <ul className="plus-benefits">{benefitList(mine.plan).map((b) => <li key={b}>{b}</li>)}</ul>
          <p className="muted small">{mine.auto_renew ? `Renews ${new Date(mine.current_period_end).toLocaleDateString()}` : `Ends ${new Date(mine.current_period_end).toLocaleDateString()}`}</p>
          {mine.auto_renew ? <button type="button" className="btn light" disabled={busy === "cancel"} onClick={cancel}>{busy === "cancel" ? "…" : "Cancel auto-renewal"}</button> : null}
        </section>
      ) : null}

      {plans === null ? (
        <div className="skeleton-line" />
      ) : plans.length === 0 ? (
        <p className="muted">No membership plans are available in your market yet.</p>
      ) : (
        <div className="plus-plans">
          {plans.map((p) => {
            const owned = mine?.plan.id === p.id && mine.status !== "EXPIRED";
            return (
              <article key={p.id} className="plus-plan">
                <h3>{p.name}</h3>
                <div className="plus-price"><b>{money(p.price)}</b><span>/{periodLabel(p.period)}</span></div>
                {p.description ? <p className="muted">{p.description}</p> : null}
                <ul className="plus-benefits">{benefitList(p).map((b) => <li key={b}>{b}</li>)}</ul>
                {signedIn ? (
                  <button type="button" className="btn accent wide" disabled={owned || !!busy} onClick={() => subscribe(p.id)}>
                    {owned ? "Your plan" : busy === p.id ? "Subscribing…" : "Join"}
                  </button>
                ) : (
                  <Link className="btn accent wide" href="/signin/?next=/membership/">Sign in to join</Link>
                )}
              </article>
            );
          })}
        </div>
      )}
      <p className="muted small">Cancel any time — your benefits last until the end of the period you paid for.</p>
    </div>
  );
}
