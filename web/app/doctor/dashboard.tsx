"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, Logo, type IconName } from "@/components/icon";
import {
  api, clock, daysUntil, fmtDate, fmtDateTime, fmtTime, initials, LONG_SLOT, onUnauthorized, pillColor, setToken, SLOTS,
  todayItems, ymdOf,
  type Alert, type Appointment, type Contact, type DoseLog, type Family, type Medicine, type Patient, type Session, type TodayItem,
  type User,
} from "@/lib/api";
import AddMedicine from "./add-medicine";
import CameraTest from "./camera-test";
import { DisplayMenu, useDisplay, type Display } from "./display";
import DrugLabels from "./drug-labels";
import Messages from "./chat";
import Schedule, { isoMinute, visitLabel } from "./schedule";

const SAVED = "thuoc-doctor-session"; // localStorage key: stay logged in across reloads
const POLL_MS = 3000;
const LOW = 5; // matches the backend's low-pill rule; display only
const EXPIRING_DAYS = 7; // matches the backend's expiring-soon rule; display only
const FULL = 30; // meter scale
const HISTORY_DAYS = 14;

// What the patient list says about each patient, most urgent first. Display only.
type Tone = "bad" | "due" | "warn" | "ok";
type Triage = { rank: number; tone: Tone; text: string };

// One event can produce a doctor row and a family row: shown once, with who was told.
type AlertGroup = Alert & { ids: number[]; doctor: boolean; family: boolean };

type Data = {
  now: Date;
  contacts: Contact[];
  patients: Patient[]; // most urgent first
  triage: Record<number, Triage>;
  alerts: AlertGroup[];
  meds: Record<number, Medicine[]>;
  doses: Record<number, DoseLog[]>;
  slots: Appointment[]; // the doctor's appointment times, open and booked
};

// Browsers only allow popups on https or localhost, so the hotspot IP gets "unsupported".
type Popups = NotificationPermission | "unsupported";
const popupsSupported = () => typeof window !== "undefined" && window.isSecureContext && "Notification" in window;

const ALERT_LABEL: Record<Alert["type"], string> = {
  missed: "Missed dose", low_pills: "Refill needed", expiring_soon: "Expiring soon",
};
const ALERT_ICON: Record<Alert["type"], IconName> = { missed: "x", low_pills: "pill", expiring_soon: "clock" };

export default function Dashboard() {
  const [session, setSession] = useState<Session | null | undefined>(undefined); // undefined: not read yet
  const display = useDisplay();
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

  // theme and text size wrap the login screen too
  const shell = (children?: React.ReactNode) => (
    <div className={`dash${display.dark ? " dark" : ""}`} style={{ "--fs": display.scale } as React.CSSProperties}>
      {children}
    </div>
  );
  if (session === undefined) return shell();
  if (!session) return shell(<Login onLogin={save} />);
  async function logout() {
    await api("/logout", { method: "POST" }).catch(() => {});
    save(null);
  }
  return shell(<DoctorView doctor={session.user} onLogout={logout} display={display} />);
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
    <main className="signin">
      <form className="signin-card" onSubmit={submit}>
        <Logo size={48} invert />
        <h1>{signingUp ? "Create a doctor account" : "Log in to ThuocTracker"}</h1>
        <p className="lede">
          {signingUp
            ? "Your patients then sign up in the phone app with your email, and their cabinets show up here."
            : "See every patient's cabinet, today's doses and alerts in one place."}
        </p>
        {signingUp && (
          <label className="field">Name
            <input value={form.name} onChange={set("name")} required placeholder="Dr. Nguyen" autoComplete="name" />
          </label>
        )}
        <label className="field">Email
          <input type="email" value={form.email} onChange={set("email")} required autoFocus autoComplete="username" />
        </label>
        <label className="field">Password {signingUp && <small>At least 6 characters</small>}
          <input type="password" value={form.password} onChange={set("password")} required minLength={signingUp ? 6 : undefined}
            autoComplete={signingUp ? "new-password" : "current-password"} />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "One moment…" : signingUp ? "Create account" : "Log in"}
        </button>
        <p className="signin-switch">
          {signingUp ? "Already have an account?" : "New doctor?"}{" "}
          <button type="button" className="link" onClick={() => { setSigningUp(!signingUp); setError(null); }}>
            {signingUp ? "Log in" : "Create an account"}
          </button>
        </p>
        <p className="signin-foot">Patients and family use the ThuocTracker phone app.</p>
      </form>
    </main>
  );
}

