"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { api, LONG_SLOT, PILL_COLOR_NAMES, pillColor, SLOTS, type LabelDraft, type Medicine, type Patient } from "@/lib/api";

// Add: label photo -> /ai/label draft -> doctor checks it -> POST /medicines.
// Edit (med given): same form prefilled -> PATCH /medicines/{id}; refill = change "Pills in the box".
// slot: the empty box the doctor clicked
export default function AddMedicine({ patient, meds, med, slot, onClose, onSaved }: {
  patient: Patient; meds: Medicine[]; med?: Medicine; slot?: number; onClose: () => void; onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const freeSlots = SLOTS.filter((s) => s === med?.slot || !meds.some((m) => m.slot === s));
  const [form, setForm] = useState(med ? {
    name: med.name, dose: med.dose, times: med.times, slot: String(med.slot),
    pills_left: String(med.pills_left), expiration: med.expiration, color: med.color,
  } : {
    // empty, not example values: anything filled in must come from the label or the doctor
    name: "", dose: "", times: [""], slot: String(slot ?? freeSlots[0] ?? ""), pills_left: "", expiration: "", color: "blue",
  });
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [note, setNote] = useState<{ text: string; ai?: boolean }>({ text: "Or type it in below." });
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { dialog.current?.showModal(); }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const setTimes = (fn: (t: string[]) => string[]) => setForm((f) => ({ ...f, times: fn(f.times) }));

  async function readLabel(file: File) {
    setReading(true);
    setError("");
    setNote({ text: "Reading the label…" });
    try {
      const body = new FormData();
      body.append("photo", file);
      const d = await api<LabelDraft>("/ai/label", { method: "POST", body });
      // AI returns null for anything it couldn't read; keep what the doctor already typed
      setForm((f) => ({
        ...f,
        name: d.name ?? f.name, dose: d.dose ?? f.dose,
        times: d.times?.length ? d.times : f.times, expiration: d.expiration ?? f.expiration,
        pills_left: d.quantity != null ? String(d.quantity) : f.pills_left,
      }));
      const missing = (["name", "dose", "times", "expiration", "quantity"] as const).filter((k) => d[k] == null)
        .map((k) => (k === "quantity" ? "pill count" : k));
      setNote({
        text: missing.length
          ? `Filled in from the label, except ${missing.join(", ")}. Check every field before saving.`
          : "Filled in from the label. Check every field before saving.",
        ai: true,
      });
    } catch (e) {
      setNote({ text: `Couldn't read the label (${(e as Error).message}). Fill it in by hand.` });
    } finally {
      setReading(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api<Medicine>(med ? `/medicines/${med.id}` : "/medicines", {
        method: med ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patient.id,
          name: form.name.trim(),
          dose: form.dose.trim(),
          times: [...new Set(form.times)].sort(), // "HH:MM" from the time inputs, so text order is time order
          slot: Number(form.slot),
          pills_left: Number(form.pills_left),
          expiration: form.expiration,
          color: form.color,
        }),
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirmRemove) return setConfirmRemove(true);
    setSaving(true);
    try {
      await api(`/medicines/${med!.id}`, { method: "DELETE" });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <dialog ref={dialog} aria-labelledby="add-title" onClose={onClose}>
      <form onSubmit={save}>
        <div className="dialog-head">
          <div>
            <h3 id="add-title">{med ? `Edit ${med.name}` : "Add a medicine"}</h3>
            <p className="muted">{patient.name}&apos;s cabinet</p>
          </div>
          <button className="btn btn-quiet btn-icon" type="button" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="dialog-body">
          {!med && (
            <div className="scan">
              <label className={`dropzone${reading ? " busy" : ""}`}>
                <Icon name="camera" />
                <span>
                  <strong>{reading ? "Reading the label…" : "Scan the bottle label"}</strong>
                  <span>Take or choose a photo. The name, dose, times, expiration and pill count are filled in for you.</span>
                </span>
                <input type="file" accept="image/*" capture="environment" disabled={reading}
                  onChange={(e) => e.target.files?.[0] && readLabel(e.target.files[0])} />
              </label>
              <p className={`note${note.ai ? " ai" : ""}`} aria-live="polite">{note.text}</p>
            </div>
          )}

          <fieldset className="group">
            <legend>Prescription</legend>
            <div className="fields">
              <label className="field full">Medicine name
                <input value={form.name} onChange={set("name")} required autoComplete="off" placeholder="e.g. Metformin 500 mg" />
              </label>
              <label className="field">Dose
                <input value={form.dose} onChange={set("dose")} required placeholder="e.g. 1 pill" />
              </label>
              <div className="field full" role="group" aria-labelledby="times-label">
                <span id="times-label">Times <small>When the pill is taken each day</small></span>
                <div className="times">
                  {form.times.map((t, i) => (
                    <span className="time-row" key={i}>
                      <input type="time" value={t} required aria-label={`Time ${i + 1}`}
                        onChange={(e) => setTimes((ts) => ts.map((x, j) => (j === i ? e.target.value : x)))} />
                      {form.times.length > 1 && (
                        <button className="btn btn-quiet btn-icon" type="button" aria-label={`Remove time ${i + 1}`}
                          onClick={() => setTimes((ts) => ts.filter((_, j) => j !== i))}>
                          <Icon name="close" />
                        </button>
                      )}
                    </span>
                  ))}
                  <button className="btn btn-quiet btn-sm" type="button" onClick={() => setTimes((ts) => [...ts, ""])}>
                    <Icon name="plus" /> Add a time
                  </button>
                </div>
              </div>
              <label className="field">Pills in the box
                <input type="number" min={0} max={999} value={form.pills_left} onChange={set("pills_left")} required placeholder="e.g. 30" />
              </label>
              <label className="field">Expiration
                <input type="date" value={form.expiration} onChange={set("expiration")} required />
              </label>
            </div>
          </fieldset>

          <fieldset className="group">
            <legend>Cabinet box</legend>
            {/* Laid out like the cabinet: boxes 1-3, 4-6, then the long box 7 */}
            <div className="box-pick">
              {SLOTS.map((s) => {
                const used = meds.find((m) => m.slot === s && m.id !== med?.id);
                return (
                  <label key={s} className={`box-opt${s === LONG_SLOT ? " long" : ""}`}>
                    <input type="radio" name="slot" value={s} checked={form.slot === String(s)} disabled={!!used}
                      onChange={set("slot")} required />
                    <span><b>{s}</b><small>{used ? used.name : s === LONG_SLOT ? "Long box, free" : "Free"}</small></span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="group">
            <legend>Pill color <small>Shown on the cabinet screen so the patient can match it</small></legend>
            <div className="swatches">
              {PILL_COLOR_NAMES.map((c) => (
                <label key={c} className="swatch">
                  <input type="radio" name="color" value={c} checked={form.color === c} onChange={set("color")} />
                  <span className="capsule" style={{ "--pill": pillColor(c) } as React.CSSProperties} aria-hidden="true" />
                  {c}
                </label>
              ))}
            </div>
          </fieldset>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <div className="dialog-foot">
          {med && (
            <button className="btn btn-quiet btn-danger-text" type="button" onClick={remove} disabled={saving}>
              {confirmRemove ? "Click again to remove" : "Remove from cabinet"}
            </button>
          )}
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" disabled={saving || reading || !freeSlots.length}>
            {saving ? "Saving…" : med ? "Save changes" : "Save to cabinet"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
