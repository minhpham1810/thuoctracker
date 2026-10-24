"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, Logo, type IconName } from "@/components/icon";
import { api, pillColor, type CabinetState, type Medicine } from "@/lib/api";

const STATE_MS = 1000;
const MEDS_MS = 10_000;
const ASK_MAX_MS = 8000; // stop recording on its own if the patient doesn't tap again
const ANSWER_MS = 15_000; // how long the answer stays on screen

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
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState<Date | null>(null); // null until mounted, so server and client HTML match
  const [sending, setSending] = useState(false);
  const [ask, setAsk] = useState<Ask>({ phase: "off" });
  const recorder = useRef<MediaRecorder | null>(null);

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
    try {
      setMeds(await api<Medicine[]>(`/patients/${patientId}/medicines`));
    } catch { /* slot labels are cosmetic; keep the last ones */ }
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
      // browsers only allow the mic on https or localhost; the Pi kiosk needs a Chromium flag (see TEAM.md)
      return setAsk({ phase: "answer", text: "The microphone isn't available on this screen." });
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

  const mode = state?.mode ?? "idle";
  const color = pillColor(state?.color ?? null);
  const next = nextDose(meds, now);

  return (
    <div className={`cab mode-${mode}`} style={{ "--pill": color } as React.CSSProperties}>
      <header className="cab-bar">
        <span className="cab-brand"><Logo size={36} /> ThuocTracker</span>
        {now && (
          <span className="cab-clock">
            {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            <small>{now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</small>
          </span>
        )}
      </header>

      {!online && (
        <div className="cab-offline" role="status"><Icon name="wifiOff" /> Reconnecting to the cabinet…</div>
      )}

      <main className="cab-main">
        <div className="cab-hero" role="status" aria-live="assertive">
          <span className="cab-icon"><Icon name={MODE_ICON[mode]} /></span>
          {ask.phase !== "off" && mode !== "take" ? (
            <>
              <h1 className="cab-msg cab-answer">
                {ask.phase === "listening" ? "I'm listening…" : ask.phase === "thinking" ? "Let me check…" : ask.text}
              </h1>
              {ask.phase === "listening" && <p className="cab-sub">Ask your question, then tap <b>Done</b>.</p>}
            </>
          ) : mode === "idle" ? (
            <>
              <h1 className="cab-msg">{now ? now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : " "}</h1>
              <p className="cab-sub">
                {next ? <>No pills right now. Next: <b>{next.name}</b> at <b>{next.time}</b></> : "No pills right now."}
              </p>
            </>
          ) : (
            <>
              <h1 className="cab-msg">{state?.message}</h1>
              {mode === "take" && state?.slot && <p className="cab-sub">The door of <b>slot {state.slot}</b> is open.</p>}
            </>
          )}
        </div>

        <ol className="cab-slots" aria-label="Pill slots">
          {[1, 2, 3].map((slot) => {
            const m = meds.find((x) => x.slot === slot);
            const active = state?.slot === slot && mode !== "idle";
            return (
              <li key={slot} className={`cab-slot${active ? " active" : ""}`}
                style={m ? ({ "--slot-pill": pillColor(m.color) } as React.CSSProperties) : undefined}>
                <span className="cab-slot-num">{slot}</span>
                <span className="cab-slot-name">
                  {m && <span className="cab-dot" aria-hidden="true" />}
                  {m?.name ?? "Empty"}
                </span>
                {active && mode === "take" && <span className="cab-slot-tag">OPEN</span>}
              </li>
            );
          })}
        </ol>

        {mode === "take" && state?.dose_id && (
          <button type="button" className="cab-took" onClick={tookIt} disabled={sending}>
            <Icon name="check" /> {sending ? "Saving…" : "I took it"}
          </button>
        )}

        {mode !== "take" && (
          <button type="button" className={`cab-ask${ask.phase === "listening" ? " listening" : ""}`}
            onClick={askButton} disabled={ask.phase === "thinking"}>
            <Icon name="mic" />
            {ask.phase === "listening" ? "Done" : ask.phase === "thinking" ? "Thinking…" : "Ask a question"}
          </button>
        )}
      </main>
    </div>
  );
}

// Display only: the next scheduled time today across this cabinet's medicines.
function nextDose(meds: Medicine[], now: Date | null) {
  if (!now) return null;
  const hhmm = now.toTimeString().slice(0, 5);
  const upcoming = meds.flatMap((m) => m.times.map((t) => ({ name: m.name, t })))
    .filter((x) => x.t > hhmm).sort((a, b) => a.t.localeCompare(b.t))[0];
  if (!upcoming) return null;
  const [h, min] = upcoming.t.split(":").map(Number);
  return { name: upcoming.name, time: new Date(0, 0, 0, h, min).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) };
}
