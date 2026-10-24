"""Backend API. Every other part reads/writes through here.

Run: uvicorn backend.main:app --reload --host 0.0.0.0   (from repo root). Web pages: Next.js in web/ (port 3000).

Routes and response shapes follow the contract in TEAM.md. Data lives in Tiger Data (Postgres, see db.py),
seeded with sample users on first start; AI routes fall back to fake answers if ai/ fails.
"""
import asyncio
import hashlib
import os
from contextlib import asynccontextmanager
from datetime import date, datetime, time, timedelta
from typing import Literal, Optional

from dotenv import load_dotenv
from fastapi import Body, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import TypeAdapter

import ai

from .db import SCHEMA, pool, q, q1
from .models import Alert, AnyUser, Doctor, DoseLog, Medicine, Message, Patient, PushToken, Role
from .push import send_push

load_dotenv()
DEMO = os.environ.get("DEMO") == "1"  # shortened times so judges see it live
MISSED_AFTER = timedelta(seconds=30) if DEMO else timedelta(minutes=30)
REMIND_EVERY = timedelta(seconds=10) if DEMO else timedelta(minutes=10)
TICK_SECONDS = 2
AUDIO_DIR = "audio"  # MP3s from ai.speak(), served at /audio/
os.makedirs(AUDIO_DIR, exist_ok=True)

# Not in the DB on purpose: Pi command queue, cabinet screen state, photo counts, reminder times,
# alerts already sent. All of it is about the dose happening right now.
mem: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    q(SCHEMA)
    if q1("SELECT 1 FROM users LIMIT 1") is None:
        seed()
    else:
        # a restart (or --reload) must not re-send alerts for conditions that were already alerted
        today = date.today()
        meds = all_medicines()
        reset_mem({("low_pills", m.id) for m in meds if m.pills_left < 5}
                  | {("expiring_soon", m.id) for m in meds if m.expiration - today <= timedelta(days=7)})
    task = asyncio.create_task(scheduler())
    yield
    task.cancel()
    pool.close()  # else --reload waits 5 s on the pool's threads


app = FastAPI(title="ThuocTracker", lifespan=lifespan)
# the Expo app in a computer's browser (doctor) calls the API from another origin
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def reset_mem(sent: set):
    mem.clear()
    mem.update(
        commands={},  # patient_id -> list of pending Pi commands
        state={},     # patient_id -> what the cabinet screen shows
        counts={},    # dose_id -> {"before": n, "after": n}
        reminded={},  # dose_id -> last reminder time
        sent=sent,    # (alert type, medicine_id) already alerted
        last_tick=datetime.now(),
    )


