"use client";
/**
 * Market (country) switcher. The storefront resolves its market at runtime from the subdomain, a ?country= query
 * or a saved choice, defaulting to CD; this lets the customer change it. Only live markets are selectable; picking
 * one saves the choice and reloads so every request carries the new X-Country. One build serves every country.
 */
import { useEffect, useState } from "react";
import { MARKETS, resolveCountry, setCountry } from "../lib/country";

export function MarketSwitcher() {
  // Render the default on first paint, then settle on the resolved market after mount (avoids hydration drift).
  const [code, setCode] = useState("CD");
  useEffect(() => { setCode(resolveCountry()); }, []);
  return (
    <label className="market-switch" title="Country / market">
      <select
        aria-label="Country or market"
        value={code}
        onChange={(e) => { const m = MARKETS.find((x) => x.code === e.target.value); if (m?.live && m.code !== code) setCountry(m.code); }}
      >
        {MARKETS.map((m) => <option key={m.code} value={m.code} disabled={!m.live}>{m.flag} {m.name}{m.live ? "" : " · soon"}</option>)}
      </select>
    </label>
  );
}
