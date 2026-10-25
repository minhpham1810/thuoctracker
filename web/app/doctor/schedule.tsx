"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { api, clock, ymdOf, type Appointment } from "@/lib/api";

const LENGTHS = [15, 30, 60]; // minutes per visit
const DAYS = 14; // matches GET /schedule

// The doctor's appointments: open new times, see who booked and why, remove or cancel. Patients (or their
// family) book in the phone app.
export default function Schedule({ slots, now, onOpen, onChange }: {
  slots: Appointment[]; now: Date; onOpen: (patientId: number) => void; onChange: () => void;
}) {
  const days = nextDays(now, DAYS);
  const [day, setDay] = useState(days[1]); // tomorrow: the usual case
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("12:00");
  const [minutes, setMinutes] = useState(30);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null); // a booked visit waiting for the second click

  useEffect(() => {
    if (confirm === null) return;
    const t = setTimeout(() => setConfirm(null), 4000);
    return () => clearTimeout(t);
  }, [confirm]);

  async function open(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNote(null);
    setBusy(true);
    try {
      const r = await api<{ added: Appointment[]; skipped: number }>("/availability", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ day, start, end, minutes }),
      });
      const n = r.added.length;
      setNote(n
        ? `Opened ${n} ${n === 1 ? "time" : "times"}, ${dayLabel(day, now).toLowerCase()}.`
          + (r.skipped ? ` ${r.skipped} skipped: already in your schedule or already passed.` : "")
        : "Nothing new: those times are already in your schedule or have passed.");
      onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Booked visits take two clicks: the patient and their family are told it was cancelled
  async function remove(x: Appointment) {
    setError(null);
    if (x.patient_id && confirm !== x.id) return setConfirm(x.id);
    setConfirm(null);
    try {
      await api(`/slots/${x.id}`, { method: "DELETE" });
      onChange();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const booked = slots.filter((x) => x.patient_id).length;
  const nowIso = isoMinute(now);
  return (
    <div className="sched">
      <p className="sched-sum"><b>{booked} booked</b>, {slots.length - booked} open <span>next {DAYS} days</span></p>

      <form className="sched-form" onSubmit={open}>
        <h3>Open new times</h3>
        <label className="field">Day
          <select value={day} onChange={(e) => setDay(e.target.value)}>
            {days.map((d) => <option key={d} value={d}>{dayLabel(d, now)}</option>)}
          </select>
        </label>
        <div className="fields">
          <label className="field">From
            <input type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} required />
          </label>
          <label className="field">To
            <input type="time" step={300} value={end} onChange={(e) => setEnd(e.target.value)} required />
          </label>
        </div>
        <label className="field">Each visit
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {LENGTHS.map((n) => <option key={n} value={n}>{n} minutes</option>)}
          </select>
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {note && <p className="note ok" role="status">{note}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          <Icon name="plus" /> {busy ? "Opening…" : "Open these times"}
        </button>
      </form>

      {!slots.length && <p className="empty">No times yet. Open some above; patients book them in the phone app.</p>}
      {byDay(slots).map(([d, list]) => (
        <section key={d}>
          <h3 className="inbox-day">{dayLabel(d, now)}</h3>
          <ol className="slot-list">
            {list.map((x) => (
              <li key={x.id} className={`slot${x.patient_id ? " booked" : ""}${x.starts_at < nowIso ? " past" : ""}`}>
                <time className="slot-time" dateTime={x.starts_at}>
                  {clock(x.starts_at.slice(11, 16))}<small>{x.minutes} min</small>
                </time>
                <div className="slot-body">
                  {x.patient_id ? (
                    <>
                      <button type="button" className="link" onClick={() => onOpen(x.patient_id!)}>{x.patient_name}</button>
                      {x.reason && <span className="slot-reason">{x.reason}</span>}
                    </>
                  ) : <span className="slot-open">Open</span>}
                </div>
                <button type="button" className={`btn btn-sm ${confirm === x.id ? "btn-danger" : "btn-quiet"}`}
                  onClick={() => remove(x)}
                  aria-label={x.patient_id ? `Cancel ${x.patient_name}'s visit at ${clock(x.starts_at.slice(11, 16))}`
                    : `Remove the open time ${clock(x.starts_at.slice(11, 16))}`}>
                  {x.patient_id ? (confirm === x.id ? "Click again to cancel" : "Cancel") : "Remove"}
                </button>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

// "Next visit Tomorrow at 10:00 AM" for the chart header
export function visitLabel(x: Appointment, now: Date) {
  return `${dayLabel(x.starts_at.slice(0, 10), now)} at ${clock(x.starts_at.slice(11, 16))}`;
}

// Backend times are naive local ISO strings, compared as text against this
export const isoMinute = (d: Date) => `${ymdOf(d)}T${d.toTimeString().slice(0, 5)}`;

function nextDays(now: Date, n: number) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    return ymdOf(d);
  });
}

function dayLabel(ymd: string, now: Date) {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (ymd === ymdOf(now)) return "Today";
  if (ymd === ymdOf(tomorrow)) return "Tomorrow";
  return new Date(`${ymd}T00:00`).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

// [[day, [slots…]], …], already in time order from the backend
function byDay(list: Appointment[]) {
  const map = new Map<string, Appointment[]>();
  for (const x of list) map.set(x.starts_at.slice(0, 10), [...(map.get(x.starts_at.slice(0, 10)) ?? []), x]);
  return [...map];
}
