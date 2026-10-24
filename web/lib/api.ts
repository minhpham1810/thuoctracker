// Types mirror backend/models.py and the contract in TEAM.md. Change them there first.

// One account = one role; log in by email (POST /login).
export type User = { id: number; email: string; name: string; role: "patient" | "family" | "doctor" };
export type Patient = User & { role: "patient"; age: number; doctor_id: number };

// Cabinet boxes: 1-3 top row, 4-6 middle row, 7 the long box across the bottom.
export const SLOTS = [1, 2, 3, 4, 5, 6, 7] as const;
export type Slot = (typeof SLOTS)[number];
export const LONG_SLOT: Slot = 7;

export type Medicine = {
  id: number; patient_id: number; name: string; dose: string; times: string[];
  slot: Slot; pills_left: number; expiration: string; color: string;
};

export type DoseLog = {
  id: number; medicine_id: number; due_at: string; taken_at: string | null;
  status: "pending" | "taken" | "missed"; method: "camera" | "screen" | null;
};

export type Alert = {
  id: number; type: "missed" | "low_pills" | "expiring_soon"; to: "doctor" | "family";
  patient_id: number; message: string; at: string;
};

export type CabinetState = {
  mode: "idle" | "take" | "taken" | "already_took" | "missed";
  dose_id: number | null; slot: number | null; medicine: string | null;
  color: string | null; message: string;
};

// ai.read_label returns null for anything it couldn't read
export type LabelDraft = { name: string | null; dose: string | null; times: string[] | null; expiration: string | null };

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api${path}`, { cache: "no-store", ...init });
  if (!r.ok) {
    const detail = (await r.json().catch(() => null))?.detail;
    // FastAPI sends a string for HTTPException and a list for validation errors
    const msg = Array.isArray(detail) ? detail.map((d) => d.msg).join("; ") : detail;
    throw new Error(msg || `${r.status} ${r.statusText}`);
  }
  return r.json();
}

const PILL_COLORS: Record<string, string> = {
  blue: "#2563eb", red: "#dc2626", yellow: "#eab308", green: "#16a34a",
  white: "#f1f5f9", orange: "#ea580c", pink: "#db2777", purple: "#7c3aed",
};
export const PILL_COLOR_NAMES = Object.keys(PILL_COLORS);
export const pillColor = (c: string | null) => (c && PILL_COLORS[c.toLowerCase()]) || c || "#94a3b8";

// Backend datetimes are naive local ISO strings; dates are "YYYY-MM-DD" (parsed as local, not UTC).
export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const daysUntil = (ymd: string) =>
  Math.ceil((new Date(`${ymd}T00:00`).getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
export const fmtDate = (ymd: string) =>
  new Date(`${ymd}T00:00`).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
