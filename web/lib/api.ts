// Types mirror backend/models.py and the contract in TEAM.md. Change them there first.

// One account = one role; log in with email + password (POST /login or /signup -> Session).
type Base = { id: number; email: string; name: string };
export type Doctor = Base & { role: "doctor" };
export type Patient = Base & { role: "patient"; age: number; doctor_id: number };
export type Family = Base & { role: "family"; patient_id: number };
export type User = Doctor | Patient | Family;
export type Session = { token: string; user: User };

export type Message = { id: number; from_id: number; to_id: number; text: string; at: string };
// Someone in my care circle (GET /contacts), with our chat state.
export type Contact = { user: User; unread: number; last: Message | null };

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
export type LabelDraft = {
  name: string | null; dose: string | null; times: string[] | null; expiration: string | null; quantity: number | null;
};

// The dashboard sets the session token; the cabinet screen never does (its routes are login-free).
let token: string | null = null;
let unauthorized: (() => void) | null = null;
export const setToken = (t: string | null) => { token = t; };
export const onUnauthorized = (fn: (() => void) | null) => { unauthorized = fn; };

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const r = await fetch(`/api${path}`, { cache: "no-store", ...init, headers });
  if (r.status === 401 && token) unauthorized?.();
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
// "Minh (grandson)" -> "MG", "Dr. Nguyen" -> "DN"
export const initials = (name: string) =>
  (name.match(/\p{L}+/gu) ?? ["?"]).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
export const ymdOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// "08:00" -> "8:00 AM"
export function clock(hhmm: string) {
  const [h, min] = hhmm.split(":").map(Number);
  return new Date(0, 0, 0, h, min).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export type TodayStatus = "taken" | "missed" | "due" | "later";
export type TodayItem = {
  key: string; at: string; name: string; color: string | null; slot?: number; status: TodayStatus; log?: DoseLog;
};

// Today's doses from the log (taken / missed / due now) plus scheduled times still to come, in time order.
// Display only: the backend owns the schedule.
export function todayItems(meds: Medicine[], doses: DoseLog[], now: Date | null): TodayItem[] {
  if (!now) return [];
  const ymd = ymdOf(now);
  const hhmm = now.toTimeString().slice(0, 5);
  const med = (id: number) => meds.find((m) => m.id === id);
  const logged = doses.filter((d) => d.due_at.startsWith(ymd)).map((d) => ({
    key: `d${d.id}`, at: d.due_at.slice(11, 16), name: med(d.medicine_id)?.name ?? "Medicine", log: d,
    color: med(d.medicine_id)?.color ?? null, slot: med(d.medicine_id)?.slot, status: (d.status === "pending" ? "due" : d.status) as TodayStatus,
  }));
  const later = meds.flatMap((m) => m.times
    .filter((t) => t > hhmm && !doses.some((d) => d.medicine_id === m.id && d.due_at.startsWith(`${ymd}T${t}`)))
    .map((t) => ({ key: `m${m.id}-${t}`, at: t, name: m.name, color: m.color, slot: m.slot, status: "later" as TodayStatus })));
  return [...logged, ...later].sort((a, b) => a.at.localeCompare(b.at));
}
