"""Backend API. Every other part reads/writes through here.

Run: uvicorn backend.main:app --reload --host 0.0.0.0   (from repo root). Web pages: Next.js in web/ (port 3000).

Routes and response shapes follow the contract in TEAM.md. Data lives in Tiger Data (Postgres, see db.py),
seeded with sample users on first start; AI routes fall back to fake answers if ai/ fails.

Auth: app and dashboard routes need "Authorization: Bearer <token>" from /login or /signup.
Cabinet routes (Pi + touchscreen) and /demo/* are login-free: trusted devices on the hotspot.
"""
import asyncio
import base64
import hashlib
import hmac
import os
import secrets
import socket
from contextlib import asynccontextmanager
from datetime import date, datetime, time, timedelta
from time import perf_counter
from typing import Literal, Optional

import psycopg
import requests
from dotenv import load_dotenv
from fastapi import Body, Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from psycopg.types.json import Jsonb
from pydantic import TypeAdapter

import ai

from . import labels
from .db import SCHEMA, pool, q, q1
from .models import (Alert, AnyUser, Appointment, Availability, Booking, Contact, Credentials, DoseLog, LabelPhoto, Medicine, MedicineUpdate, Message, Patient,
                     PushToken, Role, Session, Signup)
from .push import send_push

load_dotenv()
DEMO = os.environ.get("DEMO") == "1"  # shortened times so judges see it live
MISSED_AFTER = timedelta(seconds=30) if DEMO else timedelta(minutes=30)
REMIND_EVERY = timedelta(seconds=10) if DEMO else timedelta(minutes=10)
TICK_SECONDS = 2
DEMO_PASSWORD = "demo1234"  # every seeded account
AUDIO_DIR = "audio"  # MP3s from ai.speak(), served at /audio/
os.makedirs(AUDIO_DIR, exist_ok=True)

# Several backends may run against the same database. Everything they share is in the DB; only the one holding
# scheduler_lease runs the scheduler, and another takes over when its heartbeat is LEASE_STALE old.
HOLDER = f"{socket.gethostname()}-{os.getpid()}-{secrets.token_hex(3)}"
LEASE_STALE = timedelta(seconds=15)
CATCH_UP = timedelta(minutes=1)  # on takeover, start doses the old scheduler missed, at most this far back
leader = False  # does this backend run the scheduler right now (shown in /health)


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        q(SCHEMA)
    except Exception as e:
        raise RuntimeError(f"Can't reach Tiger Data: check DATABASE_URL in .env and the internet ({e!r})")
    if q1("SELECT 1 FROM users LIMIT 1") is None:
        seed()
    else:
        # accounts made before passwords existed get the demo password
        for r in q("SELECT id FROM users WHERE password_hash IS NULL"):
            q("UPDATE users SET password_hash = %s WHERE id = %s", hash_password(DEMO_PASSWORD), r["id"])
        # first start since alerts_sent existed: conditions alerted before then must not re-send
        if q1("SELECT 1 FROM alerts_sent LIMIT 1") is None:
            today = date.today()
            for m in all_medicines():
                if m.pills_left < 5:
                    claim_alert(("low_pills", m.id))
                if m.expiration - today <= timedelta(days=7):
                    claim_alert(("expiring_soon", m.id))
    try:
        labels.ensure_schema()  # FDA label tables; filled once per database by `python -m backend.labels ingest`
    except Exception as e:
        print(f"[labels] no label tables: {e!r}")
    task = asyncio.create_task(scheduler())
    yield
    task.cancel()
    try:
        q("DELETE FROM scheduler_lease WHERE holder = %s", HOLDER)  # hand the scheduler over right away
    except Exception:
        pass
    pool.close()  # else --reload waits 5 s on the pool's threads


app = FastAPI(title="ThuocTracker", lifespan=lifespan)
# the Expo app opened in a browser calls the API from another origin
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def seed():
    """Wipe the DB (and every login) and load the demo people. Password for all: DEMO_PASSWORD."""
    today = date.today()
    now = datetime.now()
    pw = hash_password(DEMO_PASSWORD)
    with pool.connection() as c, c.transaction():
        c.execute("TRUNCATE users, medicines, doses, alerts, messages, sessions, cabinet_commands, cabinet_state,"
                  " cabinet_answer, photo_counts, alerts_sent, appointment_slots RESTART IDENTITY CASCADE")
        cur = c.cursor()
        # patients keep ids 1-3: the cabinet screen and the Pi use ?patient=1. Doctor first so FKs resolve.
        cur.executemany(
            "INSERT INTO users (id, email, name, role, age, doctor_id, patient_id, password_hash)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s)", [
                (4, "doctor@demo.com", "Dr. Nguyen", "doctor", None, None, None, pw),
                (1, "lan@demo.com", "Grandma Lan", "patient", 78, 4, None, pw),
                (2, "tran@demo.com", "Mr. Tran", "patient", 82, 4, None, pw),
                (3, "hoa@demo.com", "Mrs. Hoa", "patient", 74, 4, None, pw),
                (5, "minh@demo.com", "Minh (grandson)", "family", None, None, 1, pw),
                (6, "anh@demo.com", "Anh (son)", "family", None, None, 2, pw),
            ])
        c.execute("SELECT setval('users_id_seq', (SELECT max(id) FROM users))")
        # RESTART IDENTITY: these get ids 1-4 in order
        cur.executemany(
            "INSERT INTO medicines (patient_id, name, dose, times, slot, pills_left, expiration, color)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s)", [
                (1, "Aspirin", "1 pill", ["08:00", "20:00"], 1, 10, today + timedelta(days=90), "blue"),
                (1, "Metformin", "1 pill", ["12:00"], 2, 4, today + timedelta(days=5), "red"),
                (2, "Lisinopril", "1 pill", ["09:00"], 1, 20, today + timedelta(days=200), "yellow"),
                (3, "Atorvastatin", "1 pill", ["21:00"], 1, 15, today + timedelta(days=120), "white"),
            ])
        cur.executemany(
            "INSERT INTO doses (medicine_id, due_at, taken_at, status, method) VALUES (%s, %s, %s, %s, %s)", [
                (1, now - timedelta(hours=12), now - timedelta(hours=12, minutes=-3), "taken", "camera"),
                (2, now - timedelta(hours=24), None, "missed", None),
            ])
        cur.executemany(
            'INSERT INTO alerts (type, "to", patient_id, message, at) VALUES (%s, %s, %s, %s, %s)', [
                ("missed", "family", 1, "Grandma Lan missed Metformin (12:00).", now - timedelta(hours=23)),
                ("low_pills", "doctor", 1, "Grandma Lan has 4 Metformin left. Refill needed.", now - timedelta(hours=1)),
            ])
        cur.executemany("INSERT INTO messages (from_id, to_id, text, at, read_at) VALUES (%s, %s, %s, %s, %s)", [
            (5, 4, "Dr. Nguyen, Grandma seems tired after the new Metformin.", now - timedelta(hours=3), now),
            (4, 5, "Thanks for telling me. Let's talk at her visit on Friday.", now - timedelta(hours=2), now),
        ])
        c.execute("INSERT INTO alerts_sent (kind, medicine_id) VALUES ('low_pills', 2)")  # the seeded alert above
        # Dr. Nguyen's open times tomorrow 9:00-11:00, Grandma Lan already booked at 10:00
        nine = datetime.combine(today + timedelta(days=1), time(9))
        cur.executemany(
            "INSERT INTO appointment_slots (doctor_id, starts_at, minutes, patient_id, booked_by, reason, booked_at)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s)",
            [(4, nine + timedelta(minutes=30 * i), 30) + ((1, 5, "Feeling tired on the new Metformin", now)
                                                          if i == 2 else (None, None, None, None)) for i in range(4)])


