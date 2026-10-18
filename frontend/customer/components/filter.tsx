"use client";
/** Filters the server-rendered storefront cards in place: by search text (?q=) and by kind. */
import { useEffect, useState } from "react";
import { useT } from "./use-t";

const KINDS = ["Everything", "Restaurants", "Grills", "Malewa", "Bakeries", "Groceries"] as const;
const MATCH: Record<(typeof KINDS)[number], string[]> = {
  Everything: [], Restaurants: ["Restaurant"], Grills: ["Grill"], Malewa: ["Malewa"], Bakeries: ["Bakery"], Groceries: ["Grocery"],
};

export function StoreFilter() {
  const t = useT();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("Everything");
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setQ(p.get("q") ?? "");
    const c = p.get("c");
    if (c && (KINDS as readonly string[]).includes(c)) setKind(c as (typeof KINDS)[number]);
  }, []);
  useEffect(() => {
    const needle = q.trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll<HTMLElement>("[data-store]").forEach((el) => {
      const ok = (!needle || (el.dataset.search ?? "").includes(needle)) && (kind === "Everything" || MATCH[kind].includes(el.dataset.kind ?? ""));
      el.hidden = !ok;
      if (ok) shown++;
    });
    const empty = document.getElementById("no-stores");
    if (empty) empty.hidden = shown > 0;
  }, [q, kind]);
  return (
    <div className="filter">
      <label className="search">
        <span className="sr">{t("nav.search")}</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Moambe, brochettes, Limete…" />
      </label>
      <div className="chips" role="radiogroup" aria-label="Kind of place">
        {KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{t(`filter.${k.toLowerCase()}`)}</button>
        ))}
      </div>
    </div>
  );
}