def seed():
    """Wipe the DB and load the demo people. Log in with any of these emails."""
    today = date.today()
    now = datetime.now()
    with pool.connection() as c, c.transaction():
        c.execute("TRUNCATE users, medicines, doses, alerts, messages RESTART IDENTITY CASCADE")
        cur = c.cursor()
        # patients keep ids 1-3: the cabinet screen and the Pi use ?patient=1. Doctor first so FKs resolve.
        cur.executemany(
            "INSERT INTO users (id, email, name, role, age, doctor_id, patient_id) VALUES (%s, %s, %s, %s, %s, %s, %s)", [
                (4, "doctor@demo.com", "Dr. Nguyen", "doctor", None, None, None),
                (1, "lan@demo.com", "Grandma Lan", "patient", 78, 4, None),
                (2, "tran@demo.com", "Mr. Tran", "patient", 82, 4, None),
                (3, "hoa@demo.com", "Mrs. Hoa", "patient", 74, 4, None),
                (5, "minh@demo.com", "Minh (grandson)", "family", None, None, 1),
                (6, "anh@demo.com", "Anh (son)", "family", None, None, 2),
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
        cur.executemany("INSERT INTO messages (from_id, to_id, text, at) VALUES (%s, %s, %s, %s)", [
            (5, 4, "Dr. Nguyen, Grandma seems tired after the new Metformin.", now - timedelta(hours=3)),
            (4, 5, "Thanks for telling me. Let's talk at her visit on Friday.", now - timedelta(hours=2)),
        ])
    reset_mem({("low_pills", 2)})  # the seeded low_pills alert above


# --- Reads ---------------------------------------------------------------------
as_user = TypeAdapter(AnyUser).validate_python


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


def contacts(u) -> list:
    """People assigned to u: doctor -> their patients + those patients' families;
    patient -> their doctor + family; family -> their patient + that patient's doctor."""
    if u.role == "doctor":
        rows = q("SELECT * FROM users WHERE doctor_id = %s"
                 " OR patient_id IN (SELECT id FROM users WHERE doctor_id = %s) ORDER BY id", u.id, u.id)
    elif u.role == "patient":
        rows = q("SELECT * FROM users WHERE id = %s OR patient_id = %s ORDER BY id", u.doctor_id, u.id)
    else:
        rows = q("SELECT * FROM users WHERE id = %s OR id = (SELECT doctor_id FROM users WHERE id = %s)"
                 " ORDER BY id", u.patient_id, u.patient_id)
    return [as_user(r) for r in rows]


# --- Cabinet + alerts ----------------------------------------------------------
def idle_state() -> dict:
    return {"mode": "idle", "dose_id": None, "slot": None, "medicine": None,
            "color": None, "message": "ThuocTracker"}


def set_state(patient_id: int, mode: str, dose: DoseLog, m: Medicine, message: str):
    mem["state"][patient_id] = {"mode": mode, "dose_id": dose.id, "slot": m.slot,
                                "medicine": m.name, "color": m.color, "message": message}


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
    mem["commands"].setdefault(patient_id, []).append(cmd)


def door_queued(patient_id: int, dose_id: int) -> bool:
    return any(c["dose_id"] == dose_id and "open_slot" in c for c in mem["commands"].get(patient_id, []))


def drop_door_commands(patient_id: int, dose_id: int):
    """Dose is settled: queued reminders must not reopen the door."""
    queue = mem["commands"].get(patient_id, [])
    queue[:] = [c for c in queue if not (c["dose_id"] == dose_id and "open_slot" in c)]


def dose_log(patient_id: int) -> list[dict]:
    """Dose log in the shape ai.answer() expects (see TEAM.md)."""
    rows = q("SELECT m.name, d.due_at, d.status, d.taken_at FROM doses d JOIN medicines m ON m.id = d.medicine_id"
             " WHERE m.patient_id = %s ORDER BY d.due_at DESC", patient_id)
    return [{"medicine": r["name"], "due_at": r["due_at"].isoformat(), "status": r["status"],
             "taken_at": r["taken_at"].isoformat() if r["taken_at"] else None} for r in rows]


def push_users(user_ids: list[int], title: str, body: str, data: dict):
    tokens = [r["token"] for r in q("SELECT token FROM push_tokens WHERE user_id = ANY(%s) ORDER BY token", user_ids)]
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


def remind(dose: DoseLog, m: Medicine):
    mem["reminded"][dose.id] = datetime.now()
    if door_queued(m.patient_id, dose.id):  # Pi hasn't picked up the last one yet (door cycle > repeat time)
        return
    say(m.patient_id, dose, f"Time for your {m.color} pill, {m.name}.", "time_for_pill", open_slot=m.slot)
    set_state(m.patient_id, "take", dose, m, f"Take your {m.color} pill now ({m.name})")


def start_dose(m: Medicine, due_at: datetime) -> DoseLog:
    dose = DoseLog(**q1("INSERT INTO doses (medicine_id, due_at) VALUES (%s, %s) RETURNING *", m.id, due_at))
    remind(dose, m)
    push_to("patient", get_patient(m.patient_id), "Pill time", f"Time for your {m.color} pill ({m.name}).")
    return dose


def tick():
    """One scheduler pass: start due doses, remind, mark missed, low/expiring alerts."""
    now = datetime.now()
    last, mem["last_tick"] = mem["last_tick"], now
    patients = {p.id: p for p in list_patients()}
    meds = {m.id: m for m in all_medicines()}
    for m in meds.values():
        p = patients[m.patient_id]
        for t in m.times:
            due = datetime.combine(now.date(), time.fromisoformat(t))
            if last < due <= now:
                start_dose(m, due)
        low = ("low_pills", m.id)
        if m.pills_left < 5 and low not in mem["sent"]:
            mem["sent"].add(low)
            add_alert("low_pills", "doctor", p, f"{p.name} has {m.pills_left} {m.name} left. Refill needed.")
            add_alert("low_pills", "family", p, f"{p.name} has only {m.pills_left} {m.name} left.")
        elif m.pills_left >= 5:
            mem["sent"].discard(low)  # refilled; alert again next time it runs low
        expiring = ("expiring_soon", m.id)
        if m.expiration - now.date() <= timedelta(days=7) and expiring not in mem["sent"]:
            mem["sent"].add(expiring)
            add_alert("expiring_soon", "family", p, f"{p.name}'s {m.name} expires on {m.expiration}.")
            add_alert("expiring_soon", "doctor", p, f"{p.name}'s {m.name} expires on {m.expiration}.")
    for d in [DoseLog(**r) for r in q("SELECT * FROM doses WHERE status = 'pending'")]:
        m = meds[d.medicine_id]
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
        elif now - mem["reminded"].get(d.id, d.due_at) >= REMIND_EVERY:
            remind(d, m)


async def scheduler():
    while True:
        try:
            await asyncio.to_thread(tick)  # to_thread: DB and push calls block
        except Exception as e:
            print(f"[scheduler] {e!r}")
        await asyncio.sleep(TICK_SECONDS)


@app.get("/health")
def health():
    return {"ok": True}


# --- Accounts ------------------------------------------------------------------
@app.post("/login")
def login(email: str = Body(embed=True)) -> AnyUser:
    """Email only, no password (demo)."""
    row = q1("SELECT * FROM users WHERE lower(email) = lower(%s)", email.strip())
    if not row:
        raise HTTPException(404, "No account with that email")
    return as_user(row)


@app.get("/users/{user_id}/contacts")
def user_contacts(user_id: int) -> list[AnyUser]:
    return contacts(get_user(user_id))


# --- Data + doctor dashboard -------------------------------------------------
@app.get("/patients")
def list_patients(doctor_id: Optional[int] = None) -> list[Patient]:
    rows = q("SELECT * FROM users WHERE role = 'patient' AND (%s::int IS NULL OR doctor_id = %s) ORDER BY id",
             doctor_id, doctor_id)
    return [Patient(**r) for r in rows]


@app.post("/patients")
def add_patient(p: Patient) -> Patient:
    if get_user(p.doctor_id).role != "doctor":
        raise HTTPException(400, f"user {p.doctor_id} is not a doctor")
    if q1("SELECT 1 FROM users WHERE lower(email) = lower(%s)", p.email):
        raise HTTPException(409, f"{p.email} already has an account")
    row = q1("INSERT INTO users (email, name, role, age, doctor_id) VALUES (%s, %s, 'patient', %s, %s) RETURNING *",
             p.email.strip(), p.name, p.age, p.doctor_id)
    return Patient(**row)


@app.get("/patients/{patient_id}/medicines")
def patient_medicines(patient_id: int) -> list[Medicine]:
    return [Medicine(**r) for r in q("SELECT * FROM medicines WHERE patient_id = %s ORDER BY slot", patient_id)]


@app.post("/medicines")
def add_medicine(m: Medicine) -> Medicine:
    get_patient(m.patient_id)
    if q1("SELECT 1 FROM medicines WHERE patient_id = %s AND slot = %s", m.patient_id, m.slot):
        raise HTTPException(409, f"slot {m.slot} already has a medicine")
    row = q1("INSERT INTO medicines (patient_id, name, dose, times, slot, pills_left, expiration, color)"
             " VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *",
             m.patient_id, m.name, m.dose, m.times, m.slot, m.pills_left, m.expiration, m.color)
    return Medicine(**row)


@app.get("/patients/{patient_id}/doses")
def patient_doses(patient_id: int) -> list[DoseLog]:
    rows = q("SELECT d.* FROM doses d JOIN medicines m ON m.id = d.medicine_id"
             " WHERE m.patient_id = %s ORDER BY d.due_at DESC", patient_id)
    return [DoseLog(**r) for r in rows]


@app.post("/doses/{dose_id}/taken")
def dose_taken(dose_id: int, method: Literal["camera", "screen"] = "screen") -> DoseLog:
    return mark_taken(get_dose(dose_id), method)


@app.get("/alerts")
def list_alerts(since: Optional[datetime] = None) -> list[Alert]:
    rows = q('SELECT * FROM alerts WHERE %s::timestamp IS NULL OR at > %s ORDER BY id', since, since)
    return [Alert(**r) for r in rows]


@app.get("/doctors")
def list_doctors() -> list[Doctor]:
    return [Doctor(**r) for r in q("SELECT * FROM users WHERE role = 'doctor' ORDER BY id")]


# --- Mobile app: 1:1 chat + push ------------------------------------------------
@app.get("/users/{user_id}/messages")
def list_messages(user_id: int, with_id: Optional[int] = None, since: Optional[datetime] = None) -> list[Message]:
    """Messages to or from user_id (only with with_id if given), oldest first."""
    sql, args = "SELECT * FROM messages WHERE %s IN (from_id, to_id)", [user_id]
    if with_id is not None:
        sql += " AND %s IN (from_id, to_id)"
        args.append(with_id)
    if since is not None:
        sql += " AND at > %s"
        args.append(since)
    return [Message(**r) for r in q(sql + " ORDER BY at, id", *args)]


@app.post("/users/{user_id}/messages")
def send_message(user_id: int, msg: Message) -> Message:
    me = get_user(user_id)
    if msg.to_id not in {c.id for c in contacts(me)}:
        raise HTTPException(403, "You can only message people assigned to you")
    text = msg.text.strip()
    if not text:
        raise HTTPException(400, "Empty message")
    row = q1("INSERT INTO messages (from_id, to_id, text, at) VALUES (%s, %s, %s, %s) RETURNING *",
             me.id, msg.to_id, text, datetime.now())
    push_users([msg.to_id], me.name, text, {"from_id": me.id})
    return Message(**row)


@app.post("/push/register")
def register_push(t: PushToken):
    """The app sends its Expo push token after login. One phone = one user (re-login moves it)."""
    get_user(t.user_id)
    q("INSERT INTO push_tokens (token, user_id) VALUES (%s, %s)"
      " ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id", t.token, t.user_id)
    return {"ok": True}


# --- AI (wraps ai/; fake answers until those functions are ready) -----------
# sync defs so FastAPI runs the slow Gemini/ElevenLabs calls in a thread
@app.post("/ai/label")
def read_label(photo: UploadFile = File(...)):
    """Label photo -> Medicine draft fields."""
    fake = {"name": "Aspirin", "dose": "1 pill", "times": ["08:00", "20:00"],
            "expiration": str(date.today() + timedelta(days=180))}
    return try_ai(ai.read_label, photo.file.read(), fallback=fake)


@app.post("/ai/ask")
def ask(patient_id: int, audio: UploadFile = File(...)):
    """Question audio -> answer text + MP3 url, answered from the dose log."""
    get_patient(patient_id)
    question = try_ai(ai.transcribe, audio.file.read(), fallback="Did I take my pill today?")
    text = try_ai(ai.answer, question, dose_log(patient_id),
                  fallback="Sorry, I can't answer right now. Please check the screen.")
    return {"text": text, "audio_url": speech_url(text)}


# --- Cabinet -----------------------------------------------------------------
@app.get("/cabinet/{patient_id}/command")
def cabinet_command(patient_id: int):
    """Pi only. Each command is handed out once."""
    queue = mem["commands"].get(patient_id, [])
    return queue.pop(0) if queue else {}


@app.get("/cabinet/{patient_id}/state")
def cabinet_state(patient_id: int):
    """Cabinet screen only. Read-only, safe to poll."""
    return mem["state"].get(patient_id, idle_state())


@app.post("/cabinet/{patient_id}/photo")
def cabinet_photo(patient_id: int, dose_id: int, phase: Literal["before", "after"],
                  photo: UploadFile = File(...)):
    """Pi sends before/after slot photos; after the 'after' photo we decide taken."""
    dose = get_dose(dose_id)
    m = get_medicine(dose.medicine_id)
    counts = mem["counts"].setdefault(dose_id, {})
    # fake count until ai.count_pills is ready: pretend one pill was removed
    before = counts.get("before")
    fake = m.pills_left if phase == "before" or before is None else before - 1
    # real count failed -> None: don't guess, the patient taps "I took it" instead
    counts[phase] = try_ai(ai.count_pills, photo.file.read(), fallback=fake, on_error=None)
    before, after = counts.get("before"), counts.get("after")
    if phase == "after" and before is not None and after is not None and before - after == 1:
        mark_taken(dose, "camera")
    return {"count": counts[phase]}


# --- Demo controls -------------------------------------------------------------
@app.post("/demo/pill_time")
def demo_pill_time(medicine_id: int) -> DoseLog:
    """Start a dose right now instead of waiting for its scheduled time."""
    return start_dose(get_medicine(medicine_id), datetime.now())


@app.post("/demo/reset")
def demo_reset():
    seed()
    return {"ok": True}


app.mount("/audio", StaticFiles(directory=AUDIO_DIR), name="audio")
# web/ is a separate Next.js app (port 3000) that proxies /api/* here; never serve it from this server.