# --- Auth ----------------------------------------------------------------------
def hash_password(pw: str) -> str:
    salt = os.urandom(16)
    return f"{salt.hex()}${hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1).hex()}"


def check_password(pw: str, stored: Optional[str]) -> bool:
    if not stored:
        return False
    salt, digest = stored.split("$")
    got = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1).hex()
    return hmac.compare_digest(got, digest)


def bearer(authorization: str = Header("")) -> str:
    return authorization.removeprefix("Bearer ").strip()


def me(token: str = Depends(bearer)):
    """The logged-in user. shortcut: sessions never expire; add created_at checks if this goes beyond the demo."""
    row = q1("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = %s", token) if token else None
    if not row:
        raise HTTPException(401, "Please log in")
    return as_user(row)


def new_session(user_row: dict) -> Session:
    token = secrets.token_urlsafe(32)
    q("INSERT INTO sessions (token, user_id, created_at) VALUES (%s, %s, %s)", token, user_row["id"], datetime.now())
    return Session(token=token, user=as_user(user_row))


def find_email(email: Optional[str]) -> Optional[dict]:
    return q1("SELECT * FROM users WHERE lower(email) = lower(%s)", (email or "").strip())


# --- Reads + access ------------------------------------------------------------
as_user = TypeAdapter(AnyUser).validate_python  # drops password_hash: it's not a model field


def get_user(user_id: int):
    row = q1("SELECT * FROM users WHERE id = %s", user_id)
    if not row:
        raise HTTPException(404, f"user {user_id} not found")
    return as_user(row)


def get_patient(patient_id: int) -> Patient:
    u = get_user(patient_id)
    if u.role != "patient":
        raise HTTPException(404, f"patient {patient_id} not found")
    return u


def get_medicine(medicine_id: int) -> Medicine:
    row = q1("SELECT * FROM medicines WHERE id = %s", medicine_id)
    if not row:
        raise HTTPException(404, f"medicine {medicine_id} not found")
    return Medicine(**row)


def get_dose(dose_id: int) -> DoseLog:
    row = q1("SELECT * FROM doses WHERE id = %s", dose_id)
    if not row:
        raise HTTPException(404, f"dose {dose_id} not found")
    return DoseLog(**row)


def all_medicines() -> list[Medicine]:
    return [Medicine(**r) for r in q("SELECT * FROM medicines ORDER BY id")]


def medicines_of(patient_id: int) -> list[Medicine]:
    return [Medicine(**r) for r in q("SELECT * FROM medicines WHERE patient_id = %s ORDER BY slot", patient_id)]


def doses_of(patient_id: int) -> list[DoseLog]:
    rows = q("SELECT d.* FROM doses d JOIN medicines m ON m.id = d.medicine_id"
             " WHERE m.patient_id = %s ORDER BY d.due_at DESC", patient_id)
    return [DoseLog(**r) for r in rows]


def circle(u) -> tuple[str, list]:
    """WHERE clause over `users u` for the people assigned to u: doctor -> their patients + those patients'
    families; patient -> their doctor + family; family -> their patient + that patient's doctor."""
    if u.role == "doctor":
        return "u.doctor_id = %s OR u.patient_id IN (SELECT id FROM users WHERE doctor_id = %s)", [u.id, u.id]
    if u.role == "patient":
        return "u.id = %s OR u.patient_id = %s", [u.doctor_id, u.id]
    return "u.id = %s OR u.id = (SELECT doctor_id FROM users WHERE id = %s)", [u.patient_id, u.patient_id]


def require_access(u, patient_id: int) -> Patient:
    """The patient, their family or their doctor."""
    p = get_patient(patient_id)
    if not (u.id == p.id or (u.role == "family" and u.patient_id == p.id) or (u.role == "doctor" and p.doctor_id == u.id)):
        raise HTTPException(403, "Not in this patient's care circle")
    return p


def require_doctor_or_family(u, patient_id: int) -> Patient:
    """The patient's doctor or their family (they load the cabinet at home)."""
    p = get_patient(patient_id)
    if not ((u.role == "doctor" and p.doctor_id == u.id) or (u.role == "family" and u.patient_id == p.id)):
        raise HTTPException(403, "Only this patient's doctor or family can do that")
    return p


def require_doctor_of(u, patient_id: int) -> Patient:
    p = get_patient(patient_id)
    if u.role != "doctor" or p.doctor_id != u.id:
        raise HTTPException(403, "Only this patient's doctor can do that")
    return p


# --- Cabinet + alerts ----------------------------------------------------------
def idle_state() -> dict:
    return {"mode": "idle", "dose_id": None, "slot": None, "medicine": None,
            "color": None, "message": "ThuocTracker"}


def set_state(patient_id: int, mode: str, dose: DoseLog, m: Medicine, message: str):
    state = {"mode": mode, "dose_id": dose.id, "slot": m.slot, "medicine": m.name, "color": m.color, "message": message}
    q("INSERT INTO cabinet_state (patient_id, state) VALUES (%s, %s)"
      " ON CONFLICT (patient_id) DO UPDATE SET state = EXCLUDED.state", patient_id, Jsonb(state))


_unset = object()


def try_ai(fn, *args, fallback, on_error=_unset):
    """Call an ai/ function; `fallback` while it's unwritten, `on_error` (default: fallback) if it fails."""
    try:
        return fn(*args)
    except NotImplementedError:
        return fallback
    except Exception as e:
        print(f"[ai] {fn.__name__} failed: {e!r}")
        return fallback if on_error is _unset else on_error


def speech_url(text: str) -> Optional[str]:
    """MP3 for `text` via ai.speak(), cached by text. None -> Pi plays its backup sound."""
    name = hashlib.sha1(text.encode()).hexdigest()[:12] + ".mp3"
    path = os.path.join(AUDIO_DIR, name)
    if not os.path.exists(path):
        mp3 = try_ai(ai.speak, text, fallback=None)
        if not mp3:
            return None
        with open(path, "wb") as f:
            f.write(mp3)
    return f"/audio/{name}"


def say(patient_id: int, dose: DoseLog, text: Optional[str], sound: Optional[str], open_slot: Optional[int] = None):
    """Queue audio for the Pi; open_slot only when the door should open. text None: open the door silently."""
    cmd = {"dose_id": dose.id, "say_url": speech_url(text) if text else None, "sound": sound}
    if open_slot:
        cmd["open_slot"] = open_slot
    push_command(patient_id, cmd)