function DoctorView({ doctor, onLogout, display }: { doctor: User; onLogout: () => void; display: Display }) {
  const [data, setData] = useState<Data | null>(null);
  const [online, setOnline] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<Medicine | number | null>(null); // number: a new medicine for that box
  const [tab, setTab] = useState<"alerts" | "messages" | "schedule">("alerts");
  const [chatWith, setChatWith] = useState<number | null>(null);
  const [newAlerts, setNewAlerts] = useState<Set<number>>(new Set());
  const seen = useRef<Set<number> | null>(null);
  const [popups, setPopups] = useState<Popups>("unsupported");

  // shortcut: refetches everything every 3 s; fine for a few demo patients, use /alerts?since= at scale
  const load = useCallback(async () => {
    try {
      const [contacts, alerts, slots] = await Promise.all([
        api<Contact[]>("/contacts"), api<Alert[]>("/alerts"),
        // a backend from before appointments has no /schedule: an empty schedule, not an offline dashboard
        api<Appointment[]>("/schedule").catch(() => [] as Appointment[]),
      ]);
      const now = new Date();
      const all = contacts.map((c) => c.user).filter((u): u is Patient => u.role === "patient");
      const per = await Promise.all(all.map((p) => Promise.all([
        api<Medicine[]>(`/patients/${p.id}/medicines`),
        api<DoseLog[]>(`/patients/${p.id}/doses`),
      ])));
      const meds = Object.fromEntries(all.map((p, i) => [p.id, per[i][0]]));
      const doses = Object.fromEntries(all.map((p, i) => [p.id, per[i][1]]));
      const triage = Object.fromEntries(all.map((p) => [p.id, triageOf(meds[p.id], doses[p.id], now)]));
      const patients = [...all].sort((a, b) => triage[b.id].rank - triage[a.id].rank || a.name.localeCompare(b.name));

      const ids = new Set(alerts.map((a) => a.id));
      const fresh = seen.current ? [...ids].filter((id) => !seen.current!.has(id)) : [];
      seen.current = ids;
      if (fresh.length) setNewAlerts(new Set(fresh));
      if (fresh.length && popupsSupported() && Notification.permission === "granted") {
        for (const a of alerts.filter((x) => fresh.includes(x.id) && x.to === "doctor")) {
          const who = all.find((p) => p.id === a.patient_id)?.name ?? `Patient ${a.patient_id}`;
          new Notification(`${ALERT_LABEL[a.type]}: ${who}`, { body: a.message, tag: `alert-${a.id}` });
        }
      }
      setData({
        now, contacts, patients, triage, meds, doses, slots,
        alerts: groupAlerts([...alerts].sort((a, b) => b.at.localeCompare(a.at))),
      });
      // open the most urgent patient first, then stay on whoever the doctor picked
      setSelected((s) => s ?? patients[0]?.id ?? null);
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

  const attention = data?.patients.filter((p) => data.triage[p.id].rank > 0) ?? [];
  const steady = data?.patients.filter((p) => data.triage[p.id].rank === 0) ?? [];

  return (
    <>
      <header className="appbar">
        <span className="brand"><Logo size={30} /> ThuocTracker</span>
        <span className={`live${!data ? " wait" : online ? "" : " down"}`} role="status">
          <i aria-hidden="true" />
          {!data ? "Connecting…" : online ? "Live" : "Offline"}
        </span>
        <div className="appbar-end">
          {popups === "default" && (
            <button className="btn btn-quiet btn-sm" type="button" onClick={enablePopups}
              title="Show a desktop notification when a new alert comes in">
              <Icon name="bell" /> Turn on popups
            </button>
          )}
          <DisplayMenu display={display} />
          <span className="me"><span className="avatar sm" aria-hidden="true">{initials(doctor.name)}</span>{doctor.name}</span>
          <button className="btn btn-quiet btn-sm" type="button" onClick={onLogout}><Icon name="logout" /> Log out</button>
        </div>
      </header>

      {!online && (
        <div className="offline" role="alert">
          <Icon name="wifiOff" />
          <span>Can&apos;t reach the server. Showing the last data and retrying every 3 seconds. Is <code>uvicorn backend.main:app</code> running?</span>
        </div>
      )}

      <main className="layout">
        <nav className="roster" aria-label="Patients">
          <h2>Patients</h2>
          {!data && <p className="empty">Loading patients…</p>}
          {data && !data.patients.length && (
            <p className="empty">No patients yet. Patients sign up in the phone app with your email, {doctor.email}.</p>
          )}
          {([["Needs attention", attention], ["On track", steady]] as const).map(([title, list]) => list.length > 0 && (
            <section key={title} className="roster-group">
              <h3>{title} <span className="n">{list.length}</span></h3>
              <ul>
                {list.map((p) => {
                  const t = data!.triage[p.id];
                  return (
                    <li key={p.id}>
                      <button type="button" className="patient" aria-current={p.id === patient?.id}
                        onClick={() => setSelected(p.id)}>
                        <span className={`avatar tone-${t.tone}`} aria-hidden="true">{initials(p.name)}</span>
                        <span className="patient-text">
                          <strong>{p.name}</strong>
                          <span className={`reason tone-${t.tone}`}>{t.text}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </nav>

        <section className="chart" aria-label={patient ? `${patient.name}'s chart` : "Patient"}>
          {patient && data ? (
            <PatientView key={patient.id} patient={patient} now={data.now}
              meds={data.meds[patient.id] ?? []} doses={data.doses[patient.id] ?? []}
              family={data.contacts.map((c) => c.user).filter((u): u is Family => u.role === "family" && u.patient_id === patient.id)}
              visit={data.slots.find((x) => x.patient_id === patient.id && x.starts_at >= isoMinute(data.now))}
              onEdit={setEditing} onChange={load} onMessage={message} />
          ) : (
            <p className="empty">{data ? "Pick a patient on the left." : "Loading…"}</p>
          )}
        </section>

        <aside className="inbox" aria-label="Alerts and messages">
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "alerts"} onClick={() => setTab("alerts")}>
              <Icon name="bell" /> Alerts
            </button>
            <button type="button" role="tab" aria-selected={tab === "messages"} onClick={() => setTab("messages")}>
              <Icon name="message" /> Messages{unread > 0 && <span className="count" aria-label={`${unread} unread`}>{unread}</span>}
            </button>
            <button type="button" role="tab" aria-selected={tab === "schedule"} onClick={() => setTab("schedule")}>
              <Icon name="calendar" /> Schedule
            </button>
          </div>
          {tab === "messages" ? (
            <Messages me={doctor} contacts={data?.contacts ?? []} withId={chatWith} onOpen={setChatWith} onChange={load} />
          ) : tab === "schedule" ? (
            data ? <Schedule slots={data.slots} now={data.now} onOpen={setSelected} onChange={load} />
              : <p className="empty">Loading the schedule…</p>
          ) : data ? (
            <AlertList groups={data.alerts} now={data.now} patients={data.patients} fresh={newAlerts}
              onOpen={setSelected} />
          ) : (
            <p className="empty">Loading alerts…</p>
          )}
        </aside>
      </main>

      {editing !== null && patient && (
        <AddMedicine patient={patient} meds={data?.meds[patient.id] ?? []}
          med={typeof editing === "number" ? undefined : editing} slot={typeof editing === "number" ? editing : undefined}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </>
  );
}

function AlertList({ groups, now, patients, fresh, onOpen }: {
  groups: AlertGroup[]; now: Date; patients: Patient[]; fresh: Set<number>; onOpen: (patientId: number) => void;
}) {
  if (!groups.length) return <p className="empty">No alerts. Everyone is on track.</p>;
  const today = ymdOf(now);
  const sections = [
    ["Today", groups.filter((g) => g.at.startsWith(today))],
    ["Earlier", groups.filter((g) => !g.at.startsWith(today))],
  ] as const;
  return (
    <div className="alert-scroll" aria-live="polite">
      {sections.map(([title, list]) => list.length > 0 && (
        <section key={title}>
          <h3 className="inbox-day">{title}</h3>
          <ol className="alert-list">
            {list.map((a) => {
              const who = patients.find((p) => p.id === a.patient_id)?.name ?? `Patient ${a.patient_id}`;
              return (
                <li key={a.id} className={`alert ${a.type}${a.ids.some((id) => fresh.has(id)) ? " new" : ""}`}>
                  <span className="alert-mark"><Icon name={ALERT_ICON[a.type]} /></span>
                  <div className="alert-body">
                    <p className="alert-title"><b>{ALERT_LABEL[a.type]}</b><time dateTime={a.at}>{ago(a.at, now)}</time></p>
                    <p className="alert-msg">{a.message}</p>
                    <p className="alert-meta">
                      <button type="button" className="link" onClick={() => onOpen(a.patient_id)}>Open {who}</button>
                      <span>{a.doctor && a.family ? "Sent to you and the family" : a.family ? "Sent to the family" : "Sent to you"}</span>
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

function PatientView({ patient, now, meds, doses, family, visit, onEdit, onChange, onMessage }: {
  patient: Patient; now: Date; meds: Medicine[]; doses: DoseLog[]; family: Family[]; visit?: Appointment;
  onEdit: (m: Medicine | number) => void; onChange: () => void; onMessage: (userId: number) => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const firstFree = SLOTS.find((s) => !meds.some((m) => m.slot === s));
  const today = todayItems(meds, doses, now);
  const days = dayTotals(doses, now, HISTORY_DAYS);
  const week = days.slice(-7).reduce((t, d) => ({ taken: t.taken + d.taken, missed: t.missed + d.missed }), { taken: 0, missed: 0 });
  const adherence = week.taken + week.missed ? Math.round((100 * week.taken) / (week.taken + week.missed)) : null;
  const medName = (id: number) => meds.find((m) => m.id === id)?.name ?? `Medicine ${id}`;
  const byDay = groupByDay([...doses].sort((a, b) => b.due_at.localeCompare(a.due_at)));

  async function pillTime(m: Medicine) {
    setBusy(m.id);
    await api(`/demo/pill_time?medicine_id=${m.id}`, { method: "POST" }).catch(() => {});
    setBusy(null);
    onChange();
  }

  return (
    <>
      <header className="chart-head">
        <div className="chart-id">
          <h2>{patient.name}</h2>
          <p className="facts">
            <span>{patient.age} years old</span>
            <span>{patient.email}</span>
            {visit && (
              <span className="next-visit">
                <Icon name="calendar" /> Next visit {visitLabel(visit, now)}{visit.reason ? `: ${visit.reason}` : ""}
              </span>
            )}
            <a href={`/cabinet?patient=${patient.id}`} target="_blank" rel="noreferrer">
              Cabinet screen <Icon name="external" /><span className="sr"> (opens in a new tab)</span>
            </a>
          </p>
        </div>
        <div className="chart-actions">
          <button type="button" className="btn" onClick={() => onMessage(patient.id)}>
            <Icon name="message" /> Message
          </button>
          <button type="button" className="btn btn-primary" onClick={() => firstFree && onEdit(firstFree)} disabled={!firstFree}
            title={firstFree ? undefined : "All 7 boxes are full"}>
            <Icon name="plus" /> Add medicine
          </button>
        </div>
        <div className="care">
          <span className="care-label">Family</span>
          {family.map((f) => (
            <span key={f.id} className="person">
              <span className="avatar xs" aria-hidden="true">{initials(f.name)}</span>
              <span><b>{f.name}</b> <small>{f.email}</small></span>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => onMessage(f.id)}
                aria-label={`Message ${f.name}`}>
                <Icon name="message" /> Message
              </button>
            </span>
          ))}
          {!family.length && <span className="muted">None linked yet. Family signs up in the phone app with {patient.email}.</span>}
        </div>
      </header>

      <div className="overview">
        <section className="today" aria-labelledby="today-h">
          <h3 id="today-h">Today</h3>
          {today.length ? (
            <ol className="timeline">
              {today.map((x) => (
                <li key={x.key} className={x.status}>
                  <time className="tl-time">{clock(x.at)}</time>
                  <span className="capsule" style={pill(x.color)} aria-hidden="true" />
                  <span className="tl-name">
                    <b>{x.name}</b>
                    <small>{[x.slot && `Box ${x.slot}`, how(x)].filter(Boolean).join(", ")}</small>
                  </span>
                  <span className={`status ${x.status}`}><Icon name={STATUS_ICON[x.status]} /> {statusText(x)}</span>
                </li>
              ))}
            </ol>
          ) : <p className="empty">No pills scheduled today.</p>}
        </section>

        <section className="adherence" aria-labelledby="adh-h">
          <h3 id="adh-h">Doses taken</h3>
          <p className="adh-rate">
            <b>{adherence === null ? "No data" : `${adherence}%`}</b>
            <span>last 7 days{adherence !== null && `: ${week.taken} taken, ${week.missed} missed`}</span>
          </p>
          <ol className="days" aria-label={`Last ${HISTORY_DAYS} days`}>
            {days.map((d) => {
              const tone = !d.taken && !d.missed ? "none" : !d.missed ? "all" : !d.taken ? "nonetaken" : "some";
              const text = `${dayLabel(d.ymd, now)}: ${tone === "none" ? "no doses" : `${d.taken} taken, ${d.missed} missed`}`;
              return <li key={d.ymd} className={tone} title={text}><span className="sr">{text}</span></li>;
            })}
          </ol>
          <p className="days-axis"><span>{HISTORY_DAYS} days ago</span><span>Today</span></p>
          <ul className="legend" aria-hidden="true">
            <li className="all">All taken</li><li className="some">Some missed</li><li className="nonetaken">All missed</li>
          </ul>
        </section>
      </div>

      <section className="block" aria-labelledby="cab-h">
        <div className="block-head">
          <h3 id="cab-h">Cabinet</h3>
          <p className="muted">{meds.length} of {SLOTS.length} boxes in use</p>
        </div>
        {/* Drawn like the real cabinet: boxes 1-3, 4-6, then the long box 7 */}
        <ol className="cabinet">
          {SLOTS.map((slot) => {
            const m = meds.find((x) => x.slot === slot);
            return m
              ? <Door key={slot} m={m} busy={busy === m.id} onPillTime={() => pillTime(m)} onEdit={() => onEdit(m)} />
              : (
                <li key={slot} className={`recess${slot === LONG_SLOT ? " long" : ""}`}>
                  <button type="button" onClick={() => onEdit(slot)}>
                    <span className="box-n">{slot}</span>
                    <span className="recess-add"><Icon name="plus" /> Add medicine<span className="sr"> to box {slot}</span></span>
                  </button>
                </li>
              );
          })}
        </ol>
      </section>

      <DrugLabels key={patient.id} patientId={patient.id} meds={meds} />

      <section className="block" aria-labelledby="hist-h">
        <div className="block-head"><h3 id="hist-h">Dose history</h3></div>
        {doses.length ? (
          <div className="table-wrap">
            <table className="history">
              <thead><tr><th scope="col">Due</th><th scope="col">Medicine</th><th scope="col">Result</th><th scope="col">Confirmed by</th></tr></thead>
              {byDay.map(([ymd, list]) => (
                <tbody key={ymd}>
                  <tr className="day"><th scope="rowgroup" colSpan={4}>{dayLabel(ymd, now)}</th></tr>
                  {list.map((d) => (
                    <tr key={d.id}>
                      <td className="num">{fmtTime(d.due_at)}</td>
                      <td>{medName(d.medicine_id)}</td>
                      <td>
                        <span className={`status ${d.status === "pending" ? "due" : d.status}`}>
                          <Icon name={d.status === "taken" ? "check" : d.status === "missed" ? "x" : "clock"} />
                          {d.status === "taken" ? `Taken${d.taken_at ? ` ${fmtTime(d.taken_at)}` : ""}` : d.status === "missed" ? "Missed" : "Waiting"}
                        </span>
                      </td>
                      <td className="muted">{d.method === "camera" ? "Cabinet camera" : d.method === "screen" ? "Screen tap" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        ) : (
          <p className="empty">No doses yet. They appear here from the first pill time.</p>
        )}
      </section>

      <details className="tools">
        <summary><Icon name="camera" /> Test the cabinet camera <Icon name="chevron" className="icon chev" /></summary>
        <CameraTest key={patient.id} patientId={patient.id} doses={doses} meds={meds} onChange={onChange} />
      </details>
    </>
  );
}

// One filled box of the cabinet, like a pharmacy label on its door
function Door({ m, busy, onPillTime, onEdit }: { m: Medicine; busy: boolean; onPillTime: () => void; onEdit: () => void }) {
  const days = daysUntil(m.expiration);
  const low = m.pills_left < LOW;
  const supply = Math.floor(m.pills_left / Math.max(1, m.times.length)); // days of pills at this schedule
  return (
    <li className={`door${m.slot === LONG_SLOT ? " long" : ""}${low ? " low" : ""}`} style={pill(m.color)}
      aria-label={`Box ${m.slot}: ${m.name}`}>
      <div className="door-top">
        <span className="box-n">{m.slot}</span>
        <span className="capsule" title={`${m.color} pill`} />
      </div>
      <div className="door-main">
        <h4>{m.name}</h4>
        <p className="sig">{m.dose}, {list(m.times.map(clock))}</p>
      </div>
      <div className="supply">
        <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={FULL} aria-valuenow={m.pills_left} aria-label="Pills left">
          <i style={{ width: `${Math.min(100, (100 * m.pills_left) / FULL)}%` }} />
        </div>
        <p>
          <b>{m.pills_left} left</b>{" "}
          <span>{supply < 1 ? "less than a day" : `about ${supply} ${supply === 1 ? "day" : "days"}`}</span>
        </p>
        <p className={days <= EXPIRING_DAYS ? "expiry warn" : "expiry"}>
          {days <= EXPIRING_DAYS ? <><Icon name="alert" /> {expires(days)}</> : `Expires ${fmtDate(m.expiration)}`}
        </p>
      </div>
      <div className="door-actions">
        <button type="button" className={`btn btn-sm${low ? " btn-primary" : ""}`} onClick={onEdit}>{low ? "Refill" : "Edit"}</button>
        <button type="button" className="btn btn-sm btn-quiet" onClick={onPillTime} disabled={busy}
          title="Demo: start this dose on the cabinet now">
          <Icon name="bell" /> {busy ? "Starting…" : "Pill time now"}
        </button>
      </div>
    </li>
  );
}

const STATUS_ICON: Record<TodayItem["status"], IconName> = { taken: "check", missed: "x", due: "pill", later: "clock" };
function statusText(x: TodayItem) {
  if (x.status === "taken") return x.log?.taken_at ? `Taken ${fmtTime(x.log.taken_at)}` : "Taken";
  return x.status === "missed" ? "Missed" : x.status === "due" ? "Due now" : "Coming up";
}
// how a taken dose was confirmed
const how = (x: TodayItem) =>
  x.status !== "taken" ? "" : x.log?.method === "camera" ? "seen by the cabinet camera" : x.log?.method === "screen" ? "tapped on the screen" : "";

function triageOf(meds: Medicine[], doses: DoseLog[], now: Date): Triage {
  const today = todayItems(meds, doses, now);
  // missed in the last 24 h, so a 9 PM miss still shows at 2 AM
  const missed = doses.filter((d) => d.status === "missed" && now.getTime() - Date.parse(d.due_at) < 86_400_000)
    .sort((a, b) => b.due_at.localeCompare(a.due_at));
  if (missed.length) {
    const d = missed[0];
    const name = meds.find((m) => m.id === d.medicine_id)?.name ?? "a dose";
    const when = d.due_at.startsWith(ymdOf(now)) ? "" : " yesterday";
    return { rank: 3, tone: "bad", text: missed.length > 1 ? `Missed ${missed.length} doses in 24 hours` : `Missed ${name}${when} at ${fmtTime(d.due_at)}` };
  }
  const due = today.find((x) => x.status === "due");
  if (due) return { rank: 2, tone: "due", text: `Pill time now: ${due.name}` };
  const low = [...meds].sort((a, b) => a.pills_left - b.pills_left).find((m) => m.pills_left < LOW);
  if (low) return { rank: 1, tone: "warn", text: `Refill ${low.name}: ${low.pills_left} left` };
  const old = meds.find((m) => daysUntil(m.expiration) <= EXPIRING_DAYS);
  if (old) return { rank: 1, tone: "warn", text: `${old.name}: ${expires(daysUntil(old.expiration)).toLowerCase()}` };
  const taken = today.filter((x) => x.status === "taken").length;
  if (!today.length) return { rank: 0, tone: "ok", text: "No pills today" };
  return { rank: 0, tone: "ok", text: taken ? `${taken} of ${today.length} taken today` : `First pill at ${clock(today[0].at)}` };
}

function groupAlerts(sorted: Alert[]): AlertGroup[] {
  const out: AlertGroup[] = [];
  for (const a of sorted) {
    const twin = out.find((g) => g.patient_id === a.patient_id && g.type === a.type && !g[a.to]
      && Math.abs(Date.parse(g.at) - Date.parse(a.at)) < 120_000);
    if (!twin) {
      out.push({ ...a, ids: [a.id], doctor: a.to === "doctor", family: a.to === "family" });
      continue;
    }
    twin.ids.push(a.id);
    twin[a.to] = true;
    if (a.to === "doctor") twin.message = a.message; // the doctor's wording says what to do
  }
  return out;
}

function dayTotals(doses: DoseLog[], now: Date, n: number) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (n - 1 - i));
    const ymd = ymdOf(d);
    const on = doses.filter((x) => x.due_at.startsWith(ymd));
    return { ymd, taken: on.filter((x) => x.status === "taken").length, missed: on.filter((x) => x.status === "missed").length };
  });
}

function groupByDay(doses: DoseLog[]) {
  const map = new Map<string, DoseLog[]>();
  for (const d of doses) map.set(d.due_at.slice(0, 10), [...(map.get(d.due_at.slice(0, 10)) ?? []), d]);
  return [...map];
}

function dayLabel(ymd: string, now: Date) {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (ymd === ymdOf(now)) return "Today";
  if (ymd === ymdOf(yesterday)) return "Yesterday";
  return new Date(`${ymd}T00:00`).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

function ago(iso: string, now: Date) {
  const min = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  return iso.startsWith(ymdOf(now)) ? fmtTime(iso) : fmtDateTime(iso);
}

const expires = (days: number) =>
  days < 0 ? "Expired" : days === 0 ? "Expires today" : days === 1 ? "Expires tomorrow" : `Expires in ${days} days`;
const list = (items: string[]) => new Intl.ListFormat("en", { type: "conjunction" }).format(items);
const pill = (color: string | null) => ({ "--pill": pillColor(color) }) as React.CSSProperties;
