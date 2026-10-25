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
from dotenv import load_dotenv
from fastapi import Body, Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from psycopg.types.json import Jsonb
from pydantic import TypeAdapter

import ai

from .db import SCHEMA, pool, q, q1
from .models import (Alert, AnyUser, Contact, Credentials, DoseLog, LabelPhoto, Medicine, MedicineUpdate, Message, Patient,
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
                  " cabinet_answer, photo_counts, alerts_sent RESTART IDENTITY CASCADE")
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


def say(patient_id: int, dose: DoseLog, text: str, sound: str, open_slot: Optional[int] = None):
    """Queue audio for the Pi; open_slot only when the door should open."""
    cmd = {"dose_id": dose.id, "say_url": speech_url(text), "sound": sound}
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


def remind(dose: DoseLog, m: Medicine):
    """Open the box and say it's pill time. Callers record doses.reminded_at."""
    if door_queued(m.patient_id, dose.id):  # Pi hasn't picked up the last one yet (door cycle > repeat time)
        return
    say(m.patient_id, dose, f"Time for your {m.color} pill, {m.name}.", "time_for_pill", open_slot=m.slot)
    set_state(m.patient_id, "take", dose, m, f"Take your {m.color} pill now ({m.name})")


def start_dose(m: Medicine, due_at: datetime) -> Optional[DoseLog]:
    """None if this dose already exists (another scheduler started it)."""
    row = q1("INSERT INTO doses (medicine_id, due_at, reminded_at) VALUES (%s, %s, %s)"
             " ON CONFLICT DO NOTHING RETURNING *", m.id, due_at, datetime.now())
    if not row:
        return None
    dose = DoseLog(**row)
    remind(dose, m)
    p = get_patient(m.patient_id)
    push_to("patient", p, "Pill time", f"Time for your {m.color} pill ({m.name}).")
    # many older patients don't use a phone: family gets it too so they can call or help
    push_to("family", p, "Pill time", f"Time for {p.name}'s {m.color} pill ({m.name}), slot {m.slot}.")
    return dose


def tick(last: datetime) -> datetime:
    """One scheduler pass: start doses due since `last`, remind, mark missed, low/expiring alerts.
    Every step is a conditional write, so two backends overlapping for a moment can't double-send."""
    now = datetime.now()
    patients = {r["id"]: Patient(**r) for r in q("SELECT * FROM users WHERE role = 'patient'")}
    meds = {m.id: m for m in all_medicines()}
    sent = {(r["kind"], r["medicine_id"]) for r in q("SELECT kind, medicine_id FROM alerts_sent")}
    for m in meds.values():
        p = patients[m.patient_id]
        for t in m.times:
            due = datetime.combine(now.date(), time.fromisoformat(t))
            if last < due <= now:
                start_dose(m, due)
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
    text = sorry if question is None else try_ai(ai.answer, question, dose_log(patient_id), fallback=sorry)
    answered = perf_counter()
    audio_url = speech_url(text)
    # where a slow answer's time went (the steps run one after another)
    print(f"[ask] heard {question!r}: transcribe {heard - start:.1f} s, answer {answered - heard:.1f} s,"
          f" voice {perf_counter() - answered:.1f} s")
    # not saved for the screen here: the Pi posts it to /cabinet/{id}/answer as the cabinet starts saying it
    return {"text": text, "audio_url": audio_url}


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
