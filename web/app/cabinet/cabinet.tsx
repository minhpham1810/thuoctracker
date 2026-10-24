"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, Logo, type IconName } from "@/components/icon";
import {
  api, daysUntil, fmtDate, LONG_SLOT, pillColor, SLOTS,
  type CabinetState, type DoseLog, type Medicine, type Slot,
} from "@/lib/api";

const STATE_MS = 1000;
const MEDS_MS = 10_000;
const ASK_MAX_MS = 8000; // stop recording on its own if the patient doesn't tap again
const ANSWER_MS = 15_000; // how long the answer stays on screen
const DETAIL_MS = 15_000; // a tapped box's details close on their own
const LOW = 5; // backend's low-pill rule; display only
const EXPIRING_DAYS = 7; // backend's expiring-soon rule; display only

type Ask =
  | { phase: "off" }
  | { phase: "listening" }
  | { phase: "thinking" }
  | { phase: "answer"; text: string };

const MODE_ICON: Record<CabinetState["mode"], IconName> = {
  idle: "clock", take: "pill", taken: "check", already_took: "alert", missed: "x",
};

export default function Cabinet() {
  const [patientId, setPatientId] = useState<number | null>(null);
  const [state, setState] = useState<CabinetState | null>(null);
  const [meds, setMeds] = useState<Medicine[]>([]);
  const [doses, setDoses] = useState<DoseLog[]>([]);
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState<Date | null>(null); // null until mounted, so server and client HTML match
  const [sending, setSending] = useState(false);
  const [ask, setAsk] = useState<Ask>({ phase: "off" });
  const [detail, setDetail] = useState<Slot | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const closeDetail = useCallback(() => setDetail(null), []);

  useEffect(() => {
    const t = setTimeout(() => setPatientId(Number(new URLSearchParams(location.search).get("patient")) || 1), 0);
    return () => clearTimeout(t);
  }, []);

  const loadState = useCallback(async () => {
    if (!patientId) return;
    setNow(new Date());
    try {
      setState(await api<CabinetState>(`/cabinet/${patientId}/state`));
      setOnline(true);
    } catch {
      setOnline(false); // keep showing the last state
    }
  }, [patientId]);

  const loadMeds = useCallback(async () => {
    if (!patientId) return;
    // box labels and today's list are display only; on failure keep the last ones
    await Promise.all([
      api<Medicine[]>(`/patients/${patientId}/medicines`).then(setMeds).catch(() => {}),
      api<DoseLog[]>(`/patients/${patientId}/doses`).then(setDoses).catch(() => {}),
    ]);
  }, [patientId]);

  useEffect(() => {
    const first = setTimeout(loadState, 0);
    const t = setInterval(loadState, STATE_MS);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [loadState]);

  useEffect(() => {
    const first = setTimeout(loadMeds, 0);
    const t = setInterval(loadMeds, MEDS_MS);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [loadMeds]);

  const mode = state?.mode ?? "idle";

  // pills left and today's list change when a dose starts or ends: refresh right away
  useEffect(() => {
    const t = setTimeout(loadMeds, 0);
    return () => clearTimeout(t);
  }, [mode, loadMeds]);

  useEffect(() => {
    if (detail === null) return;
    const t = setTimeout(() => setDetail(null), DETAIL_MS);
    return () => clearTimeout(t);
  }, [detail]);

  // a pill prompt closes any open box details for good, so they don't pop back after it
  useEffect(() => {
    if (mode !== "take") return;
    const t = setTimeout(() => setDetail(null), 0);
    return () => clearTimeout(t);
  }, [mode]);

  async function tookIt() {
    if (!state?.dose_id) return;
    setSending(true);
    await api(`/doses/${state.dose_id}/taken?method=screen`, { method: "POST" }).catch(() => setOnline(false));
    await loadState();
    setSending(false);
  }

  // Voice question: record in the browser -> /ai/ask (Gemini answers from the dose log) -> play the ElevenLabs MP3.
  async function startAsk() {
    if (!navigator.mediaDevices?.getUserMedia) {
      // browsers only allow the mic on https or localhost; the Pi kiosk passes a Chromium flag (pi/kiosk.sh)
      return setAsk({ phase: "answer", text: "The microphone isn't working on this screen. Please ask a family member." });
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setAsk({ phase: "answer", text: "I can't use the microphone. Please ask a family member." });
    }
    const rec = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      setAsk({ phase: "thinking" });
      try {
        const body = new FormData();
        body.append("audio", new Blob(chunks, { type: rec.mimeType }), "question");
        const r = await api<{ text: string; audio_url: string | null }>(`/ai/ask?patient_id=${patientId}`, { method: "POST", body });
        setAsk({ phase: "answer", text: r.text });
        if (r.audio_url) new Audio(`/api${r.audio_url}`).play().catch(() => {}); // text stays on screen if audio fails
      } catch {
        setAsk({ phase: "answer", text: "Sorry, I can't answer right now. Please try again." });
      }
    };
    recorder.current = rec;
    rec.start();
    setAsk({ phase: "listening" });
    setTimeout(() => rec.state === "recording" && rec.stop(), ASK_MAX_MS);
  }

  function askButton() {
    if (ask.phase === "listening") recorder.current?.stop();
    else if (ask.phase === "off" || ask.phase === "answer") startAsk();
  }

  useEffect(() => {
    if (ask.phase !== "answer") return;
    const t = setTimeout(() => setAsk({ phase: "off" }), ANSWER_MS);
    return () => clearTimeout(t);
  }, [ask]);

  const color = pillColor(state?.color ?? null);
  const inSlot = (s: number) => meds.find((m) => m.slot === s);
  const openSlot = mode === "take" ? state?.slot ?? null : null;
  const lit = mode !== "idle" ? state?.slot ?? null : null;
  const dueMed = openSlot ? inSlot(openSlot) : undefined;
  const next = nextDose(meds, now);
  const items = todayItems(meds, doses, now);
  const shown = detail !== null && mode !== "take" ? inSlot(detail) : undefined; // the pill prompt always wins
  const asking = ask.phase !== "off" && mode !== "take";

  return (
    <div className={`cab mode-${mode}`} style={{ "--pill": color } as React.CSSProperties}>
      <header className="cab-bar" inert={!!shown}>
        <span className="cab-brand"><Logo size={32} /> ThuocTracker</span>
        {now && (
          <span className="cab-clock">
            {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            <small>{now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</small>
          </span>
        )}
      </header>

      {!online && (
        <div className="cab-offline" role="status"><Icon name="wifiOff" /> Connection lost. Reconnecting…</div>
      )}

      {/* while a box's details are open, only the card can be reached */}
      <main className="cab-main" inert={!!shown}>
        <section className="cab-side">
          <div className="cab-hero" aria-live="assertive">
            {/* keyed so a new message plays its entrance once */}
            <div className="cab-hero-in" key={`${mode}-${asking}`}>
              <span className={`cab-icon${asking ? " ask" : ""}`}><Icon name={asking ? "mic" : MODE_ICON[mode]} /></span>
              {asking ? (
                <>
                  <h1 className="cab-msg cab-answer">
                    {ask.phase === "listening" ? "I'm listening…" : ask.phase === "thinking" ? "Let me check…" : ask.text}
                  </h1>
                  {ask.phase === "listening" && <p className="cab-sub">Ask your question, then tap <b>Done</b>.</p>}
                </>
              ) : mode === "idle" ? (
                <>
                  <h1 className="cab-msg">No pills right now</h1>
                  {next && <p className="cab-sub">Next: <b>{next.name}</b> at <b>{next.time}</b>, box <b>{next.slot}</b></p>}
                </>
              ) : (
                <>
                  <h1 className="cab-msg">{state?.message}</h1>
                  {openSlot && (
                    <p className="cab-sub">
                      Open <b className="cab-boxref">box {openSlot}</b>{dueMed && <> · take <b>{dueMed.dose}</b></>}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          {mode === "take" && state?.dose_id ? (
            <button type="button" className="cab-took" onClick={tookIt} disabled={sending}>
              <Icon name="check" /> {sending ? "Saving…" : "I took it"}
            </button>
          ) : (
            <button type="button" className={`cab-ask${ask.phase === "listening" ? " listening" : ""}`}
              onClick={askButton} disabled={ask.phase === "thinking"}>
              <Icon name="mic" />
              {ask.phase === "listening" ? "Done" : ask.phase === "thinking" ? "Thinking…" : "Ask a question"}
            </button>
          )}
        </section>

        {/* Mirrors the real cabinet: boxes 1-3, then 4-6, then the long box 7 across the bottom */}
        <ol className="cab-grid" aria-label="Cabinet boxes">
          {SLOTS.map((slot) => (
            <Box key={slot} slot={slot} m={inSlot(slot)} open={openSlot === slot} lit={lit === slot}
              dim={openSlot !== null && openSlot !== slot} onTap={() => setDetail(slot)} />
          ))}
        </ol>
      </main>

      <footer className="cab-today" inert={!!shown}>
        <h2>Today</h2>
        {items.length ? (
          <ol>
            {items.map((x) => (
              <li key={x.key} className={`cab-chip ${x.status}`}
                style={{ "--chip-pill": pillColor(x.color) } as React.CSSProperties}>
                {x.status !== "later" && <Icon name={CHIP_ICON[x.status]} />}
                <b>{clock(x.at)}</b> <span className="cab-chip-name">{x.name}</span>
                <span className="cab-sr">, {CHIP_SAY[x.status]}</span>
              </li>
            ))}
          </ol>
        ) : <span className="cab-today-none">No pills today.</span>}
      </footer>

      {shown && <Details m={shown} onClose={closeDetail} />}
    </div>
  );
}

function Box({ slot, m, open, lit, dim, onTap }: {
  slot: Slot; m?: Medicine; open: boolean; lit: boolean; dim: boolean; onTap: () => void;
}) {
  const cls = ["cab-box", slot === LONG_SLOT && "long", !m && "empty", open && "open", lit && "lit", dim && "dim"];
  if (!m) {
    // nothing to tap: an empty box is just a recess in the cabinet
    return (
      <li className={cls.filter(Boolean).join(" ")}>
        <div className="cab-door">
          <span className="cab-box-num" aria-hidden="true">{slot}</span>
          <span className="cab-box-body"><span className="cab-box-name">Empty<span className="cab-sr"> box {slot}</span></span></span>
        </div>
      </li>
    );
  }
  const flags = medFlags(m);
  // spoken label says "days", not "d"
  const label = [`Box ${slot}`, open && "open it now", m.name, `${m.pills_left} left`, ...medFlags(m, true)].filter(Boolean).join(", ");
  return (
    <li className={cls.filter(Boolean).join(" ")} style={{ "--box-pill": pillColor(m.color) } as React.CSSProperties}>
      <button type="button" className="cab-door" onClick={onTap} aria-label={label}>
        <span className="cab-box-num">{slot}</span>
        <span className="cab-box-body">
          <span className="cab-box-name"><span className="cab-pill" aria-hidden="true" /><span>{m.name}</span></span>
          <span className={`cab-box-left${m.pills_left < LOW ? " low" : ""}`}>{m.pills_left} left</span>
          {flags.length > 0 && <span className="cab-box-flags">{flags.map((f) => <i key={f}>{f}</i>)}</span>}
        </span>
        {open && <span className="cab-box-tag">OPEN</span>}
      </button>
    </li>
  );
}

// Big read-only card for one box. Tapping anywhere closes it.
function Details({ m, onClose }: { m: Medicine; onClose: () => void }) {
  const days = daysUntil(m.expiration);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="cab-detail" role="dialog" aria-modal="true" aria-label={`Box ${m.slot}: ${m.name}`} onClick={onClose}>
      <div className="cab-detail-card" style={{ "--box-pill": pillColor(m.color) } as React.CSSProperties}>
        <p className="cab-detail-box">Box {m.slot}{m.slot === LONG_SLOT ? ", the long box" : ""}</p>
        <h2><span className="cab-pill" aria-hidden="true" />{m.name}</h2>
        <dl>
          <dt>Take</dt><dd>{m.dose}</dd>
          <dt>When</dt><dd>{m.times.map(clock).join(" · ")}</dd>
          <dt>Pills left</dt>
          <dd className={m.pills_left < LOW ? "warn" : undefined}>{m.pills_left}{m.pills_left < LOW && " · Refill soon"}</dd>
          <dt>Expires</dt>
          <dd className={days <= EXPIRING_DAYS ? "warn" : undefined}>{fmtDate(m.expiration)}{days <= EXPIRING_DAYS && ` · ${expiresIn(days, true)}`}</dd>
        </dl>
        <button type="button" className="cab-detail-close" ref={close}><Icon name="close" /> Close</button>
      </div>
    </div>
  );
}

function medFlags(m: Medicine, full = false) {
  const days = daysUntil(m.expiration);
  return [m.pills_left < LOW && "Refill soon", days <= EXPIRING_DAYS && expiresIn(days, full)].filter((f): f is string => !!f);
}

const expiresIn = (days: number, full = false) => // full: "5 days" where there is room, or for screen readers
  days < 0 ? "Expired" : days === 0 ? "Expires today" : `Expires in ${days} ${full ? (days === 1 ? "day" : "days") : "d"}`;

// "08:00" -> "8:00 AM"
function clock(hhmm: string) {
  const [h, min] = hhmm.split(":").map(Number);
  return new Date(0, 0, 0, h, min).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Display only: the next scheduled time today across this cabinet's medicines.
function nextDose(meds: Medicine[], now: Date | null) {
  if (!now) return null;
  const hhmm = now.toTimeString().slice(0, 5);
  const upcoming = meds.flatMap((m) => m.times.map((t) => ({ name: m.name, slot: m.slot, t })))
    .filter((x) => x.t > hhmm).sort((a, b) => a.t.localeCompare(b.t))[0];
  return upcoming ? { name: upcoming.name, slot: upcoming.slot, time: clock(upcoming.t) } : null;
}

type TodayStatus = "taken" | "missed" | "due" | "later";
// "later" chips have no icon: plain is "not yet", and the names need the room
const CHIP_ICON: Record<Exclude<TodayStatus, "later">, IconName> = { taken: "check", missed: "x", due: "pill" };
const CHIP_SAY: Record<TodayStatus, string> = { taken: "taken", missed: "missed", due: "due now", later: "coming up" };

// Today's doses from the log (taken / missed / due now) plus scheduled times still to come.
// Display only: the backend owns the schedule. Shows at most 4 (the last 2, then what's next) so names fit.
function todayItems(meds: Medicine[], doses: DoseLog[], now: Date | null) {
  if (!now) return [];
  const pad = (n: number) => String(n).padStart(2, "0");
  const ymd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const hhmm = now.toTimeString().slice(0, 5);
  const med = (id: number) => meds.find((m) => m.id === id);
  const logged = doses.filter((d) => d.due_at.startsWith(ymd)).map((d) => ({
    key: `d${d.id}`, at: d.due_at.slice(11, 16), name: med(d.medicine_id)?.name ?? "Medicine",
    color: med(d.medicine_id)?.color ?? null, status: (d.status === "pending" ? "due" : d.status) as TodayStatus,
  }));
  const later = meds.flatMap((m) => m.times
    .filter((t) => t > hhmm && !doses.some((d) => d.medicine_id === m.id && d.due_at.startsWith(`${ymd}T${t}`)))
    .map((t) => ({ key: `m${m.id}-${t}`, at: t, name: m.name, color: m.color, status: "later" as TodayStatus })));
  const byTime = (a: { at: string }, b: { at: string }) => a.at.localeCompare(b.at);
  const done = logged.sort(byTime).slice(-2);
  return [...done, ...later.sort(byTime).slice(0, 4 - done.length)];
}
