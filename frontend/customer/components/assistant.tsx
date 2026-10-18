"use client";
/**
 * The customer-facing AI support assistant. It answers from the customer's own orders and the published
 * policies, links the policy it cites, and — when it hands off to a human — says so plainly. It never claims
 * to have moved money: a refund decision is escalated to a specialist, not made here.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, getSession } from "../lib/api";

interface Citation { title: string; policySlug?: string }
interface Turn { sender: "CUSTOMER" | "AI" | "AGENT"; body: string; citations?: Citation[]; escalated?: boolean }

const lang = () => { try { return localStorage.getItem("tk-lang") ?? "fr"; } catch { return "fr"; } };
const EN = () => lang() === "en";

const SUGGESTIONS = [
  { en: "Where is my order?", fr: "Où est ma commande ?" },
  { en: "Why is there a service charge?", fr: "Pourquoi des frais de service ?" },
  { en: "How do I book a chef?", fr: "Comment réserver un chef ?" },
  { en: "I have a problem with my order", fr: "J’ai un problème avec ma commande" },
];

export function Assistant() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [convo, setConvo] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setSignedIn(!!getSession()); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turns, busy]);

  const send = useCallback(async (message: string) => {
    const q = message.trim();
    if (!q || busy) return;
    setText("");
    setTurns((t) => [...t, { sender: "CUSTOMER", body: q }]);
    setBusy(true);
    try {
      const r = await api<{ conversation_id: string; reply: { answer: string; citations: Citation[]; escalated: boolean } }>(
        "/v1/support/ask", { method: "POST", body: { text: q, lang: lang(), ...(convo ? { conversation_id: convo } : {}) } },
      );
      setConvo(r.conversation_id);
      setTurns((t) => [...t, { sender: "AI", body: r.reply.answer, citations: r.reply.citations, escalated: r.reply.escalated }]);
    } catch (e) {
      setTurns((t) => [...t, { sender: "AI", body: (e as Error).message }]);
    } finally { setBusy(false); }
  }, [busy, convo]);

  return (
    <div className="asst">
      <div className="asst-head">
        <div className="asst-badge" aria-hidden>AI</div>
        <div>
          <h1 className="asst-title">{EN() ? "Tunakula assistant" : "Assistant Tunakula"}</h1>
          <p className="asst-sub">{EN() ? "Answers from your orders and our policies. A specialist steps in whenever you need one." : "Répond à partir de vos commandes et de nos règles. Un spécialiste prend le relais dès que nécessaire."}</p>
        </div>
      </div>

      <div className="asst-log" role="log" aria-live="polite">
        {turns.length === 0 ? (
          <div className="asst-welcome">
            <p>{EN() ? "Hello! How can I help today?" : "Bonjour ! Comment puis-je vous aider aujourd’hui ?"}</p>
            <div className="asst-chips">
              {SUGGESTIONS.map((s) => (
                <button key={s.en} type="button" className="asst-chip" onClick={() => send(EN() ? s.en : s.fr)}>{EN() ? s.en : s.fr}</button>
              ))}
            </div>
          </div>
        ) : null}
        {turns.map((t, i) => (
          <div key={i} className={`asst-msg ${t.sender === "CUSTOMER" ? "me" : "bot"}`}>
            {t.sender === "AGENT" ? <span className="asst-who">{EN() ? "Support" : "Support"}</span> : null}
            <p>{t.body}</p>
            {t.citations && t.citations.length > 0 ? (
              <p className="asst-cite">{EN() ? "Source:" : "Source :"} {t.citations.map((c, j) => (
                <span key={j}>{j > 0 ? ", " : ""}{c.policySlug ? <Link href={`/legal/${c.policySlug}/`}>{c.title}</Link> : c.title}</span>
              ))}</p>
            ) : null}
            {t.escalated ? <p className="asst-escalated">{EN() ? "Handed to a specialist — they'll reply in your conversation." : "Transmis à un spécialiste — il répondra dans votre conversation."}</p> : null}
          </div>
        ))}
        {busy ? <div className="asst-msg bot"><p className="asst-typing"><span></span><span></span><span></span></p></div> : null}
        <div ref={endRef} />
      </div>

      {signedIn ? (
        <form className="asst-input" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={EN() ? "Type your question…" : "Écrivez votre question…"} aria-label={EN() ? "Your message" : "Votre message"} />
          <button type="submit" className="btn accent" disabled={busy || !text.trim()}>{EN() ? "Send" : "Envoyer"}</button>
        </form>
      ) : (
        <div className="asst-signin">
          <p>{EN() ? "Sign in so I can see your orders and help properly." : "Connectez-vous pour que je puisse voir vos commandes et vous aider."}</p>
          <Link className="btn accent" href="/signin/">{EN() ? "Sign in" : "Se connecter"}</Link>
        </div>
      )}
      <p className="asst-foot">{EN() ? "The assistant never moves money on its own — refunds follow our policy, and a human reviews anything that needs a judgement." : "L’assistant ne déplace jamais d’argent de lui-même — les remboursements suivent nos règles, et un humain examine tout cas d’appréciation."}</p>
    </div>
  );
}