def mark_taken(dose: DoseLog, method: Literal["camera", "screen"]) -> DoseLog:
    m = get_medicine(dose.medicine_id)
    # conditional update: the scheduler may be marking it missed at the same moment
    row = q1("UPDATE doses SET status = 'taken', taken_at = %s, method = %s"
             " WHERE id = %s AND status <> 'taken' RETURNING *", datetime.now(), method, dose.id)
    if not row:
        set_state(m.patient_id, "already_took", dose, m, "You already took this one.")
        say(m.patient_id, dose, "You already took this one.", "already_took")
        return get_dose(dose.id)
    q("UPDATE medicines SET pills_left = GREATEST(pills_left - 1, 0) WHERE id = %s", m.id)
    drop_door_commands(m.patient_id, dose.id)
    set_state(m.patient_id, "taken", dose, m, "Good job!")
    say(m.patient_id, dose, "Good job!", "good_job")
    if dose.status == "missed":  # family and doctor were told it was missed: tell them it was taken after all
        p = get_patient(m.patient_id)
        due = f"{dose.due_at:%H:%M}" if dose.due_at.date() == date.today() else f"{dose.due_at:%b} {dose.due_at.day}, {dose.due_at:%H:%M}"
        text = f"{p.name} took {m.name} ({due}) late, at {datetime.now():%H:%M}."
        push_to("family", p, "Taken late", text)
        push_to("doctor", p, "Taken late", text)
    return DoseLog(**row)


def push_command(patient_id: int, cmd: dict):
    q("INSERT INTO cabinet_commands (patient_id, dose_id, opens_door, cmd) VALUES (%s, %s, %s, %s)",
      patient_id, cmd.get("dose_id"), "open_slot" in cmd, Jsonb(cmd))


def door_queued(patient_id: int, dose_id: int) -> bool:
    return q1("SELECT 1 FROM cabinet_commands WHERE patient_id = %s AND dose_id = %s AND opens_door",
              patient_id, dose_id) is not None


def drop_door_commands(patient_id: int, dose_id: int):
    """Dose is settled: queued reminders must not reopen the door."""
    q("DELETE FROM cabinet_commands WHERE patient_id = %s AND dose_id = %s AND opens_door", patient_id, dose_id)


def dose_log(patient_id: int) -> list[dict]:
    """Dose log in the shape ai.answer() expects (see TEAM.md), plus the pill color patients ask by ("my blue pill")."""
    rows = q("SELECT m.name, m.color, d.due_at, d.status, d.taken_at FROM doses d JOIN medicines m ON m.id = d.medicine_id"
             " WHERE m.patient_id = %s ORDER BY d.due_at DESC", patient_id)
    return [{"medicine": r["name"], "color": r["color"], "due_at": r["due_at"].isoformat(), "status": r["status"],
             "taken_at": r["taken_at"].isoformat() if r["taken_at"] else None} for r in rows]


def push_users(user_ids: list[int], title: str, body: str, data: dict):
    tokens = [r["push_token"] for r in q("SELECT DISTINCT push_token FROM sessions"
                                          " WHERE user_id = ANY(%s) AND push_token IS NOT NULL", user_ids)]
    send_push(tokens, title, body, data)


def push_to(role: Role, p: Patient, title: str, body: str):
    """Push to the phones of `role` in patient p's care circle."""
    if role == "family":
        ids = [r["id"] for r in q("SELECT id FROM users WHERE patient_id = %s", p.id)]
    else:
        ids = [p.doctor_id if role == "doctor" else p.id]
    push_users(ids, title, body, {"patient_id": p.id})


def add_alert(type: str, to: Literal["doctor", "family"], p: Patient, message: str):
    """Every alert goes to the dashboard and by push to that role's phones."""
    q('INSERT INTO alerts (type, "to", patient_id, message, at) VALUES (%s, %s, %s, %s, %s)',
      type, to, p.id, message, datetime.now())
    push_to(to, p, "ThuocTracker", message)


def claim_alert(key: tuple) -> bool:
    """Record (alert type, medicine_id) as alerted. False if it already was (by this or another backend)."""
    return bool(q("INSERT INTO alerts_sent (kind, medicine_id) VALUES (%s, %s) ON CONFLICT DO NOTHING RETURNING kind",
                  *key))


def and_list(items: list[str]) -> str:
    """'A', 'A and B', 'A, B and C'"""
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + f" and {items[-1]}"


def pill_call(p: Patient, meds: list[Medicine]) -> str:
    """The pill-time announcement, each pill due now named once: "Hi, Grandma Lan, please pay attention. You have
    a white pill and a blue pill. Atorvastatin and Aspirin, now." It names pills; it never says a dose amount."""
    colors = [f"{'an' if med.color[:1].lower() in 'aeiou' else 'a'} {med.color} pill" for med in meds]
    return f"Hi, {p.name}, please pay attention. You have {and_list(colors)}. {and_list([med.name for med in meds])}, now."


def remind(dose: DoseLog, m: Medicine):
    """Open the box and announce pill time. Pills due the same minute share one announcement: the dose with the
    lowest id says it, the others only open their doors. Callers record doses.reminded_at."""
    if door_queued(m.patient_id, dose.id):  # Pi hasn't picked up the last one yet (door cycle > repeat time)
        return
    group = q("SELECT d.id AS dose_id, m.* FROM doses d JOIN medicines m ON m.id = d.medicine_id"
              " WHERE m.patient_id = %s AND d.status = 'pending'"
              " AND date_trunc('minute', d.due_at) = date_trunc('minute', %s::timestamp) ORDER BY m.slot",
              m.patient_id, dose.due_at)
    text = pill_call(get_patient(m.patient_id), [Medicine(**r) for r in group] or [m])
    first = min((r["dose_id"] for r in group), default=dose.id)
    if dose.id == first:
        say(m.patient_id, dose, text, "time_for_pill", open_slot=m.slot)
    else:
        say(m.patient_id, dose, None, None, open_slot=m.slot)
    set_state(m.patient_id, "take", dose, m, text)


def start_doses(items: list[tuple[Medicine, datetime]]) -> list[DoseLog]:
    """Create the doses, then announce: every pill due at once is in the database before the first
    announcement, so it names them all. Doses another scheduler already started are skipped."""
    started = []
    for m, due_at in items:
        row = q1("INSERT INTO doses (medicine_id, due_at, reminded_at) VALUES (%s, %s, %s)"
                 " ON CONFLICT DO NOTHING RETURNING *", m.id, due_at, datetime.now())
        if row:
            started.append((DoseLog(**row), m))
    for dose, m in started:
        remind(dose, m)
        p = get_patient(m.patient_id)
        push_to("patient", p, "Pill time", f"Time for your {m.color} pill ({m.name}).")
        # many older patients don't use a phone: family gets it too so they can call or help
        push_to("family", p, "Pill time", f"Time for {p.name}'s {m.color} pill ({m.name}), slot {m.slot}.")
    return [d for d, _ in started]


