"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, Logo } from "@/components/icon";
import {
  api, daysUntil, fmtDate, fmtDateTime, fmtTime, LONG_SLOT, onUnauthorized, pillColor, setToken, SLOTS,
  type Alert, type Contact, type DoseLog, type Family, type Medicine, type Patient, type Session, type User,
} from "@/lib/api";
import AddMedicine from "./add-medicine";
import CameraTest from "./camera-test";
import Messages from "./chat";

const SAVED = "thuoc-doctor-session"; // localStorage key: stay logged in across reloads
const POLL_MS = 3000;
const LOW = 5; // matches the backend's low-pill rule; display only
const FULL = 30; // meter scale

type Data = {
  contacts: Contact[];
  patients: Patient[];
  alerts: Alert[];
  meds: Record<number, Medicine[]>;
  doses: Record<number, DoseLog[]>;
};

// Browsers only allow popups on https or localhost, so the hotspot IP gets "unsupported".
type Popups = NotificationPermission | "unsupported";
const popupsSupported = () => typeof window !== "undefined" && window.isSecureContext && "Notification" in window;

const ALERT_LABEL: Record<Alert["type"], string> = {
  missed: "Missed dose", low_pills: "Refill needed", expiring_soon: "Expiring soon",
};

export default function Dashboard() {
  const [session, setSession] = useState<Session | null | undefined>(undefined); // undefined: not read yet
  const save = useCallback((s: Session | null) => {
    try { localStorage.setItem(SAVED, JSON.stringify(s)); } catch {}
    setToken(s?.token ?? null);
    setSession(s);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      let s: Session | null = null;
      try { s = JSON.parse(localStorage.getItem(SAVED) ?? "null"); } catch {}
      save(s);
    }, 0);
    onUnauthorized(() => save(null)); // session gone (logged out elsewhere, demo reset): back to login
    return () => { clearTimeout(t); onUnauthorized(null); };
  }, [save]);

  if (session === undefined) return null;
  if (!session) return <Login onLogin={save} />;
  async function logout() {
    await api("/logout", { method: "POST" }).catch(() => {});
    save(null);
  }
  return <DoctorView doctor={session.user} onLogout={logout} />;
}

const json = (body: unknown): RequestInit => ({
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [signingUp, setSigningUp] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const s = signingUp
        ? await api<Session>("/signup", json({ ...form, role: "doctor" }))
        : await api<Session>("/login", json({ email: form.email, password: form.password }));
      if (s.user.role !== "doctor") {
        await api("/logout", { method: "POST", headers: { Authorization: `Bearer ${s.token}` } }).catch(() => {});
        return setError("This page is for doctors. Patients and family use the phone app.");
      }
      onLogin(s);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel login" onSubmit={submit}>
      <h1>ThuocTracker</h1>
      <p className="note">{signingUp ? "Create a doctor account. Patients then sign up in the app with your email." : "Doctor login"}</p>
      {signingUp && (
        <label className="field">Name
          <input value={form.name} onChange={set("name")} required placeholder="Dr. Nguyen" />
        </label>
      )}
      <label className="field">Email
        <input type="email" value={form.email} onChange={set("email")} required autoFocus autoComplete="username" />
      </label>
      <label className="field">Password {signingUp && <small>at least 6 characters</small>}
        <input type="password" value={form.password} onChange={set("password")} required minLength={signingUp ? 6 : undefined}
          autoComplete={signingUp ? "new-password" : "current-password"} />
      </label>
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "One moment…" : signingUp ? "Create account" : "Log in"}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="button" className="btn btn-sm" onClick={() => { setSigningUp(!signingUp); setError(null); }}>
        {signingUp ? "I have an account" : "New doctor? Create an account"}
      </button>
    </form>
  );
}

