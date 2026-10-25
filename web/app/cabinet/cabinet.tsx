"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, Logo, type IconName } from "@/components/icon";
import {
  api, clock, daysUntil, fmtDate, LONG_SLOT, pillColor, SLOTS, todayItems,
  type CabinetState, type DoseLog, type Medicine, type Slot, type TodayItem, type TodayStatus,
} from "@/lib/api";
import { Glyph } from "./glyph";
import Setup from "./setup";

const STATE_MS = 1000;
const MEDS_MS = 10_000;
const ASK_MAX_MS = 8000; // stop recording on its own if the patient doesn't tap again
// No mic in this browser (the Pi kiosk: the mic is on the ESP32): the cabinet asks instead. The Pi picks
// the tap up within ~2 s, speaks the prompt (~2.5 s) and records 5 s; then the answer takes a few seconds.
const CABINET_LISTEN_MS = 9500;
const CABINET_ASK_MAX_MS = 60_000; // first question after a while: the model takes ~30 s to load
const ANSWER_MS = 15_000; // how long the answer stays on screen
const DETAIL_MS = 15_000; // a tapped box's details close on their own
const SHEET_MS = 30_000; // the menu and today's list close on their own (longer: there's more to read)
const LOW = 5; // backend's low-pill rule; display only
const EXPIRING_DAYS = 7; // backend's expiring-soon rule; display only

// cabinet: the question goes through the cabinet's own mic and speaker (asked = the backend's "at")
type ViaCabinet = { asked: string; since: number };
type Ask =
  | { phase: "off" }
  | { phase: "listening"; cabinet?: ViaCabinet }
  | { phase: "thinking"; cabinet?: ViaCabinet }
  | { phase: "answer"; text: string };
const SORRY = "Sorry, I can't answer right now. Please try again.";

// Screen preferences, kept in this browser (the Pi) only
type Theme = "auto" | "light" | "dark";
type TextSize = "normal" | "large";
const THEMES = ["auto", "light", "dark"] as const satisfies readonly Theme[];
const TEXT_SIZES = ["normal", "large"] as const satisfies readonly TextSize[];
const isNight = (d: Date) => d.getHours() >= 19 || d.getHours() < 7; // "auto": dark from 7 PM to 7 AM

type Sheet = { view: "menu" } | { view: "today"; fromMenu: boolean };

const MODE_ICON: Record<CabinetState["mode"], IconName> = {
  idle: "clock", take: "pill", taken: "check", already_took: "alert", missed: "x",
};

