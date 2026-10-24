"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { api, type Session } from "@/lib/api";
import { Glyph } from "./glyph";

const IDLE_MS = 60_000; // "Switch patient" gives up and goes back if nobody types

// One-time cabinet setup: a family member signs in with the patient's account, on a big
// built-in keyboard (the Pi has none). Patient accounts only; the session is ended right
// away because the cabinet's own routes need no login. On the Pi, `hw` is the patient the
// hardware serves (PATIENT_ID in pi/.env) and only that account is accepted.
export default function Setup({ hw, onDone, onCancel }: {
  hw: number | null; onDone: (patientId: number) => void; onCancel?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [field, setField] = useState<"email" | "password">("email");
  const [shift, setShift] = useState(false);
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [hwName, setHwName] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!hw) return;
    api<{ name: string }>(`/cabinet/${hw}/today`).then((t) => setHwName(t.name)).catch(() => {});
  }, [hw]);

  // switching: go back to the current patient if nobody types for a minute
  useEffect(() => {
    if (!onCancel) return;
    const t = setTimeout(onCancel, IDLE_MS);
    return () => clearTimeout(t);
  }, [onCancel, email, password]);

  const setValue = field === "email" ? setEmail : setPassword;

  function focus(f: "email" | "password") {
    setField(f);
    (f === "email" ? emailRef : passwordRef).current?.focus({ preventScroll: true });
  }

  function type(text: string) {
    setError("");
    setValue((v) => v + (shift ? text.toUpperCase() : text));
    setShift(false);
  }

  async function signIn() {
    if (!email || !password) return setError(!email ? "Type the patient's email." : "Type the password.");
    setBusy(true);
    setError("");
    try {
      const s = await api<Session>("/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      // only used to check the account: end the session so it doesn't linger
      api("/logout", { method: "POST", headers: { Authorization: `Bearer ${s.token}` } }).catch(() => {});
      if (s.user.role !== "patient") {
        setError(`That's a ${s.user.role} account. Sign in with the patient's own account.`);
      } else if (hw && s.user.id !== hw) {
        setError(`This cabinet's boxes are set up for ${hwName || "another patient"}. Sign in with that account.`);
      } else {
        return onDone(s.user.id);
      }
    } catch (e) {
      // fetch throws TypeError when the server can't be reached; api() throws Error with the server's reason
      setError(e instanceof TypeError ? "Can't reach the server. Check the Wi-Fi, then try again." : (e as Error).message);
    }
    setBusy(false);
  }

  const last = field === "email" ? "Next" : busy ? "Signing in…" : "Sign in";
  return (
    <form className="cab-setup" onSubmit={(e) => { e.preventDefault(); if (field === "email") focus("password"); else signIn(); }}>
      <div className="cab-setup-head">
        <div>
          <h1>{onCancel ? "Switch patient" : "Set up this cabinet"}</h1>
          {error ? <p className="cab-setup-error" role="alert">{error}</p>
            : <p>Sign in with {hw && hwName ? `${hwName}'s` : "the patient's"} account. You only do this once.</p>}
        </div>
        {onCancel && <button type="button" className="cab-setup-cancel" onClick={onCancel}><Icon name="close" /> Cancel</button>}
      </div>

      <label className={`cab-field${field === "email" ? " on" : ""}`} onClick={() => setField("email")}>
        <span>Email</span>
        <input ref={emailRef} value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} onFocus={() => setField("email")}
          inputMode="none" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="the patient's email" />
      </label>
      <label className={`cab-field${field === "password" ? " on" : ""}`} onClick={() => setField("password")}>
        <span>Password</span>
        <input ref={passwordRef} type={show ? "text" : "password"} value={password} onFocus={() => setField("password")}
          onChange={(e) => { setPassword(e.target.value); setError(""); }} inputMode="none" autoComplete="off" />
        <button type="button" className="cab-field-show" onClick={() => setShow(!show)} aria-pressed={show}>
          {show ? "Hide" : "Show"}
        </button>
      </label>

      {/* 20 half-key columns: rows offset like a real keyboard */}
      <div className="cab-kb" role="group" aria-label="Keyboard">
        {["1234567890", "qwertyuiop", "asdfghjkl"].map((row, i) => (
          <div key={row} className={`cab-kb-row${i === 2 ? " inset" : ""}`}>
            {[...row].map((k) => (
              <button key={k} type="button" onClick={() => type(k)}>{shift ? k.toUpperCase() : k}</button>
            ))}
          </div>
        ))}
        <div className="cab-kb-row">
          <button type="button" className={`w3${shift ? " on" : ""}`} onClick={() => setShift(!shift)} aria-pressed={shift} aria-label="Capital letter">
            <Glyph name="shift" />
          </button>
          {[..."zxcvbnm"].map((k) => (
            <button key={k} type="button" onClick={() => type(k)}>{shift ? k.toUpperCase() : k}</button>
          ))}
          <button type="button" className="w3" onClick={() => setValue((v) => v.slice(0, -1))} aria-label="Delete">
            <Glyph name="erase" />
          </button>
        </div>
        <div className="cab-kb-row">
          {["@", ".", "-", "_"].map((k) => <button key={k} type="button" onClick={() => type(k)}>{k}</button>)}
          <button type="button" className="w4" onClick={() => type(".com")}>.com</button>
          <button type="submit" className="w8 go" disabled={busy}>{last}</button>
        </div>
      </div>
    </form>
  );
}
