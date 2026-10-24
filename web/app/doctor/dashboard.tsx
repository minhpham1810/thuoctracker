"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, Logo } from "@/components/icon";
import {
  api, daysUntil, fmtDate, fmtDateTime, fmtTime, LONG_SLOT, pillColor, SLOTS,
  type Alert, type DoseLog, type Medicine, type Patient,
} from "@/lib/api";
import AddMedicine from "./add-medicine";
import CameraTest from "./camera-test";

const DOCTOR_ID = 1;
const POLL_MS = 3000;
const LOW = 5; // matches the backend's low-pill rule; display only
const FULL = 30; // meter scale

type Data = {
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
  const [data, setData] = useState<Data | null>(null);
  const [online, setOnline] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [newAlerts, setNewAlerts] = useState<Set<number>>(new Set());
  const seen = useRef<Set<number> | null>(null);
  const [popups, setPopups] = useState<Popups>("unsupported");

  // shortcut: refetches everything every 3 s; fine for a few demo patients, use /alerts?since= at scale
  const load = useCallback(async () => {
    try {
      const [patients, alerts] = await Promise.all([
        api<Patient[]>(`/patients?doctor_id=${DOCTOR_ID}`),
        api<Alert[]>("/alerts"),
      ]);
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
          <small>Doctor portal</small>
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
              onAdd={() => setAdding(true)} onChange={load} />
          ) : (
            <p className="empty">{data ? "Select a patient." : "Loading patients…"}</p>
          )}
        </section>

        <aside className="panel alerts" aria-labelledby="alerts-title">
          <h2 id="alerts-title">Alerts</h2>
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
        </aside>
      </main>

      {adding && patient && (
        <AddMedicine patient={patient} meds={data?.meds[patient.id] ?? []}
          onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />
      )}
    </>
  );
}

function PatientView({ patient, meds, doses, onAdd, onChange }: {
  patient: Patient; meds: Medicine[]; doses: DoseLog[]; onAdd: () => void; onChange: () => void;
}) {
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
          <div className="meta">Age {patient.age} · Patient {patient.phone} · Family {patient.family_phone}</div>
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