def start_dose(m: Medicine, due_at: datetime) -> Optional[DoseLog]:
    """None if this dose already exists (another scheduler started it)."""
    started = start_doses([(m, due_at)])
    return started[0] if started else None


def tick(last: datetime) -> datetime:
    """One scheduler pass: start doses due since `last`, remind, mark missed, low/expiring alerts.
    Every step is a conditional write, so two backends overlapping for a moment can't double-send."""
    now = datetime.now()
    patients = {r["id"]: Patient(**r) for r in q("SELECT * FROM users WHERE role = 'patient'")}
    meds = {m.id: m for m in all_medicines()}
    sent = {(r["kind"], r["medicine_id"]) for r in q("SELECT kind, medicine_id FROM alerts_sent")}
    due_now = [(m, datetime.combine(now.date(), time.fromisoformat(t))) for m in meds.values() for t in m.times]
    start_doses([(m, due) for m, due in due_now if last < due <= now])  # all at once: one announcement per minute
    for m in meds.values():
        p = patients[m.patient_id]
        low = ("low_pills", m.id)
        if m.pills_left < 5 and low not in sent and claim_alert(low):
            add_alert("low_pills", "doctor", p, f"{p.name} has {m.pills_left} {m.name} left. Refill needed.")
            add_alert("low_pills", "family", p, f"{p.name} has only {m.pills_left} {m.name} left.")
        elif m.pills_left >= 5 and low in sent:
            q("DELETE FROM alerts_sent WHERE kind = %s AND medicine_id = %s", *low)  # refilled; alert again next time
        expiring = ("expiring_soon", m.id)
        if m.expiration - now.date() > timedelta(days=7):
            if expiring in sent:  # new bottle; alert again when this one gets close
                q("DELETE FROM alerts_sent WHERE kind = %s AND medicine_id = %s", *expiring)
        elif expiring not in sent and claim_alert(expiring):
            add_alert("expiring_soon", "family", p, f"{p.name}'s {m.name} expires on {m.expiration}.")
            add_alert("expiring_soon", "doctor", p, f"{p.name}'s {m.name} expires on {m.expiration}.")
    for r in q("SELECT * FROM doses WHERE status = 'pending'"):
        d, m = DoseLog(**r), meds.get(r["medicine_id"])
        if m is None:  # medicine deleted during this pass
            continue
        if now - d.due_at >= MISSED_AFTER:
            if not q("UPDATE doses SET status = 'missed' WHERE id = %s AND status = 'pending' RETURNING id", d.id):
                continue  # taken in the meantime
            p = patients[m.patient_id]
            drop_door_commands(p.id, d.id)
            set_state(p.id, "missed", d, m, "You missed your pill.")
            say(p.id, d, "You missed your pill.", "missed")
            add_alert("missed", "family", p, f"{p.name} missed {m.name} ({d.due_at:%H:%M}).")
            add_alert("missed", "doctor", p, f"{p.name} missed {m.name} ({d.due_at:%H:%M}).")
            # inform only: never tell the patient to take it late (could double up with the next dose)
            push_to("patient", p, "Missed pill", f"You missed your {d.due_at:%H:%M} {m.name}. Your family and doctor have been told.")
        elif now - (r["reminded_at"] or d.due_at) >= REMIND_EVERY and q(
                "UPDATE doses SET reminded_at = %s WHERE id = %s AND status = 'pending'"
                " AND coalesce(reminded_at, due_at) <= %s RETURNING id", now, d.id, now - REMIND_EVERY):
            remind(d, m)
    # appointment reminders, one hour before (a conditional UPDATE claims each one, so it goes out once)
    for a in q("UPDATE appointment_slots SET reminded_at = %s WHERE patient_id IS NOT NULL AND reminded_at IS NULL"
               " AND starts_at > %s AND starts_at <= %s RETURNING id", now, now, now + timedelta(hours=1)):
        s = get_appointment(a["id"])
        push_users(circle_of(s["patient_id"]), "Appointment soon",
                   f"{s['patient_name']} sees {s['doctor_name']} {when(s['starts_at'])}.", {"slot_id": s["id"]})
    return now


# Take the lease if it's ours or stale; renew it if ours. Returns where the last pass ended (on takeover:
# the old scheduler's, but no more than CATCH_UP ago). On a brand-new lease, start from now.
LEASE_SQL = """
INSERT INTO scheduler_lease (id, holder, heartbeat, last_tick) VALUES (1, %s, now(), %s)
ON CONFLICT (id) DO UPDATE SET holder = EXCLUDED.holder, heartbeat = now(),
  last_tick = CASE WHEN scheduler_lease.holder = EXCLUDED.holder THEN scheduler_lease.last_tick
                   ELSE GREATEST(scheduler_lease.last_tick, %s) END
WHERE scheduler_lease.holder = EXCLUDED.holder OR scheduler_lease.heartbeat < now() - %s
RETURNING last_tick
"""


def scheduler_step():
    global leader
    now = datetime.now()
    lease = q1(LEASE_SQL, HOLDER, now, now - CATCH_UP, LEASE_STALE)
    if not lease:
        if leader:
            print("[scheduler] another backend runs the scheduler now")
        leader = False
        return
    if not leader:
        print(f"[scheduler] this backend runs the scheduler ({HOLDER})")
    leader = True
    done = tick(lease["last_tick"])
    q("UPDATE scheduler_lease SET last_tick = %s WHERE holder = %s", done, HOLDER)


async def scheduler():
    while True:
        try:
            await asyncio.to_thread(scheduler_step)  # to_thread: DB and push calls block
        except Exception as e:
            print(f"[scheduler] {e!r}")
        await asyncio.sleep(TICK_SECONDS)


@app.get("/health")
def health():
    return {"ok": True, "scheduler": leader}


# --- Accounts ------------------------------------------------------------------
@app.post("/signup")
def signup(s: Signup) -> Session:
    email = s.email.strip().lower()
    if "@" not in email:
        raise HTTPException(400, "Enter a valid email")
    if find_email(email):
        raise HTTPException(409, "That email already has an account")
    doctor_id = patient_id = None
    if s.role == "patient":
        if s.age is None:
            raise HTTPException(400, "Enter your age")
        d = find_email(s.doctor_email)
        if not d or d["role"] != "doctor":
            raise HTTPException(400, "No doctor account with that email")
        doctor_id = d["id"]
    elif s.role == "family":
        p = find_email(s.patient_email)
        if not p or p["role"] != "patient":
            raise HTTPException(400, "No patient account with that email")
        patient_id = p["id"]
    try:
        row = q1("INSERT INTO users (email, name, role, age, doctor_id, patient_id, password_hash)"
                 " VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING *",
                 email, s.name.strip(), s.role, s.age if s.role == "patient" else None,
                 doctor_id, patient_id, hash_password(s.password))
    except psycopg.errors.UniqueViolation:  # same email signed up at the same moment
        raise HTTPException(409, "That email already has an account")
    return new_session(row)


