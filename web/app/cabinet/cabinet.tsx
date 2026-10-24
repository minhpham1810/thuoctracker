"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon, Logo, type IconName } from "@/components/icon";
import { api, pillColor, type CabinetState, type Medicine } from "@/lib/api";

const STATE_MS = 1000;
const MEDS_MS = 10_000;

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
          {mode === "idle" ? (
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