export default function Cabinet() {
  const [patientId, setPatientId] = useState<number | null>(null);
  // Whose cabinet: ?patient=N in the URL wins (no sign-in); otherwise the patient signed in on this screen, saved here
  const [pinned, setPinned] = useState(false);
  const [setup, setSetup] = useState<"first" | "switch" | null>(null);
  const [state, setState] = useState<CabinetState | null>(null);
  const [meds, setMeds] = useState<Medicine[]>([]);
  const [doses, setDoses] = useState<DoseLog[]>([]);
  const [name, setName] = useState("");
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState<Date | null>(null); // null until mounted, so server and client HTML match
  const [sending, setSending] = useState(false);
  const [ask, setAsk] = useState<Ask>({ phase: "off" });
  const [detail, setDetail] = useState<Slot | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [theme, setTheme] = useState<Theme>("auto");
  const [textSize, setTextSize] = useState<TextSize>("normal");
  const recorder = useRef<MediaRecorder | null>(null);
  const closeDetail = useCallback(() => setDetail(null), []);
  const closeSheet = useCallback(() => setSheet(null), []);
  const cancelSetup = useCallback(() => setSetup(null), []);

  useEffect(() => {
    const t = setTimeout(() => {
      const url = new URLSearchParams(location.search);
      const urlId = Number(url.get("patient")) || null;
      const saved = Number(loadPref("cab-patient", null, "")) || null;
      if (urlId) {
        setPinned(true);
        setPatientId(urlId);
      } else if (saved) {
        setPatientId(saved);
      } else {
        setSetup("first");
      }
      setTheme(loadPref("cab-theme", THEMES, "auto"));
      setTextSize(loadPref("cab-text", TEXT_SIZES, "normal"));
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const loadState = useCallback(async () => {
    setNow(new Date()); // the clock (and auto dark) runs even before setup
    if (!patientId) return;
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
    const t = await api<{ name: string; medicines: Medicine[]; doses: DoseLog[] }>(`/cabinet/${patientId}/today`)
      .catch(() => null);
    if (t) {
      setName(t.name);
      setMeds(t.medicines);
      setDoses(t.doses);
    }
  }, [patientId]);

  useEffect(() => {
    const first = setTimeout(loadState, 0);
    const t = setInterval(loadState, STATE_MS); // also ticks the clock before setup
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

  useEffect(() => {
    if (sheet === null) return;
    const t = setTimeout(() => setSheet(null), SHEET_MS);
    return () => clearTimeout(t);
  }, [sheet, theme, textSize]); // a tap on a setting restarts the timer

  // a pill prompt closes any open box details, menu or patient switch for good, so they don't pop back after it
  useEffect(() => {
    if (mode !== "take") return;
    const t = setTimeout(() => { setDetail(null); setSheet(null); setSetup((s) => (s === "switch" ? null : s)); }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  function pickTheme(t: Theme) {
    setTheme(t);
    savePref("cab-theme", t);
  }

  function pickTextSize(s: TextSize) {
    setTextSize(s);
    savePref("cab-text", s);
  }

  function signedIn(id: number) {
    savePref("cab-patient", String(id));
    if (id !== patientId) {
      // drop the old patient's screen so it can't flash under the new name
      setState(null); setMeds([]); setDoses([]); setName(""); setAsk({ phase: "off" });
    }
    setPatientId(id);
    setSetup(null);
  }

  async function tookIt() {
    if (!state?.dose_id) return;
    setSending(true);
    await api(`/cabinet/${patientId}/taken?dose_id=${state.dose_id}`, { method: "POST" }).catch(() => setOnline(false));
    await loadState();
    setSending(false);
  }

  // Voice question: record in the browser -> WAV -> /ai/ask (local Gemma answers from the dose log) -> play the ElevenLabs MP3.
  async function startAsk() {
    // browsers only allow the mic on https or localhost; the Pi kiosk passes a Chromium flag (pi/kiosk.sh)
    if (!navigator.mediaDevices?.getUserMedia) return askCabinet();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return askCabinet(); // no mic here (on the Pi it's on the ESP32): the cabinet listens instead
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
        body.append("audio", await toWav(new Blob(chunks, { type: rec.mimeType })), "question.wav");
        const r = await api<{ text: string; audio_url: string | null }>(`/ai/ask?patient_id=${patientId}`, { method: "POST", body });
        setAsk({ phase: "answer", text: r.text });
        if (r.audio_url) new Audio(`/api${r.audio_url}`).play().catch(() => {}); // text stays on screen if audio fails
      } catch {
        setAsk({ phase: "answer", text: SORRY });
      }
    };
    recorder.current = rec;
    rec.start();
    setAsk({ phase: "listening" });
    setTimeout(() => rec.state === "recording" && rec.stop(), ASK_MAX_MS);
  }

  // The cabinet's mic and speaker (ESP32): the Pi gets an "ask" from the backend, says "I'm listening",
  // records, asks /ai/ask and plays the answer. This screen just shows it (the effect below polls).
  async function askCabinet() {
    try {
      const { at } = await api<{ at: string }>(`/cabinet/${patientId}/ask`, { method: "POST" });
      setAsk({ phase: "listening", cabinet: { asked: at, since: Date.now() } });
    } catch {
      setAsk({ phase: "answer", text: SORRY });
    }
  }

  const viaCabinet = ask.phase === "listening" || ask.phase === "thinking" ? ask.cabinet : undefined;
  useEffect(() => {
    if (!viaCabinet) return;
    const t = setInterval(async () => {
      const waited = Date.now() - viaCabinet.since;
      if (waited > CABINET_ASK_MAX_MS) return setAsk({ phase: "answer", text: SORRY });
      if (waited > CABINET_LISTEN_MS) setAsk((a) => (a.phase === "listening" ? { phase: "thinking", cabinet: viaCabinet } : a));
      const a = await api<{ text?: string; at?: string }>(`/cabinet/${patientId}/answer`).catch(() => null);
      // same backend clock, same ISO format: a later answer sorts after the question
      if (a?.text && a.at && a.at > viaCabinet.asked) setAsk({ phase: "answer", text: a.text });
    }, 500); // the answer is saved once its voice exists: show it as the cabinet starts speaking
    return () => clearInterval(t);
  }, [viaCabinet, patientId]);

  function askButton() {
    if (ask.phase === "listening" && !ask.cabinet) recorder.current?.stop();
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
  const today = todayItems(meds, doses, now);
  const strip = stripItems(today, textSize === "large" ? 3 : 4); // fewer chips so larger names still fit
  const shown = detail !== null && mode !== "take" ? inSlot(detail) : undefined; // the pill prompt always wins
  const asking = ask.phase !== "off" && mode !== "take";
  const dark = theme === "dark" || (theme === "auto" && now !== null && isNight(now));
  const covered = !!shown || !!sheet; // while a card is open, only the card can be reached
  const cls = `cab mode-${mode}${dark ? " dark" : ""}${textSize === "large" ? " text-large" : ""}`;

  if (setup) {
    return (
      <div className={cls}>
        <Setup onDone={signedIn} onCancel={setup === "switch" ? cancelSetup : undefined} />
      </div>
    );
  }

  return (
    <div className={cls} style={{ "--pill": color } as React.CSSProperties}>
      <header className="cab-bar" inert={covered}>
        <button type="button" className="cab-menu" aria-haspopup="dialog"
          onClick={() => { setDetail(null); setSheet({ view: "menu" }); }}>
          <Glyph name="menu" /> Menu
        </button>
        <span className="cab-brand"><Logo size={28} /> {name || "ThuocTracker"}</span>
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

      <main className="cab-main" inert={covered}>
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
                  {ask.phase === "listening" && (ask.cabinet
                    ? <p className="cab-sub">When the cabinet says <b>&ldquo;I&apos;m listening&rdquo;</b>, ask your question.</p>
                    : <p className="cab-sub">Ask your question, then tap <b>Done</b>.</p>)}
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
              onClick={askButton} disabled={ask.phase === "thinking" || !!viaCabinet}>
              <Icon name="mic" />
              {ask.phase === "listening" ? (ask.cabinet ? "Listening…" : "Done")
                : ask.phase === "thinking" ? "Thinking…" : "Ask a question"}
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

      {/* The strip is one big button: tapping it shows every dose today */}
      <footer className="cab-foot" inert={covered}>
        <button type="button" className="cab-today" aria-haspopup="dialog"
          onClick={() => setSheet({ view: "today", fromMenu: false })}>
          <span className="cab-today-label">Today</span>
          {strip.length ? strip.map((x) => (
            <span key={x.key} className={`cab-chip ${x.status}`}
              style={{ "--chip-pill": pillColor(x.color) } as React.CSSProperties}>
              {x.status !== "later" && <Icon name={STATUS_ICON[x.status]} />}
              <b>{clock(x.at)}</b> <span className="cab-chip-name">{x.name}</span>
              <span className="cab-sr">, {STATUS_TEXT[x.status].toLowerCase()};</span>
            </span>
          )) : <span className="cab-today-none">No pills today.</span>}
          <span className="cab-sr"> Show all of today&apos;s pills.</span>
        </button>
      </footer>

      {shown && <Details m={shown} onClose={closeDetail} />}
      {sheet?.view === "menu" && (
        <Menu theme={theme} onTheme={pickTheme} textSize={textSize} onTextSize={pickTextSize}
          onToday={() => setSheet({ view: "today", fromMenu: true })} onClose={closeSheet}
          onSwitch={pinned ? undefined : () => { setSheet(null); setSetup("switch"); }} />
      )}
      {sheet?.view === "today" && (
        <TodayList items={today} onBack={sheet.fromMenu ? () => setSheet({ view: "menu" }) : undefined}
          onClose={closeSheet} />
      )}
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

// A big card over everything. Focus goes to the [data-autofocus] button; Escape or a tap outside closes it.
// tapToClose: tapping the card itself closes it too (read-only cards).
function Modal({ label, pill, tapToClose = false, onClose, children }: {
  label: string; pill?: string; tapToClose?: boolean; onClose: () => void; children: React.ReactNode;
}) {
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    card.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="cab-detail" role="dialog" aria-modal="true" aria-label={label} onClick={onClose}>
      <div className="cab-detail-card" ref={card} onClick={tapToClose ? undefined : (e) => e.stopPropagation()}
        style={pill ? ({ "--box-pill": pill } as React.CSSProperties) : undefined}>
        {children}
      </div>
    </div>
  );
}

// Big read-only card for one box. Tapping anywhere closes it.
function Details({ m, onClose }: { m: Medicine; onClose: () => void }) {
  const days = daysUntil(m.expiration);
  return (
    <Modal label={`Box ${m.slot}: ${m.name}`} pill={pillColor(m.color)} tapToClose onClose={onClose}>
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
      <button type="button" className="cab-detail-close" data-autofocus><Icon name="close" /> Close</button>
    </Modal>
  );
}

// Screen settings and today's full list. Never anything that changes a dose.
// onSwitch: missing when the URL fixes the patient (?patient=N)
function Menu({ theme, onTheme, textSize, onTextSize, onToday, onSwitch, onClose }: {
  theme: Theme; onTheme: (t: Theme) => void; textSize: TextSize; onTextSize: (s: TextSize) => void;
  onToday: () => void; onSwitch?: () => void; onClose: () => void;
}) {
  const themes: { v: Theme; label: string; icon: React.ReactNode }[] = [
    { v: "light", label: "Light", icon: <Glyph name="sun" /> },
    { v: "dark", label: "Dark", icon: <Glyph name="moon" /> },
    { v: "auto", label: "Auto", icon: <Icon name="clock" /> },
  ];
  return (
    <Modal label="Menu" onClose={onClose}>
      <h2>Menu</h2>
      <div className="cab-opt" role="group" aria-labelledby="cab-opt-screen">
        <span className="cab-opt-label" id="cab-opt-screen">Screen</span>
        <div className="cab-seg">
          {themes.map((t) => (
            <button key={t.v} type="button" aria-pressed={theme === t.v} onClick={() => onTheme(t.v)}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
        <p className="cab-opt-note">Auto is dark from 7 PM to 7 AM.</p>
      </div>
      <div className="cab-opt" role="group" aria-labelledby="cab-opt-text">
        <span className="cab-opt-label" id="cab-opt-text">Text size</span>
        <div className="cab-seg">
          <button type="button" aria-pressed={textSize === "normal"} onClick={() => onTextSize("normal")}>
            <span className="cab-aa" aria-hidden="true">Aa</span> Normal
          </button>
          <button type="button" aria-pressed={textSize === "large"} onClick={() => onTextSize("large")}>
            <span className="cab-aa big" aria-hidden="true">Aa</span> Large
          </button>
        </div>
      </div>
      <div className="cab-sheet-actions">
        <button type="button" className="cab-sheet-btn" onClick={onToday}><Glyph name="list" /> Today&apos;s pills</button>
        {onSwitch && <button type="button" className="cab-sheet-btn" onClick={onSwitch}><Glyph name="users" /> Switch patient</button>}
      </div>
      <button type="button" className="cab-detail-close" data-autofocus onClick={onClose}><Icon name="close" /> Close</button>
    </Modal>
  );
}

// Every dose today, in time order, with its box and what happened. Display only.
function TodayList({ items, onBack, onClose }: { items: TodayItem[]; onBack?: () => void; onClose: () => void }) {
  return (
    <Modal label="Today's pills" onClose={onClose}>
      <h2>Today&apos;s pills</h2>
      {items.length ? (
        <ol className="cab-sched">
          {items.map((x) => (
            <li key={x.key} className={x.status} style={{ "--box-pill": pillColor(x.color) } as React.CSSProperties}>
              <b className="cab-sched-time">{clock(x.at)}</b>
              <span className="cab-pill" aria-hidden="true" />
              <span className="cab-sched-name">{x.name}</span>
              <span className="cab-sched-box">{x.slot && `Box ${x.slot}`}</span>
              <span className="cab-sched-status"><Icon name={STATUS_ICON[x.status]} /> {STATUS_TEXT[x.status]}</span>
            </li>
          ))}
        </ol>
      ) : <p className="cab-sched-none">No pills today.</p>}
      <div className="cab-sheet-actions">
        {onBack && <button type="button" className="cab-sheet-btn" onClick={onBack}><Glyph name="back" /> Menu</button>}
        <button type="button" className="cab-detail-close" data-autofocus onClick={onClose}><Icon name="close" /> Close</button>
      </div>
    </Modal>
  );
}

// allowed: null takes any saved string
function loadPref<T extends string>(key: string, allowed: readonly T[] | null, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    if (!allowed) return (v as T | null) ?? fallback;
    return allowed.find((a) => a === v) ?? fallback;
  } catch {
    return fallback; // storage blocked: use the default
  }
}

function savePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage blocked: the choice lasts until the page reloads
  }
}

function medFlags(m: Medicine, full = false) {
  const days = daysUntil(m.expiration);
  return [m.pills_left < LOW && "Refill soon", days <= EXPIRING_DAYS && expiresIn(days, full)].filter((f): f is string => !!f);
}

const expiresIn = (days: number, full = false) => // full: "5 days" where there is room, or for screen readers
  days < 0 ? "Expired" : days === 0 ? "Expires today" : `Expires in ${days} ${full ? (days === 1 ? "day" : "days") : "d"}`;

// Display only: the next scheduled time today across this cabinet's medicines.
function nextDose(meds: Medicine[], now: Date | null) {
  if (!now) return null;
  const hhmm = now.toTimeString().slice(0, 5);
  const upcoming = meds.flatMap((m) => m.times.map((t) => ({ name: m.name, slot: m.slot, t })))
    .filter((x) => x.t > hhmm).sort((a, b) => a.t.localeCompare(b.t))[0];
  return upcoming ? { name: upcoming.name, slot: upcoming.slot, time: clock(upcoming.t) } : null;
}

const STATUS_ICON: Record<TodayStatus, IconName> = { taken: "check", missed: "x", due: "pill", later: "clock" };
const STATUS_TEXT: Record<TodayStatus, string> = { taken: "Taken", missed: "Missed", due: "Due now", later: "Coming up" };

// The browser records WebM (Safari: MP4), but the local speech model reads only WAV: decode, resample to
// 16 kHz mono (what the Pi sends too) and put the 16-bit samples behind a WAV header.
async function toWav(recording: Blob): Promise<Blob> {
  const audio = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(await recording.arrayBuffer());
  const pcm = audio.getChannelData(0);
  const v = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const tag = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  tag(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); tag(8, "WAVE");
  tag(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); // PCM, mono
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  tag(36, "data"); v.setUint32(40, pcm.length * 2, true);
  pcm.forEach((s, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return new Blob([v], { type: "audio/wav" });
}

// The bottom strip: the last 2 logged doses, then what's next, at most `max` so the names fit.
function stripItems(items: TodayItem[], max: number) {
  const done = items.filter((x) => x.status !== "later").slice(-2);
  return [...done, ...items.filter((x) => x.status === "later").slice(0, max - done.length)];
}