@app.post("/login")
def login(c: Credentials) -> Session:
    row = find_email(c.email)
    if not row or not check_password(c.password, row["password_hash"]):
        raise HTTPException(401, "Wrong email or password")  # same message: don't reveal which emails exist
    return new_session(row)


@app.post("/login/auth0")
def login_auth0(access_token: str = Body(embed=True), new_doctor: bool = Body(True)) -> Session:
    """"Continue with Auth0" (dashboard and app): Auth0 vouches for the email, then it's our usual session."""
    domain = os.getenv("AUTH0_DOMAIN")
    if not domain:
        raise HTTPException(503, "Auth0 isn't set up on this backend (AUTH0_DOMAIN in .env)")
    try:
        r = requests.get(f"https://{domain}/userinfo", headers={"Authorization": f"Bearer {access_token}"}, timeout=10)
    except requests.RequestException:
        raise HTTPException(502, "Couldn't reach Auth0")
    if r.status_code != 200:
        raise HTTPException(401, "Your Auth0 login expired. Log in again")
    info = r.json()
    email = (info.get("email") or "").strip().lower()
    if "@" not in email:
        raise HTTPException(400, "Your Auth0 account has no email")
    # dashboard: a new email gets a doctor account, the same as its /signup
    row = new_doctor and q1("INSERT INTO users (email, name, role) VALUES (%s, %s, 'doctor') ON CONFLICT DO NOTHING RETURNING *",
                            email, (info.get("name") or email).strip())
    if not row:
        row = find_email(email)
        if not row:  # the app: patients and family need more than an email, so they sign up there first
            raise HTTPException(404, f"No account for {email} yet. Tap Create an account and use this email")
        if not info.get("email_verified"):  # else anyone could sign up on Auth0 with someone's email and log in as them
            raise HTTPException(401, "That email already has an account. Verify it with Auth0 first (check your inbox)")
    return new_session(row)


@app.post("/logout")
def logout(token: str = Depends(bearer)):
    q("DELETE FROM sessions WHERE token = %s", token)
    return {"ok": True}


@app.get("/me")
def whoami(u=Depends(me)) -> AnyUser:
    return u


@app.post("/push/register")
def register_push(t: PushToken, token: str = Depends(bearer), u=Depends(me)):
    """The app sends its Expo push token after login. One phone = one account."""
    q("UPDATE sessions SET push_token = NULL WHERE push_token = %s", t.token)
    q("UPDATE sessions SET push_token = %s WHERE token = %s", t.token, token)
    return {"ok": True}


# --- Care circle: people, chat, alerts -------------------------------------------
@app.get("/contacts")
def list_contacts(u=Depends(me)) -> list[Contact]:
    where, args = circle(u)
    rows = q(f"""SELECT u.*,
        (SELECT count(*) FROM messages m WHERE m.from_id = u.id AND m.to_id = %s AND m.read_at IS NULL) AS unread,
        (SELECT row_to_json(m) FROM messages m
          WHERE (m.from_id = u.id AND m.to_id = %s) OR (m.from_id = %s AND m.to_id = u.id)
          ORDER BY m.at DESC, m.id DESC LIMIT 1) AS last
        FROM users u WHERE {where} ORDER BY u.id""", u.id, u.id, u.id, *args)
    return [Contact(user=as_user(r), unread=r["unread"], last=r["last"]) for r in rows]


@app.get("/messages")
def list_messages(with_id: Optional[int] = None, since: Optional[datetime] = None, u=Depends(me)) -> list[Message]:
    """My messages (only with with_id if given), oldest first. Opening a chat marks it read."""
    sql, args = "SELECT * FROM messages WHERE %s IN (from_id, to_id)", [u.id]
    if with_id is not None:
        q("UPDATE messages SET read_at = %s WHERE from_id = %s AND to_id = %s AND read_at IS NULL",
          datetime.now(), with_id, u.id)
        sql += " AND %s IN (from_id, to_id)"
        args.append(with_id)
    if since is not None:
        sql += " AND at > %s"
        args.append(since)
    return [Message(**r) for r in q(sql + " ORDER BY at, id", *args)]


@app.post("/messages")
def send_message(msg: Message, u=Depends(me)) -> Message:
    where, args = circle(u)
    if not q1(f"SELECT 1 FROM users u WHERE u.id = %s AND ({where})", msg.to_id, *args):
        raise HTTPException(403, "You can only message people in your care circle")
    text = msg.text.strip()
    if not text:
        raise HTTPException(400, "Empty message")
    row = q1("INSERT INTO messages (from_id, to_id, text, at) VALUES (%s, %s, %s, %s) RETURNING *",
             u.id, msg.to_id, text, datetime.now())
    push_users([msg.to_id], u.name, text, {"from_id": u.id})
    return Message(**row)


@app.get("/alerts")
def list_alerts(since: Optional[datetime] = None, u=Depends(me)) -> list[Alert]:
    """Doctor: every alert about their patients. Family: their patient's family alerts. Patient: none."""
    if u.role == "patient":
        return []
    if u.role == "doctor":
        sql, args = "SELECT a.* FROM alerts a JOIN users p ON p.id = a.patient_id WHERE p.doctor_id = %s", [u.id]
    else:
        sql, args = """SELECT a.* FROM alerts a WHERE a.patient_id = %s AND a."to" = 'family'""", [u.patient_id]
    if since is not None:
        sql += " AND a.at > %s"
        args.append(since)
    return [Alert(**r) for r in q(sql + " ORDER BY a.id", *args)]


# --- Patient data ---------------------------------------------------------------
@app.get("/patients/{patient_id}/medicines")
def patient_medicines(patient_id: int, u=Depends(me)) -> list[Medicine]:
    require_access(u, patient_id)
    return medicines_of(patient_id)


@app.get("/patients/{patient_id}/doses")
def patient_doses(patient_id: int, u=Depends(me)) -> list[DoseLog]:
    require_access(u, patient_id)
    return doses_of(patient_id)


def slot_taken(patient_id: int, slot: int) -> bool:
    return q1("SELECT 1 FROM medicines WHERE patient_id = %s AND slot = %s", patient_id, slot) is not None


@app.post("/medicines")
def add_medicine(m: Medicine, u=Depends(me)) -> Medicine:
    require_doctor_or_family(u, m.patient_id)
    if slot_taken(m.patient_id, m.slot):
        raise HTTPException(409, f"slot {m.slot} already has a medicine")
    row = q1("INSERT INTO medicines (patient_id, name, dose, times, slot, pills_left, expiration, color)"
             " VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *",
             m.patient_id, m.name, m.dose, m.times, m.slot, m.pills_left, m.expiration, m.color)
    return Medicine(**row)


