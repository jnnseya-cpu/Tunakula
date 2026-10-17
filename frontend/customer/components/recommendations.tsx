"use client";
/**
 * "For you" — the growth agent's recommendations, grounded in the customer's own orders (order again), what
 * the kitchen recommends, and what's popular. Only shown to a signed-in customer with picks; silent otherwise.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getSession, money, type MoneyWire } from "../lib/api";

interface Pick { item_id: string; name: string; branch_name: string | null; reason: "ORDER_AGAIN" | "KITCHEN_PICK" | "POPULAR"; price: MoneyWire | null }

const lang = () => { try { return localStorage.getItem("tk-lang") ?? "fr"; } catch { return "fr"; } };
const EN = () => lang() === "en";
const REASON: Record<Pick["reason"], { en: string; fr: string }> = {
  ORDER_AGAIN: { en: "Order again", fr: "À recommander" },
  KITCHEN_PICK: { en: "Chef’s pick", fr: "Choix du chef" },
  POPULAR: { en: "Popular", fr: "Populaire" },
};

export function Recommendations() {
  const [picks, setPicks] = useState<Pick[] | null>(null);
  useEffect(() => {
    if (!getSession()) return;
    api<{ recommendations: Pick[] }>(`/v1/me/recommendations?lang=${lang()}`).then((r) => setPicks(r.recommendations)).catch(() => setPicks([]));
  }, []);
  if (!picks || picks.length === 0) return null;
  return (
    <section className="tight">
      <div className="wrap">
        <div className="sec-head">
          <div>
            <h2 className="sec-title">{EN() ? "For you" : "Pour vous"}</h2>
            <p className="muted">{EN() ? "Picked from what you’ve ordered, what the kitchen loves and what’s popular near you." : "Choisi d’après vos commandes, les coups de cœur des cuisines et ce qui est populaire près de vous."}</p>
          </div>
          <Link className="link" href="/order/">{EN() ? "See everything" : "Tout voir"}</Link>
        </div>
        <div className="rec-grid">
          {picks.map((p) => (
            <Link key={p.item_id} className="rec-card" href={`/order/?q=${encodeURIComponent(p.name)}`} data-reveal>
              <span className={`rec-reason r-${p.reason.toLowerCase()}`}>{EN() ? REASON[p.reason].en : REASON[p.reason].fr}</span>
              <h3>{p.name}</h3>
              {p.branch_name ? <p className="muted">{p.branch_name}</p> : null}
              {p.price ? <p className="rec-price"><b className="num">{money(p.price)}</b></p> : null}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
