"use client";
/**
 * Support (ops): the queue of AI conversations the assistant handed to a human. An agent opens one, reads the
 * full transcript (what the customer asked, what the AI answered and why it escalated), and replies — resolving
 * it or keeping it open. Requires `ai_chat:takeover`.
 */
import { useEffect, useState } from "react";
import { Gate, Shell, useConsole } from "../../components/shell";
import { api } from "../../lib/api";

interface Convo { id: string; status: string; last_intent: string; order_id: string | null; last_customer_message: string; updated_at: string }
interface Msg { sender: "CUSTOMER" | "AI" | "AGENT"; body: string; intent?: string; confidence?: string | number; escalated?: boolean; citations?: { title: string; policySlug?: string }[]; created_at: string }

export default function SupportPage() {
  return <Shell title="support"><Gate cap="support"><Support /></Gate></Shell>;
}

function Support() {
  const { country, lang } = useConsole();
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const [rows, setRows] = useState<Convo[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => api<{ conversations: Convo[] }>("/v1/ops/support/escalations", { country }).then((r) => { setRows(r.conversations); setError(null); }).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [country]); // eslint-disable-line react-hooks/exhaustive-deps

  const openConvo = async (id: string) => {
    setOpen(id); setMsgs(null);
    try { const r = await api<{ messages: Msg[] }>(`/v1/support/conversations/${id}`, { country }); setMsgs(r.messages); }
    catch (e) { setError((e as Error).message); }
  };

  const send = async (resolve: boolean) => {
    if (!open || !reply.trim()) return;
    setBusy(true);
    try {
      await api(`/v1/ops/support/conversations/${open}/reply`, { method: "POST", country, body: { text: reply, resolve } });
      setReply("");
      await openConvo(open);
      await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  if (error) return <div className="banner error">{error}</div>;
  return (
    <>
      <div className="scope-note">{L(
        "Conversations que l’assistant IA a transmises à un humain (remboursement à apprécier, réclamation, question hors de sa portée). Ouvrez-en une, lisez l’échange, puis répondez au client.",
        "Conversations the AI assistant handed to a human (a judgement-call refund, a complaint, a question beyond its scope). Open one, read the exchange, then reply to the customer.",
      )}</div>
      <div className="support-split">
        <section className="card">
          <div className="card-head"><div><h2>{L("File d’attente", "Escalation queue")}</h2><p>{rows ? `${rows.length}` : "…"}</p></div></div>
          <div className="support-list">
            {rows?.map((c) => (
              <button key={c.id} type="button" className={`support-row ${open === c.id ? "on" : ""}`} onClick={() => openConvo(c.id)}>
                <span className="support-row-msg">{c.last_customer_message || L("(sans message)", "(no message)")}</span>
                <span className="support-row-meta"><span className="pill">{c.last_intent}</span>{c.order_id ? <span className="muted"> · {L("commande", "order")} {String(c.order_id).slice(0, 8)}</span> : null}</span>
              </button>
            ))}
            {rows && rows.length === 0 ? <p className="muted" style={{ padding: 16 }}>{L("Aucune conversation en attente. L’assistant gère tout pour l’instant.", "Nothing waiting. The assistant is handling everything right now.")}</p> : null}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><div><h2>{L("Conversation", "Conversation")}</h2></div></div>
          {!open ? <p className="muted" style={{ padding: 16 }}>{L("Sélectionnez une conversation.", "Select a conversation.")}</p> : (
            <>
              <div className="support-thread">
                {msgs?.map((m, i) => (
                  <div key={i} className={`support-msg ${m.sender.toLowerCase()}`}>
                    <span className="support-who">{m.sender === "CUSTOMER" ? L("Client", "Customer") : m.sender === "AI" ? L("Assistant IA", "AI assistant") : L("Agent", "Agent")}{m.sender === "AI" && m.confidence != null ? ` · ${Math.round(Number(m.confidence) * 100)}%` : ""}</span>
                    <p>{m.body}</p>
                    {m.citations && m.citations.length > 0 ? <p className="support-cite">{L("Source", "Source")}: {m.citations.map((c) => c.title).join(", ")}</p> : null}
                  </div>
                ))}
                {msgs && msgs.length === 0 ? <p className="muted">…</p> : null}
              </div>
              <div className="support-reply">
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder={L("Répondre au client…", "Reply to the customer…")} rows={3} />
                <div className="support-actions">
                  <button type="button" className="btn" disabled={busy || !reply.trim()} onClick={() => send(false)}>{L("Envoyer", "Send")}</button>
                  <button type="button" className="btn primary" disabled={busy || !reply.trim()} onClick={() => send(true)}>{L("Envoyer et résoudre", "Send & resolve")}</button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