function DoctorView({ doctor, onLogout }: { doctor: User; onLogout: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [online, setOnline] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<Medicine | "new" | null>(null);
  const [tab, setTab] = useState<"alerts" | "messages">("alerts");
  const [chatWith, setChatWith] = useState<number | null>(null);
  const [newAlerts, setNewAlerts] = useState<Set<number>>(new Set());
  const seen = useRef<Set<number> | null>(null);
  const [popups, setPopups] = useState<Popups>("unsupported");

  // shortcut: refetches everything every 3 s; fine for a few demo patients, use /alerts?since= at scale
  const load = useCallback(async () => {
    try {
      const [contacts, alerts] = await Promise.all([api<Contact[]>("/contacts"), api<Alert[]>("/alerts")]);
      const patients = contacts.map((c) => c.user).filter((u): u is Patient => u.role === "patient");
      const per = await Promise.all(patients.map((p) => Promise.all([
        api<Medicine[]>(`/patients/${p.id}/medicines`),
        api<DoseLog[]>(`/patients/${p.id}/doses`),
      ])));
      const ids = new Set(alerts.map((a) => a.id));
      const fresh = seen.current ? [...ids].filter((id) => !seen.current!.has(id)) : [];
      seen.current = ids;
      if (fresh.length) setNewAlerts(new Set(fresh));
      if (fresh.length && popupsSupported() && Notification.permission === "granted") {
        for (const a of alerts.filter((x) => fresh.includes(x.id))) {
          const who = patients.find((p) => p.id === a.patient_id)?.name ?? `Patient ${a.patient_id}`;
          new Notification(`${ALERT_LABEL[a.type]}: ${who}`, { body: a.message, tag: `alert-${a.id}` });
        }
      }
      setData({
        contacts,
        patients,
        alerts: [...alerts].sort((a, b) => b.at.localeCompare(a.at)),
        meds: Object.fromEntries(patients.map((p, i) => [p.id, per[i][0]])),
        doses: Object.fromEntries(patients.map((p, i) => [p.id, per[i][1]])),
      });
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => {
      if (popupsSupported()) setPopups(Notification.permission);
      load();
    }, 0);
    const t = setInterval(load, POLL_MS);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [load]);

  const patient = data?.patients.find((p) => p.id === selected) ?? data?.patients[0];

  async function enablePopups() {
    setPopups(await Notification.requestPermission());
  }

  const unread = data?.contacts.reduce((n, c) => n + c.unread, 0) ?? 0;
  function message(id: number) {
    setTab("messages");
    setChatWith(id);
  }

  async function resetDemo() {
    await api("/demo/reset", { method: "POST" }).catch(() => setOnline(false));
    seen.current = null;
    load();
  }

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="logo"><Logo /></span>
          <h1>ThuocTracker</h1>
          <small>{doctor.name}</small>
        </div>
        <div className={`live${online ? "" : " down"}`} role="status">
          <span className="dot" aria-hidden="true" />
          {!data ? "Connecting…" : online ? "Live" : "Backend offline"}
        </div>
        {popups === "default" && (
          <button className="btn btn-sm btn-ghost-light" type="button" onClick={enablePopups}
            title="Show a desktop notification when a new alert comes in">
            <Icon name="bell" /> Turn on popups
          </button>
        )}
        <button className="btn btn-sm btn-ghost-light" type="button" onClick={resetDemo} title="Reload sample patients">
          Reset demo
        </button>
        <button className="btn btn-sm btn-ghost-light" type="button" onClick={onLogout}>Log out</button>
      </header>

      {!online && (
        <div className="error-banner" role="alert">
          Can&apos;t reach the backend. Is <code>uvicorn backend.main:app</code> running? Retrying every 3 s.
        </div>
      )}

      <main className="layout">
        <nav className="panel" aria-label="Patients">
          <h2>Patients</h2>
          <ul className="patient-list">
            {data?.patients.map((p) => {
              const count = data.alerts.filter((a) => a.patient_id === p.id).length;
              return (
                <li key={p.id}>
                  <button type="button" className="patient-btn" aria-current={p.id === patient?.id}
                    onClick={() => setSelected(p.id)}>
                    <span className="avatar" aria-hidden="true">{initials(p.name)}</span>
                    <span>
                      <strong>{p.name}</strong>
                      <span>Age {p.age} · {plural(data.meds[p.id]?.length ?? 0, "medicine")}</span>
                    </span>
                    {count > 0 && <span className="count" aria-label={`${count} alerts`}>{count}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {data && !data.patients.length && <p className="empty">No patients yet.</p>}
        </nav>

        <section className="panel">
          {patient && data ? (
            <PatientView patient={patient} meds={data.meds[patient.id] ?? []} doses={data.doses[patient.id] ?? []}
              family={data.contacts.map((c) => c.user).filter((u): u is Family => u.role === "family" && u.patient_id === patient.id)}
              onEdit={setEditing} onChange={load} onMessage={message} />
          ) : (
            <p className="empty">{data ? "Select a patient." : "Loading patients…"}</p>
          )}
        </section>

        <aside className="panel alerts" aria-label="Alerts and messages">
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "alerts"} onClick={() => setTab("alerts")}>
              Alerts
            </button>
            <button type="button" role="tab" aria-selected={tab === "messages"} onClick={() => setTab("messages")}>
              Messages{unread > 0 && <span className="count">{unread}</span>}
            </button>
          </div>
          {tab === "messages" ? (
            <Messages me={doctor} contacts={data?.contacts ?? []} withId={chatWith} onOpen={setChatWith} onChange={load} />
          ) : (<>
          <ol className="alert-list" aria-live="polite">
            {data?.alerts.map((a) => {
              const who = data.patients.find((p) => p.id === a.patient_id);
              return (
                <li key={a.id} className={`alert ${a.type}${newAlerts.has(a.id) ? " new" : ""}`}>
                  <Icon name={a.type === "missed" ? "x" : a.type === "low_pills" ? "pill" : "clock"} />
                  <div>
                    <div className="alert-head">
                      <span>{ALERT_LABEL[a.type]}</span>
                      <span>To {a.to}</span>
                    </div>
                    <p>{a.message}</p>
                    <small>{who?.name ?? `Patient ${a.patient_id}`} · {fmtDateTime(a.at)}</small>
                    <small className="sent">
                      <Icon name="bell" />
                      Push sent to {a.to === "family" ? "family's" : "doctor's"} phone
                    </small>
                  </div>
                </li>
              );
            })}
          </ol>
          {data && !data.alerts.length && <p className="empty">No alerts. Everyone is on track.</p>}
          </>)}
        </aside>
      </main>

      {editing && patient && (
        <AddMedicine patient={patient} meds={data?.meds[patient.id] ?? []} med={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </>
  );
}

function PatientView({ patient, meds, doses, family, onEdit, onChange, onMessage }: {
  patient: Patient; meds: Medicine[]; doses: DoseLog[]; family: Family[];
  onEdit: (m: Medicine | "new") => void; onChange: () => void; onMessage: (userId: number) => void;
}) {
  const onAdd = () => onEdit("new");
  const [busy, setBusy] = useState<number | null>(null);
  const taken = doses.filter((d) => d.status === "taken").length;
  const missed = doses.filter((d) => d.status === "missed").length;
  const adherence = taken + missed ? Math.round((100 * taken) / (taken + missed)) : null;
  const medName = (id: number) => meds.find((m) => m.id === id)?.name ?? `Medicine ${id}`;
  const lowest = [...meds].sort((a, b) => a.pills_left - b.pills_left)[0];
  const firstFree = SLOTS.find((s) => !meds.some((m) => m.slot === s));

  async function pillTime(m: Medicine) {
    setBusy(m.id);
    await api(`/demo/pill_time?medicine_id=${m.id}`, { method: "POST" }).catch(() => {});
    setBusy(null);
    onChange();
  }

  return (
    <>
      <div className="patient-head">
        <div>
          <h2>{patient.name}</h2>
          <div className="meta">
            Age {patient.age} · {patient.email} · <a href={`/cabinet?patient=${patient.id}`} target="_blank">Cabinet screen</a>
          </div>
          <ul className="family">
            <li>
              <button type="button" className="btn btn-sm" onClick={() => onMessage(patient.id)}>Message {patient.name}</button>
            </li>
            {family.map((f) => (
              <li key={f.id}>
                <span>Family: <b>{f.name}</b> <small>{f.email}</small></span>
                <button type="button" className="btn btn-sm" onClick={() => onMessage(f.id)}>Message</button>
              </li>
            ))}
            {!family.length && <li className="note">No family linked yet. They sign up in the app with {patient.email}.</li>}
          </ul>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={onAdd} disabled={!firstFree}>
            <Icon name="plus" /> Add medicine
          </button>
        </div>
      </div>

      <div className="stats">
        <div className="stat"><b>{adherence === null ? "—" : `${adherence}%`}</b><span>Adherence</span></div>
        <div className="stat"><b>{taken}</b><span>Doses taken</span></div>
        <div className="stat"><b style={missed ? { color: "var(--bad)" } : undefined}>{missed}</b><span>Missed</span></div>
        <div className="stat">
          <b style={lowest && lowest.pills_left < LOW ? { color: "var(--bad)" } : undefined}>{lowest?.pills_left ?? "—"}</b>
          <span>{lowest ? `Lowest supply (${lowest.name})` : "Lowest supply"}</span>
        </div>
      </div>

      <div className="section-title"><h3>Cabinet prescriptions</h3></div>
      <div className="rx-grid">
        {/* 7 boxes: show the filled ones plus a single "add" card for the next free box */}
        {SLOTS.filter((s) => s === firstFree || meds.some((m) => m.slot === s)).map((slot) => {
          const m = meds.find((x) => x.slot === slot);
          if (!m) {
            return (
              <button key={slot} type="button" className="rx slot-empty" onClick={onAdd}>
                <span className="slot-label">SLOT {slot}{slot === LONG_SLOT ? " (LONG)" : ""} · EMPTY</span>
                <Icon name="plus" />
                <span>Add medicine</span>
              </button>
            );
          }
          const days = daysUntil(m.expiration);
          const low = m.pills_left < LOW;
          return (
            <article key={slot} className="rx" aria-label={`Slot ${slot}: ${m.name}`}>
              <div className="rx-top"><span>Rx #{String(m.id).padStart(5, "0")}</span><span>SLOT {slot}</span></div>
              <div className="rx-body">
                <div className="rx-name">
                  <span className="pill-dot" style={{ background: pillColor(m.color) }} title={`${m.color} pill`} />
                  {m.name}
                </div>
                <div className="rx-sig">Take <b>{m.dose}</b> at <b>{m.times.join(" · ")}</b></div>
                <div>
                  <div className={`meter${low ? " low" : ""}`} role="meter" aria-valuemin={0} aria-valuemax={FULL}
                    aria-valuenow={m.pills_left} aria-label="Pills left">
                    <i style={{ width: `${Math.min(100, (100 * m.pills_left) / FULL)}%` }} />
                  </div>
                </div>
                <div className="rx-foot">
                  <span className={low ? "bad" : ""}>{m.pills_left} left{low ? " · Refill" : ""}</span>
                  <span className={days <= 7 ? "bad" : ""}>
                    Exp {fmtDate(m.expiration)}{days <= 7 ? ` (${days < 0 ? "expired" : `${days} d`})` : ""}
                  </span>
                </div>
              </div>
              <div className="rx-actions">
                <button type="button" className="btn btn-sm" onClick={() => pillTime(m)} disabled={busy === m.id}
                  title="Demo: start this dose now on the cabinet">
                  <Icon name="bell" /> {busy === m.id ? "Sending…" : "Pill time now"}
                </button>
                <button type="button" className={`btn btn-sm${low ? " btn-primary" : ""}`} onClick={() => onEdit(m)}>
                  {low ? "Refill" : "Edit"}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="section-title"><h3>Cabinet camera test</h3></div>
      <CameraTest key={patient.id} patientId={patient.id} doses={doses} meds={meds} onChange={onChange} />

      <div className="section-title"><h3>Dose history</h3></div>
      {doses.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Medicine</th><th>Due</th><th>Status</th><th>Taken at</th><th>Confirmed by</th></tr></thead>
            <tbody>
              {doses.map((d) => (
                <tr key={d.id}>
                  <td>{medName(d.medicine_id)}</td>
                  <td>{fmtDateTime(d.due_at)}</td>
                  <td>
                    <span className={`badge ${d.status}`}>
                      <Icon name={d.status === "taken" ? "check" : d.status === "missed" ? "x" : "clock"} />
                      {d.status === "taken" ? "Taken" : d.status === "missed" ? "Missed" : "Waiting"}
                    </span>
                  </td>
                  <td>{d.taken_at ? fmtTime(d.taken_at) : "—"}</td>
                  <td className="method">{d.method === "camera" ? "Cabinet camera" : d.method === "screen" ? "Screen tap" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">No doses yet.</p>
      )}
    </>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const initials =(name: string) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