@app.patch("/medicines/{medicine_id}")
def update_medicine(medicine_id: int, change: MedicineUpdate, u=Depends(me)) -> Medicine:
    """Edit or refill (pills_left). Only the patient's doctor."""
    m = get_medicine(medicine_id)
    require_doctor_of(u, m.patient_id)
    fields = change.model_dump(exclude_unset=True, exclude_none=True)
    if fields.get("slot", m.slot) != m.slot and slot_taken(m.patient_id, fields["slot"]):
        raise HTTPException(409, f"slot {fields['slot']} already has a medicine")
    m = m.model_copy(update=fields)
    row = q1("UPDATE medicines SET name = %s, dose = %s, times = %s, slot = %s, pills_left = %s, expiration = %s,"
             " color = %s WHERE id = %s RETURNING *",
             m.name, m.dose, m.times, m.slot, m.pills_left, m.expiration, m.color, m.id)
    return Medicine(**row)


@app.delete("/medicines/{medicine_id}")
def delete_medicine(medicine_id: int, u=Depends(me)):
    m = get_medicine(medicine_id)
    require_doctor_of(u, m.patient_id)
    dose_ids = {r["id"] for r in q("SELECT id FROM doses WHERE medicine_id = %s", m.id)}
    q("DELETE FROM medicines WHERE id = %s", m.id)  # its doses go with it (ON DELETE CASCADE)
    for d in dose_ids:
        drop_door_commands(m.patient_id, d)
    # cabinet screen back to idle if it was showing one of these doses
    q("DELETE FROM cabinet_state WHERE patient_id = %s AND (state->>'dose_id')::int = ANY(%s)",
      m.patient_id, list(dose_ids))
    return {"ok": True}


@app.post("/doses/{dose_id}/taken")
def dose_taken(dose_id: int, u=Depends(me)) -> DoseLog:
    """The patient's phone: "I took it"."""
    dose = get_dose(dose_id)
    if get_medicine(dose.medicine_id).patient_id != u.id:
        raise HTTPException(403, "Only the patient can confirm a dose")
    return mark_taken(dose, "screen")


# --- Appointments ----------------------------------------------------------------
MAX_AHEAD_DAYS = 120  # the calendar shows about 3 months; nothing is opened or listed past this
APPOINTMENT_SQL = ("SELECT s.*, d.name AS doctor_name, p.name AS patient_name FROM appointment_slots s"
                   " JOIN users d ON d.id = s.doctor_id LEFT JOIN users p ON p.id = s.patient_id")


def get_appointment(slot_id: int) -> dict:
    row = q1(APPOINTMENT_SQL + " WHERE s.id = %s", slot_id)
    if not row:
        raise HTTPException(404, "That appointment time no longer exists")
    return row


def when(t: datetime) -> str:
    """'on Tue, Oct 28 at 9:30 AM'"""
    return f"on {t:%a, %b} {t.day} at {t.hour % 12 or 12}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'}"


def circle_of(patient_id: int) -> list[int]:
    """The patient and their family: who hears about the patient's appointments."""
    return [patient_id] + [r["id"] for r in q("SELECT id FROM users WHERE patient_id = %s", patient_id)]


def booking_patient(u, patient_id: Optional[int]) -> Patient:
    """The patient booking for themself, or family booking for their patient."""
    pid = patient_id or (u.id if u.role == "patient" else u.patient_id if u.role == "family" else None)
    if pid is None or not (u.id == pid or (u.role == "family" and u.patient_id == pid)):
        raise HTTPException(403, "Only the patient or their family can book or cancel")
    return get_patient(pid)


@app.get("/schedule")
def schedule(days: int = 92, u=Depends(me)) -> list[Appointment]:
    """Doctor: every slot of theirs from today on, open and booked. Patient/family: the patient's doctor's open
    future slots and the patient's own appointments, never other patients' bookings."""
    today = datetime.combine(date.today(), time.min)
    until = today + timedelta(days=max(1, min(days, MAX_AHEAD_DAYS)) + 1)
    if u.role == "doctor":
        rows = q(APPOINTMENT_SQL + " WHERE s.doctor_id = %s AND s.starts_at >= %s AND s.starts_at < %s"
                 " ORDER BY s.starts_at", u.id, today, until)
    else:
        p = get_patient(u.id if u.role == "patient" else u.patient_id)
        rows = q(APPOINTMENT_SQL + " WHERE s.doctor_id = %s AND s.starts_at < %s AND ((s.patient_id IS NULL"
                 " AND s.starts_at > %s) OR (s.patient_id = %s AND s.starts_at >= %s)) ORDER BY s.starts_at",
                 p.doctor_id, until, datetime.now(), p.id, today)
    return [Appointment(**r) for r in rows]


@app.post("/availability")
def add_availability(a: Availability, u=Depends(me)):
    """Doctor opens times from start to end, one every `minutes`, on `day` and, with repeat_weeks, the same
    weekday for that many weeks after. Skips past times, days past MAX_AHEAD_DAYS, and times that overlap one
    already in the schedule. Returns {added: [Appointment], skipped: n}."""
    if u.role != "doctor":
        raise HTTPException(403, "Only doctors set availability")
    start, end = (datetime.combine(a.day, time.fromisoformat(t)) for t in (a.start, a.end))
    if end <= start:
        raise HTTPException(400, "The end time must be after the start time")
    if a.day > date.today() + timedelta(days=MAX_AHEAD_DAYS):
        raise HTTPException(400, f"Open times at most {MAX_AHEAD_DAYS} days ahead")
    step, now = timedelta(minutes=a.minutes), datetime.now()
    per_day = [start + i * step for i in range(int((end - start) / step))]
    if not per_day:
        raise HTTPException(400, f"No {a.minutes}-minute appointment fits between {a.start} and {a.end}")
    if len(per_day) > 48:
        raise HTTPException(400, "That is more than 48 appointments in a day; pick a shorter range")
    last_day = datetime.combine(date.today() + timedelta(days=MAX_AHEAD_DAYS + 1), time.min)
    starts = [t + timedelta(weeks=w) for w in range(a.repeat_weeks + 1) for t in per_day]
    wanted = [t for t in starts if now < t < last_day]
    # one statement for all of them (12 weeks can be hundreds of times): skip any that overlap an existing time
    rows = q("INSERT INTO appointment_slots (doctor_id, starts_at, minutes)"
             " SELECT %s, t, %s FROM unnest(%s::timestamp[]) AS t WHERE NOT EXISTS (SELECT 1 FROM appointment_slots s"
             " WHERE s.doctor_id = %s AND s.starts_at < t + make_interval(mins => %s)"
             " AND s.starts_at + make_interval(mins => s.minutes) > t)"
             " ON CONFLICT (doctor_id, starts_at) DO NOTHING RETURNING id",
             u.id, a.minutes, wanted, u.id, a.minutes) if wanted else []
    ids = [r["id"] for r in rows]
    added = [Appointment(**r) for r in q(APPOINTMENT_SQL + " WHERE s.id = ANY(%s) ORDER BY s.starts_at", ids)]
    return {"added": added, "skipped": len(starts) - len(added)}


