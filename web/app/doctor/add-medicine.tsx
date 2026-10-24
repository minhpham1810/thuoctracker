"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { api, PILL_COLOR_NAMES, type LabelDraft, type Medicine, type Patient } from "@/lib/api";

const TIMES = /^\s*\d{2}:\d{2}(\s*,\s*\d{2}:\d{2})*\s*$/;

// Label photo -> /ai/label draft -> doctor checks it -> POST /medicines.
export default function AddMedicine({ patient, meds, onClose, onSaved }: {
  patient: Patient; meds: Medicine[]; onClose: () => void; onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const freeSlots = ([1, 2, 3] as const).filter((s) => !meds.some((m) => m.slot === s));
  const [form, setForm] = useState({
    name: "", dose: "1 pill", times: "", slot: String(freeSlots[0] ?? ""), pills_left: "10", expiration: "", color: "blue",
  });
  const [note, setNote] = useState<{ text: string; ai?: boolean }>({ text: "Or fill the form by hand." });
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { dialog.current?.showModal(); }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

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
        times: d.times?.join(", ") ?? f.times, expiration: d.expiration ?? f.expiration,
      }));
      const missing = (["name", "dose", "times", "expiration"] as const).filter((k) => d[k] == null);
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
    if (!TIMES.test(form.times)) return setError("Times must look like 08:00, 20:00.");
    setSaving(true);
    setError("");
    try {
      await api<Medicine>("/medicines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patient.id,
          name: form.name.trim(),
          dose: form.dose.trim(),
          times: form.times.split(",").map((t) => t.trim()),
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

  return (
    <dialog ref={dialog} aria-labelledby="add-title" onClose={onClose}>
      <form onSubmit={save}>
        <div className="dialog-head">
          <h3 id="add-title">Add medicine for {patient.name}</h3>
          <button className="btn btn-sm" type="button" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="dialog-body">
          <label className="dropzone">
            <Icon name="camera" />
            <div>
              <strong>{reading ? "Reading label…" : "Photo of the bottle label"}</strong>
              <span>AI reads the name, dose, schedule and expiration</span>
            </div>
            <input type="file" accept="image/*" capture="environment" disabled={reading}
              onChange={(e) => e.target.files?.[0] && readLabel(e.target.files[0])} />
          </label>
          <p className={`note${note.ai ? " ai" : ""}`} aria-live="polite">{note.text}</p>

          <div className="fields">
            <label className="field full">Medicine name
              <input value={form.name} onChange={set("name")} required autoComplete="off" />
            </label>
            <label className="field">Dose
              <input value={form.dose} onChange={set("dose")} required placeholder="1 pill" />
            </label>
            <label className="field">Times per day <small>24h, comma separated</small>
              <input value={form.times} onChange={set("times")} required placeholder="08:00, 20:00" />
            </label>
            <label className="field">Cabinet slot
              <select value={form.slot} onChange={set("slot")} required>
                {freeSlots.map((s) => <option key={s} value={s}>Slot {s}</option>)}
              </select>
            </label>
            <label className="field">Pills in slot
              <input type="number" min={0} max={999} value={form.pills_left} onChange={set("pills_left")} required />
            </label>
            <label className="field">Expiration
              <input type="date" value={form.expiration} onChange={set("expiration")} required />
            </label>
            <label className="field">Pill color <small>shown on the cabinet</small>
              <select value={form.color} onChange={set("color")}>
                {PILL_COLOR_NAMES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <div className="dialog-foot">
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" disabled={saving || reading || !freeSlots.length}>
            {saving ? "Saving…" : "Save to cabinet"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
