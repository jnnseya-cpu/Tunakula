"use client";
/**
 * Storefront update gate. Asks the backend whether this build is current; on update_required — or on any 426 from
 * the API — it covers the page with a reload prompt so a long-open tab moves onto the new storefront at cutover.
 * Inert until a real build version is injected (NEXT_PUBLIC_APP_VERSION): the backend never blocks a version it
 * cannot read, so an unversioned preview never traps a visitor.
 */
import { useEffect, useState } from "react";
import { appRequirements, APP_VERSION } from "../lib/api";

export function UpdateGate() {
  const [blocked, setBlocked] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const onRequired = () => setBlocked(true);
    window.addEventListener("tk-update-required", onRequired);
    let alive = true;
    if (APP_VERSION) {
      appRequirements().then((r) => {
        if (alive && r && r.status === "update_required") { setMessage(r.message || ""); setBlocked(true); }
      });
    }
    return () => { alive = false; window.removeEventListener("tk-update-required", onRequired); };
  }, []);

  if (!blocked) return null;
  return (
    <div role="alertdialog" aria-modal="true" aria-label="Update required"
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(23,16,8,0.92)", color: "#fff7ee", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 28, textAlign: "center", gap: 16 }}>
      <div style={{ fontSize: 44 }} aria-hidden>⬆️</div>
      <div style={{ fontSize: 24, fontWeight: 800 }}>A new Tunakula is here</div>
      <div style={{ fontSize: 16, maxWidth: 420, lineHeight: 1.5, opacity: 0.9 }}>
        {message || "The storefront has been updated. Reload to continue with the latest version."}
      </div>
      <button onClick={() => location.reload()}
        style={{ marginTop: 8, background: "#ff7a18", color: "#fff", border: 0, fontWeight: 800, fontSize: 16, padding: "14px 30px", borderRadius: 999, cursor: "pointer" }}>
        Reload now
      </button>
    </div>
  );
}
