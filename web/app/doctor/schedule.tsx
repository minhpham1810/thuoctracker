"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { api, clock, ymdOf, type Appointment } from "@/lib/api";

const LENGTHS = [15, 30, 60]; // minutes per visit
const AHEAD_DAYS = 120; // matches the backend's MAX_AHEAD_DAYS (about 3 months on the calendar)
const REPEATS = [0, 3, 7, 12]; // extra weeks: just this day, 4 weeks, 8 weeks, 13 weeks (~3 months)
const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// The doctor's appointments as a month calendar: pick a day, see its times, open new ones (optionally every week
// for up to 3 months), remove a time or cancel a visit. Patients (or family) book in the phone app.
export default function Schedule({ slots, now, onOpen, onChange }: {
  slots: Appointment[]; now: Date; onOpen: (patientId: number) => void; onChange: () => void;
}) {
  const today = ymdOf(now);
  const last = addDays(today, AHEAD_DAYS);
  const [day, setDay] = useState(addDays(today, 1)); // tomorrow: the usual case
  const [month, setMonth] = useState(day.slice(0, 7)); // "2026-10"
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("12:00");
  const [minutes, setMinutes] = useState(30);
  const [repeat, setRepeat] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null); // a booked visit waiting for the second click

  useEffect(() => {
    if (confirm === null) return;
    const t = setTimeout(() => setConfirm(null), 4000);
    return () => clearTimeout(t);
  }, [confirm]);

  const counts = new Map<string, { open: number; booked: number }>();
  for (const x of slots) {
    const c = counts.get(x.starts_at.slice(0, 10)) ?? { open: 0, booked: 0 };
    if (x.patient_id) c.booked++;
    else c.open++;
    counts.set(x.starts_at.slice(0, 10), c);
  }
  const onDay = slots.filter((x) => x.starts_at.startsWith(day));
  const weekday = WEEK[new Date(`${day}T00:00`).getDay()];

  function pick(d: string) {
    setDay(d);
    setNote(null);
    setError(null);
  }

  async function open(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNote(null);
    setBusy(true);
    try {
      const r = await api<{ added: Appointment[]; skipped: number }>("/availability", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day, start, end, minutes, repeat_weeks: repeat }),
      });
      const n = r.added.length;
      const days = new Set(r.added.map((x) => x.starts_at.slice(0, 10))).size;
      setNote(n
        ? `Opened ${n} ${n === 1 ? "time" : "times"}${days > 1 ? ` on ${days} days` : ""}.`
          + (r.skipped ? ` ${r.skipped} skipped: already in your schedule, past, or more than 3 months out.` : "")
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
      <p className="sched-sum"><b>{booked} booked</b>, {slots.length - booked} open <span>the next 3 months</span></p>

      <MonthCalendar month={month} onMonth={setMonth} selected={day} onSelect={pick} counts={counts}
        min={today} max={last} />

      <section aria-labelledby="day-h">
        <h3 id="day-h" className="inbox-day">{dayLabel(day, now)}</h3>
        {!onDay.length && <p className="empty">No times on this day yet.</p>}
        <ol className="slot-list">
          {onDay.map((x) => (
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

      <form className="sched-form" onSubmit={open}>
        <h3>Open times {["Today", "Tomorrow"].includes(dayLabel(day, now)) ? dayLabel(day, now).toLowerCase() : `on ${dayLabel(day, now)}`}</h3>
        <div className="fields">
          <label className="field">From
            <input type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} required />
          </label>
          <label className="field">To
            <input type="time" step={300} value={end} onChange={(e) => setEnd(e.target.value)} required />
          </label>
        </div>
        <div className="fields">
          <label className="field">Each visit
            <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {LENGTHS.map((n) => <option key={n} value={n}>{n} minutes</option>)}
            </select>
          </label>
          <label className="field">Repeat
            <select value={repeat} onChange={(e) => setRepeat(Number(e.target.value))}>
              {REPEATS.map((w) => (
                <option key={w} value={w}>{w === 0 ? "Just this day" : `Every ${weekday}, ${w + 1} weeks`}</option>
              ))}
            </select>
          </label>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {note && <p className="note ok" role="status">{note}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy || day < today}>
          <Icon name="plus" /> {busy ? "Opening…" : "Open these times"}
        </button>
      </form>
    </div>
  );
}

// Month grid. Dots: green = open times, teal = booked visits. Days before `min` or after `max` can't be picked.
function MonthCalendar({ month, onMonth, selected, onSelect, counts, min, max }: {
  month: string; onMonth: (m: string) => void; selected: string; onSelect: (d: string) => void;
  counts: Map<string, { open: number; booked: number }>; min: string; max: string;
}) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const daysIn = new Date(y, m, 0).getDate();
  const cells: (string | null)[] = [
    ...Array<null>(first.getDay()).fill(null),
    ...Array.from({ length: daysIn }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
  const shift = (n: number) => {
    const d = new Date(y, m - 1 + n, 1);
    onMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  return (
    <div className="cal">
      <div className="cal-head">
        <button type="button" className="btn btn-quiet btn-icon" onClick={() => shift(-1)} disabled={month <= min.slice(0, 7)}
          aria-label="Previous month"><Icon name="back" /></button>
        <h3 aria-live="polite">{first.toLocaleDateString([], { month: "long", year: "numeric" })}</h3>
        <button type="button" className="btn btn-quiet btn-icon cal-next" onClick={() => shift(1)} disabled={month >= max.slice(0, 7)}
          aria-label="Next month"><Icon name="back" /></button>
      </div>
      <div className="cal-grid" role="grid">
        {WEEK.map((w) => <span key={w} className="cal-wd" aria-hidden="true">{w[0]}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={`b${i}`} />;
          const c = counts.get(d);
          const out = d < min || d > max;
          const label = `${d.slice(8)}: ${c ? `${c.open} open, ${c.booked} booked` : "no times"}`;
          return (
            <button key={d} type="button" onClick={() => onSelect(d)} disabled={out} aria-pressed={d === selected}
              aria-label={label} className={`cal-day${d === min ? " today" : ""}${c?.open ? " has-open" : ""}`}>
              <span>{Number(d.slice(8))}</span>
              <i aria-hidden="true">{c?.open ? <b className="dot open" /> : null}{c?.booked ? <b className="dot booked" /> : null}</i>
            </button>
          );
        })}
      </div>
      <p className="cal-key" aria-hidden="true"><b className="dot open" /> open <b className="dot booked" /> booked</p>
    </div>
  );
}

// "Next visit Tomorrow at 10:00 AM" for the chart header
export function visitLabel(x: Appointment, now: Date) {
  return `${dayLabel(x.starts_at.slice(0, 10), now)} at ${clock(x.starts_at.slice(11, 16))}`;
}

// Backend times are naive local ISO strings, compared as text against this
export const isoMinute = (d: Date) => `${ymdOf(d)}T${d.toTimeString().slice(0, 5)}`;

function addDays(ymd: string, n: number) {
  const d = new Date(`${ymd}T00:00`);
  d.setDate(d.getDate() + n);
  return ymdOf(d);
}

function dayLabel(ymd: string, now: Date) {
  if (ymd === ymdOf(now)) return "Today";
  if (ymd === addDays(ymdOf(now), 1)) return "Tomorrow";
  return new Date(`${ymd}T00:00`).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}