@app.post("/slots/{slot_id}/book")
def book(slot_id: int, b: Booking, u=Depends(me)) -> Appointment:
    p = booking_patient(u, b.patient_id)
    s = get_appointment(slot_id)
    if s["doctor_id"] != p.doctor_id:
        raise HTTPException(403, f"That time is with another doctor, not {p.name}'s")
    reason = (b.reason or "").strip() or None
    now = datetime.now()
    if not q1("UPDATE appointment_slots SET patient_id = %s, booked_by = %s, reason = %s, booked_at = %s"
              " WHERE id = %s AND patient_id IS NULL AND starts_at > %s RETURNING id",
              p.id, u.id, reason, now, slot_id, now):
        raise HTTPException(409, "Someone just booked that time, or it has passed. Please pick another one.")
    s = get_appointment(slot_id)
    push_users([p.doctor_id], "New appointment",
               f"{p.name} {when(s['starts_at'])}" + (f": {reason}" if reason else ""), {"slot_id": slot_id})
    push_users([i for i in circle_of(p.id) if i != u.id], "Appointment booked",
               f"{p.name} sees {s['doctor_name']} {when(s['starts_at'])}.", {"slot_id": slot_id})
    return Appointment(**s)


@app.post("/slots/{slot_id}/cancel")
def cancel_booking(slot_id: int, u=Depends(me)) -> Appointment:
    """Patient or family cancels; the time opens up again. (The doctor removes a time with DELETE.)"""
    s = get_appointment(slot_id)
    if s["patient_id"] is None:
        raise HTTPException(409, "That time is not booked")
    p = booking_patient(u, s["patient_id"])
    if s["starts_at"] <= datetime.now():
        raise HTTPException(409, "That visit has already started")
    if not q1("UPDATE appointment_slots SET patient_id = NULL, booked_by = NULL, reason = NULL, booked_at = NULL,"
              " reminded_at = NULL WHERE id = %s AND patient_id = %s RETURNING id", slot_id, p.id):
        raise HTTPException(409, "That appointment was already cancelled")
    push_users([p.doctor_id], "Appointment cancelled", f"{p.name} cancelled {when(s['starts_at'])}.",
               {"slot_id": slot_id})
    push_users([i for i in circle_of(p.id) if i != u.id], "Appointment cancelled",
               f"{p.name}'s visit with {s['doctor_name']} {when(s['starts_at'])} was cancelled.", {"slot_id": slot_id})
    return Appointment(**get_appointment(slot_id))


@app.delete("/slots/{slot_id}")
def remove_slot(slot_id: int, u=Depends(me)):
    """Doctor removes a time. If someone had booked it, the patient and family are told."""
    s = get_appointment(slot_id)
    if u.role != "doctor" or s["doctor_id"] != u.id:
        raise HTTPException(403, "Only the doctor can remove their own times")
    row = q1("DELETE FROM appointment_slots WHERE id = %s RETURNING patient_id", slot_id)  # who had it, right now
    if row and row["patient_id"]:
        push_users(circle_of(row["patient_id"]), "Appointment cancelled",
                   f"{s['doctor_name']} cancelled the visit {when(s['starts_at'])}. Please book another time.",
                   {"slot_id": slot_id})
    return {"ok": True}


# --- AI (wraps ai/; fake answers until those functions are ready) -----------
# sync defs so FastAPI runs the slow Gemini/ElevenLabs calls in a thread
@app.post("/ai/label")
def read_label(photo: UploadFile = File(...), u=Depends(me)):
    """Label photo (multipart, field "photo") -> Medicine draft fields. The web dashboard uses this."""
    return label_draft(photo.file.read(), u)


@app.post("/ai/label64")
def read_label_base64(body: LabelPhoto, u=Depends(me)):
    """Label photo as base64 JSON -> Medicine draft fields. The phone app uses this."""
    try:
        image = base64.b64decode(body.image.split(",")[-1], validate=True)
    except ValueError:
        raise HTTPException(400, "image must be base64")
    return label_draft(image, u)


def label_draft(image: bytes, u) -> dict:
    """Doctors and family (they scan bottles from the phone app)."""
    if u.role not in ("doctor", "family"):
        raise HTTPException(403, "Doctors and family only")
    fake = {"name": "Aspirin", "dose": "1 pill", "times": ["08:00", "20:00"],
            "expiration": str(date.today() + timedelta(days=180)), "quantity": 30}
    # fake only while ai.read_label is unwritten. On a real failure, never return a made-up medicine
    # someone could save without noticing: error out with the reason, and the app/dashboard say "fill it in by hand".
    try:
        return ai.read_label(image)
    except NotImplementedError:
        return fake
    except Exception as e:
        print(f"[ai] read_label failed: {e!r}")
        raise HTTPException(502, f"label reader failed: {str(e)[:200]}")


@app.post("/ai/ask")
def ask(patient_id: int, audio: UploadFile = File(...)):
    """Cabinet: question audio -> answer text + MP3 url, answered from the dose log."""
    get_patient(patient_id)
    sorry = "Sorry, I can't answer right now. Please check the screen."
    start = perf_counter()
    # no transcript (Ollama down, model not pulled, audio not WAV): say sorry, never answer a question nobody asked
    question = try_ai(ai.transcribe, audio.file.read(), fallback=None)
    heard = perf_counter()
    meds = [m.model_dump(mode="json") for m in medicines_of(patient_id)]  # schedule, box, pills left
    text = sorry if question is None else try_ai(ai.answer, question, dose_log(patient_id), meds, fallback=sorry)
    answered = perf_counter()
    audio_url = speech_url(text)
    # where a slow answer's time went (the steps run one after another)
    print(f"[ask] heard {question!r}: transcribe {heard - start:.1f} s, answer {answered - heard:.1f} s,"
          f" voice {perf_counter() - answered:.1f} s")
    # not saved for the screen here: the Pi posts it to /cabinet/{id}/answer as the cabinet starts saying it
    return {"text": text, "audio_url": audio_url}


# --- FDA drug labels for the doctor (DailyMed in Tiger, see labels.py) ----------
DAILYMED_PAGE = "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid={}"


@app.post("/ai/drugs")
def drug_question(question: str = Body(..., embed=True), patient_id: Optional[int] = Body(None, embed=True), u=Depends(me)):
    """Doctor: a question about interactions or side effects -> answer from FDA label passages, with the passages.
    With patient_id, searches the labels of that patient's medicines plus any drug the question names."""
    if u.role != "doctor":
        raise HTTPException(403, "Doctors only")
    meds = []
    if patient_id is not None:
        require_doctor_of(u, patient_id)
        meds = [m.name for m in medicines_of(patient_id)]
    loaded = labels.all_labels()
    if not loaded:
        raise HTTPException(503, "No FDA labels loaded yet: run python -m backend.labels ingest")
    scope = {l["id"]: l for text in meds + [question] for l in labels.labels_named(text, loaded)}
    passages = labels.passages_for(question, list(scope.values()))
    start = perf_counter()
    text = try_ai(ai.answer_from_labels, question, passages, meds, fallback=ai.LABELS_DONT_SAY,
                  on_error="The local AI isn't reachable right now. The closest label passages are below.")
    print(f"[drugs] {question!r}: {len(passages)} passages from {sorted(l['drug'] for l in scope.values()) or 'all labels'},"
          f" answer {perf_counter() - start:.1f} s")
    # label sentences naming a drug from the question together with another one in scope: shown as they are,
    # whatever the model wrote (Gemma answered "is it indicated" and left out clarithromycin's metformin warning)
    warnings = [{"n": i, "drug": p["drug"], "section": p["section"], "sentence": p["content"]}
                for i, p in enumerate(passages, 1) if p.get("interaction")]
    return {"answer": text, "warnings": warnings, "medicines": meds, "searched": sorted(l["drug"] for l in scope.values()),
            "sources": [{"n": i, "drug": p["drug"], "label": p["label"], "section": p["section_title"],
                         "version": p["version"], "effective": p["effective"], "text": p["content"],
                         "url": DAILYMED_PAGE.format(p["setid"])} for i, p in enumerate(passages, 1)]}


