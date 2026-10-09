"use client";
/** In-order chat between the customer and the rider. Polls the thread; read-only once the order is closed. */
import { useEffect, useRef, useState } from "react";
import { orderMessages, sendOrderMessage, type ChatMessage } from "../lib/api";

export function OrderChat({ orderId, title }: { orderId: string; title?: string }) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [open, setOpen] = useState(true);
  const [counterparty, setCounterparty] = useState<"CUSTOMER" | "RIDER" | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = () => orderMessages(orderId).then((t) => { setMsgs(t.messages); setOpen(t.open); setCounterparty(t.counterparty); setReady(true); }).catch(() => setReady(true));
  useEffect(() => { void load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [msgs.length]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try { const m = await sendOrderMessage(orderId, body); setMsgs((prev) => [...prev, m]); setText(""); }
    catch { /* shown on next poll */ } finally { setBusy(false); }
  };

  // Nothing to show until a rider is assigned (customer view) and there is a counterparty.
  if (!ready || (counterparty === null && msgs.length === 0)) return null;
  const other = counterparty === "RIDER" ? "rider" : "customer";

  return (
    <section className="app-card order-chat">
      <h2>{title ?? `Chat with your ${other}`}</h2>
      <div className="chat-log">
        {msgs.length === 0 ? <p className="muted small">No messages yet. Say hello 👋</p> : msgs.map((m) => (
          <div key={m.id} className={`chat-msg ${m.mine ? "mine" : "theirs"}`}>
            <span className="chat-bubble">{m.body}</span>
            <small>{new Date(m.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</small>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {open ? (
        <div className="chat-compose">
          <input value={text} maxLength={1000} placeholder={`Message the ${other}…`} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(); }} />
          <button type="button" className="btn accent" disabled={busy || !text.trim()} onClick={send}>Send</button>
        </div>
      ) : <p className="muted small">This order is complete — the chat is read-only.</p>}
    </section>
  );
}
