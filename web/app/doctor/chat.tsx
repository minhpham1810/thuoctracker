"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmtDateTime, type Contact, type Message, type User } from "@/lib/api";

const THREAD_MS = 2000;

// Doctor's chats: everyone in their care circle (patients and their families), 1:1.
export default function Messages({ me, contacts, withId, onOpen, onChange }: {
  me: User; contacts: Contact[]; withId: number | null; onOpen: (id: number | null) => void; onChange: () => void;
}) {
  const other = contacts.find((c) => c.user.id === withId)?.user;
  if (other) return <Thread me={me} other={other} onBack={() => onOpen(null)} onChange={onChange} />;
  if (!contacts.length) return <p className="empty">No one in your care circle yet.</p>;

  const nameOf = (id: number) => contacts.find((c) => c.user.id === id)?.user.name ?? "";
  return (
    <ul className="chat-list">
      {contacts.map(({ user: u, unread, last }) => (
        <li key={u.id}>
          <button type="button" onClick={() => onOpen(u.id)}>
            <span>
              <strong>{u.name}</strong>
              <small>{u.role === "family" ? `Family of ${nameOf(u.patient_id)}` : "Patient"}</small>
              {last && <span className="chat-last">{last.from_id === me.id ? "You: " : ""}{last.text}</span>}
            </span>
            {unread > 0 && <span className="count" aria-label={`${unread} unread`}>{unread}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Thread({ me, other, onBack, onChange }: { me: User; other: User; onBack: () => void; onChange: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);

  // fetching with with_id also marks their messages read
  const load = useCallback(async () => {
    const list = await api<Message[]>(`/messages?with_id=${other.id}`).catch(() => null);
    if (list) setMessages(list);
  }, [other.id]);

  useEffect(() => {
    const first = setTimeout(() => { load().then(onChange); }, 0); // onChange: refresh the unread badges
    const t = setInterval(load, THREAD_MS);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [load, onChange]);

  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText("");
    setError("");
    try {
      await api("/messages", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to_id: other.id, text: t }),
      });
      await load();
    } catch (err) {
      setText(t); // keep it so they can retry
      setError((err as Error).message);
    }
  }

  return (
    <div className="thread">
      <div className="thread-head">
        <button type="button" className="btn btn-sm" onClick={onBack}>‹ Back</button>
        <strong>{other.name}</strong>
      </div>
      <div className="bubbles" aria-live="polite">
        {messages.map((m) => (
          <p key={m.id} className={`bubble${m.from_id === me.id ? " mine" : ""}`}>
            {m.text}<small>{fmtDateTime(m.at)}</small>
          </p>
        ))}
        {!messages.length && <p className="empty">No messages yet.</p>}
        <div ref={end} />
      </div>
      <form className="thread-send" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message ${other.name}`}
          aria-label="Message" autoFocus />
        <button type="submit" className="btn btn-primary btn-sm">Send</button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
