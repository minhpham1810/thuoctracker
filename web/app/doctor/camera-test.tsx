"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { api, type DoseLog, type Medicine } from "@/lib/api";

type Phase = "before" | "after";
type Counts = Partial<Record<Phase, number | null>>;

// Stands in for the Pi camera: send slot photos for the waiting dose and see Gemini's pill counts.
// The backend marks the dose taken when before - after == 1, same as with the real cabinet.
export default function CameraTest({ patientId, doses, meds, onChange }: {
  patientId: number; doses: DoseLog[]; meds: Medicine[]; onChange: () => void;
}) {
  const [counts, setCounts] = useState<Counts>({});
  const [forDose, setForDose] = useState<number | null>(null);
  const [busy, setBusy] = useState<Phase | null>(null);
  const [error, setError] = useState("");

  // newest waiting dose; keep showing the one just tested so its result stays visible after it's marked taken
  const waiting = doses.find((d) => d.status === "pending");
  const tested = doses.find((d) => d.id === forDose);
  const dose = waiting && waiting.id > (forDose ?? 0) ? waiting : tested ?? waiting;
  const med = meds.find((m) => m.id === dose?.medicine_id);

  if (!dose || !med) {
    return <p className="empty">No dose is waiting. Press <b>Pill time now</b> on a medicine, then send photos here.</p>;
  }
  const shown: Counts = forDose === dose.id ? counts : {}; // new dose -> start over

  async function send(phase: Phase, file: File) {
    setBusy(phase);
    setError("");
    try {
      const body = new FormData();
      body.append("photo", file);
      const r = await api<{ count: number | null }>(
        `/cabinet/${patientId}/photo?dose_id=${dose!.id}&phase=${phase}`, { method: "POST", body });
      setCounts({ ...shown, [phase]: r.count });
      setForDose(dose!.id);
      onChange();
    } catch (e) {
      setError(`Couldn't send the photo (${(e as Error).message}).`);
    } finally {
      setBusy(null);
    }
  }

  const { before, after } = shown;
  const both = before != null && after != null;

  return (
    <div className="cam-test">
      <p className="note">{dose.status === "pending" ? "Waiting" : dose.status === "taken" ? "Taken" : "Missed"}: <b>{med.name}</b> in slot {med.slot}. Take a photo of the slot before and after removing one pill.</p>
      <div className="cam-grid">
        {(["before", "after"] as const).map((phase) => (
          <label key={phase} className="dropzone">
            <Icon name="camera" />
            <div>
              <strong>{busy === phase ? "Counting…" : phase === "before" ? "1. Before photo" : "2. After photo"}</strong>
              <span>
                {shown[phase] === undefined ? "Tap to choose a photo"
                  : shown[phase] === null ? "AI couldn't count. Use “I took it”."
                  : `AI counted ${shown[phase]} pill${shown[phase] === 1 ? "" : "s"}`}
              </span>
            </div>
            <input type="file" accept="image/*" capture="environment" disabled={busy !== null || dose.status !== "pending"}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) send(phase, f); }} />
          </label>
        ))}
      </div>
      {both && (
        <p className={`note ai`} aria-live="polite">
          {before! - after! === 1
            ? "One pill removed: marked taken by the cabinet camera."
            : `${before! - after!} pills removed, so not marked taken (needs exactly 1).`}
        </p>
      )}
      {error && <p className="note" role="alert" style={{ color: "var(--bad)" }}>{error}</p>}
    </div>
  );
}