@app.get("/patients/{patient_id}/interactions")
def patient_interactions(patient_id: int, add: Optional[str] = None, u=Depends(me)):
    """Doctor: every pair of the patient's medicines (plus `add`, a drug being considered): what each FDA label
    says about the other, and known pathways. No model: quoted label sentences and a fixed table."""
    require_doctor_of(u, patient_id)
    result = labels.check([m.name for m in medicines_of(patient_id)] + ([add] if add and add.strip() else []))
    for pair in result["pairs"]:
        for said in pair["label_says"]:
            said["url"] = DAILYMED_PAGE.format(said.pop("setid"))
    return result


# --- Cabinet (login-free: the Pi and its touchscreen) ---------------------------
@app.get("/cabinet/{patient_id}/command")
def cabinet_command(patient_id: int):
    """Pi only. Each command is handed out once (SKIP LOCKED: two backends can't hand out the same one)."""
    # a screen "ask" the Pi didn't pick up in time would start recording out of the blue later: drop it
    q("DELETE FROM cabinet_commands WHERE patient_id = %s AND cmd ? 'ask' AND (cmd->>'at')::timestamp < %s",
      patient_id, datetime.now() - ASK_FRESH)
    row = q1("DELETE FROM cabinet_commands WHERE id = (SELECT id FROM cabinet_commands WHERE patient_id = %s"
             " ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING cmd", patient_id)
    return row["cmd"] if row else {}


ASK_FRESH = timedelta(seconds=30)  # a screen tap the Pi hasn't picked up by then is dropped


@app.post("/cabinet/{patient_id}/ask")
def cabinet_ask(patient_id: int):
    """Cabinet screen's "Ask a question" when its browser has no mic (the Pi kiosk: the mic is on the
    ESP32). Queues an "ask" for the Pi, which speaks the prompt, records, calls /ai/ask and plays the
    answer. The screen then polls /answer for one newer than the returned "at"."""
    get_patient(patient_id)
    now = datetime.now()
    q("DELETE FROM cabinet_commands WHERE patient_id = %s AND cmd ? 'ask'", patient_id)  # one at a time
    push_command(patient_id, {"ask": True, "at": now.isoformat()})
    return {"at": now.isoformat()}


@app.get("/cabinet/{patient_id}/answer")
def cabinet_answer(patient_id: int):
    """Cabinet screen: the last voice answer, {"text", "at"}, or {} if none yet."""
    row = q1("SELECT text, at FROM cabinet_answer WHERE patient_id = %s", patient_id)
    return {"text": row["text"], "at": row["at"].isoformat()} if row else {}


@app.post("/cabinet/{patient_id}/answer")
def cabinet_answer_spoken(patient_id: int, text: str = Body(..., embed=True)):
    """Pi: the cabinet is starting to say this answer now (its audio is on the ESP32). Saved here rather
    than in /ai/ask, which is ~2 s earlier (download, convert, USB), so the screen shows it as it's heard."""
    get_patient(patient_id)
    q("INSERT INTO cabinet_answer (patient_id, text, at) VALUES (%s, %s, %s)"
      " ON CONFLICT (patient_id) DO UPDATE SET text = EXCLUDED.text, at = EXCLUDED.at",
      patient_id, text, datetime.now())
    return {"ok": True}


@app.get("/cabinet/{patient_id}/state")
def cabinet_state(patient_id: int):
    """Cabinet screen only. Read-only, safe to poll."""
    row = q1("SELECT state FROM cabinet_state WHERE patient_id = %s", patient_id)
    return row["state"] if row else idle_state()


@app.get("/cabinet/{patient_id}/today")
def cabinet_today(patient_id: int):
    """Cabinet screen: whose cabinet, the boxes and the dose log."""
    p = get_patient(patient_id)
    return {"name": p.name, "medicines": medicines_of(p.id), "doses": doses_of(p.id)}


@app.post("/cabinet/{patient_id}/taken")
def cabinet_taken(patient_id: int, dose_id: int) -> DoseLog:
    """Cabinet screen: "I took it"."""
    dose = get_dose(dose_id)
    if get_medicine(dose.medicine_id).patient_id != patient_id:
        raise HTTPException(404, f"dose {dose_id} is not in this cabinet")
    return mark_taken(dose, "screen")


@app.post("/cabinet/{patient_id}/photo")
def cabinet_photo(patient_id: int, dose_id: int, phase: Literal["before", "after"],
                  photo: UploadFile = File(...)):
    """Pi sends before/after slot photos; after the 'after' photo we decide taken."""
    dose = get_dose(dose_id)
    m = get_medicine(dose.medicine_id)
    row = q1("SELECT count FROM photo_counts WHERE dose_id = %s AND phase = 'before'", dose_id)
    before = row["count"] if row else None
    # fake count until ai.count_pills is ready: pretend one pill was removed
    fake = m.pills_left if phase == "before" or before is None else before - 1
    # real count failed -> None: don't guess, the patient taps "I took it" instead
    count = try_ai(ai.count_pills, photo.file.read(), fallback=fake, on_error=None)
    q("INSERT INTO photo_counts (dose_id, phase, count) VALUES (%s, %s, %s)"
      " ON CONFLICT (dose_id, phase) DO UPDATE SET count = EXCLUDED.count", dose_id, phase, count)
    if phase == "after" and before is not None and count is not None and before - count == 1:
        mark_taken(dose, "camera")
    return {"count": count}


# --- Demo controls (login-free so the Pi team can curl them) --------------------
@app.post("/demo/pill_time")
def demo_pill_time(medicine_id: int) -> DoseLog:
    """Start a dose right now instead of waiting for its scheduled time."""
    dose = start_dose(get_medicine(medicine_id), datetime.now())
    if dose is None:
        raise HTTPException(409, "That dose already started")
    return dose


@app.post("/demo/reset")
def demo_reset():
    """Reload the demo people. Logs everyone out."""
    seed()
    return {"ok": True}


app.mount("/audio", StaticFiles(directory=AUDIO_DIR), name="audio")
# web/ is a separate Next.js app (port 3000) that proxies /api/* here; never serve it from this server.
