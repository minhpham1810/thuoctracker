"""Backend API. Every other part reads/writes through here.

Run: uvicorn backend.main:app --reload --host 0.0.0.0   (from repo root)

Routes and response shapes follow the contract in TEAM.md. Data is in memory and
seeded with sample patients; the AI routes return fake answers until ai/ is ready.
"""
import asyncio
import os
from contextlib import asynccontextmanager
from datetime import date, datetime, time, timedelta
from typing import Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles

from .models import Alert, Doctor, DoseLog, Medicine, Patient
from .sms import send_sms

load_dotenv()
DEMO = os.environ.get("DEMO") == "1"  # shortened times so judges see it live
MISSED_AFTER = timedelta(seconds=30) if DEMO else timedelta(minutes=30)
REMIND_EVERY = timedelta(seconds=10) if DEMO else timedelta(minutes=10)
TICK_SECONDS = 2


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(scheduler())
    yield
    task.cancel()


app = FastAPI(title="ThuocTracker", lifespan=lifespan)

# shortcut: in-memory store, swap for SQLite if we need data to survive restarts
db: dict = {}


def seed():
    today = date.today()
    now = datetime.now()
    db.clear()
    db.update(
        doctors=[Doctor(id=1, name="Dr. Nguyen")],
        patients=[
            Patient(id=1, name="Grandma Lan", age=78, doctor_id=1,
                    phone="+15550000001", family_phone="+15550000002"),
            Patient(id=2, name="Mr. Tran", age=82, doctor_id=1,
                    phone="+15550000003", family_phone="+15550000004"),
        ],
        medicines=[
            Medicine(id=1, patient_id=1, name="Aspirin", dose="1 pill", times=["08:00", "20:00"],
                     slot=1, pills_left=10, expiration=today + timedelta(days=90), color="blue"),
            Medicine(id=2, patient_id=1, name="Metformin", dose="1 pill", times=["12:00"],
                     slot=2, pills_left=4, expiration=today + timedelta(days=5), color="red"),
            Medicine(id=3, patient_id=2, name="Lisinopril", dose="1 pill", times=["09:00"],
                     slot=1, pills_left=20, expiration=today + timedelta(days=200), color="yellow"),
        ],
        doses=[
            DoseLog(id=1, medicine_id=1, due_at=now - timedelta(hours=12),
                    taken_at=now - timedelta(hours=12, minutes=-3), status="taken", method="camera"),
            DoseLog(id=2, medicine_id=2, due_at=now - timedelta(hours=24), status="missed"),
        ],
        alerts=[
            Alert(id=1, type="missed", to="family", patient_id=1,
                  message="Grandma Lan missed Metformin (12:00).", at=now - timedelta(hours=23)),
            Alert(id=2, type="low_pills", to="doctor", patient_id=1,
                  message="Grandma Lan has 4 Metformin left. Refill needed.", at=now - timedelta(hours=1)),
        ],
        commands={},  # patient_id -> list of pending Pi commands
        state={},     # patient_id -> what the cabinet screen shows
        counts={},    # dose_id -> {"before": n, "after": n}
        reminded={},  # dose_id -> last reminder time
        sent={("low_pills", 2)},  # (alert type, medicine_id) already alerted; seed alert above
        last_tick=now,
    )


seed()


def next_id(table: str) -> int:
    return max((row.id for row in db[table]), default=0) + 1


def find(table: str, id: int):
    for row in db[table]:
        if row.id == id:
            return row
    raise HTTPException(404, f"{table[:-1]} {id} not found")


def idle_state() -> dict:
    return {"mode": "idle", "dose_id": None, "slot": None, "medicine": None,
            "color": None, "message": "ThuocTracker"}


def set_state(patient_id: int, mode: str, dose: DoseLog, message: str):
    m = find("medicines", dose.medicine_id)
    db["state"][patient_id] = {"mode": mode, "dose_id": dose.id, "slot": m.slot,
                               "medicine": m.name, "color": m.color, "message": message}


def mark_taken(dose: DoseLog, method: Literal["camera", "screen"]):
    m = find("medicines", dose.medicine_id)
    if dose.status == "taken":
        set_state(m.patient_id, "already_took", dose, "You already took this one.")
        return
    dose.status, dose.taken_at, dose.method = "taken", datetime.now(), method
    m.pills_left = max(m.pills_left - 1, 0)
    set_state(m.patient_id, "taken", dose, "Good job!")


def push_command(patient_id: int, cmd: dict):
    db["commands"].setdefault(patient_id, []).append(cmd)


def add_alert(type: str, to: Literal["doctor", "family"], p: Patient, message: str):
    db["alerts"].append(Alert(id=next_id("alerts"), type=type, to=to, patient_id=p.id,
                              message=message, at=datetime.now()))
    phone = p.family_phone if to == "family" else find("doctors", p.doctor_id).phone
    if phone:
        send_sms(phone, message)


def remind(dose: DoseLog, m: Medicine):
    db["reminded"][dose.id] = datetime.now()
    push_command(m.patient_id, {"dose_id": dose.id, "open_slot": m.slot, "say_url": None,
                                "sound": "time_for_pill"})
    set_state(m.patient_id, "take", dose, f"Take your {m.color} pill now ({m.name})")


def start_dose(m: Medicine, due_at: datetime) -> DoseLog:
    dose = DoseLog(id=next_id("doses"), medicine_id=m.id, due_at=due_at)
    db["doses"].append(dose)
    remind(dose, m)
    send_sms(find("patients", m.patient_id).phone, f"Time for your {m.color} pill ({m.name}).")
    return dose


def tick():
    """One scheduler pass: start due doses, remind, mark missed, low/expiring alerts."""
    now = datetime.now()
    last, db["last_tick"] = db["last_tick"], now
    for m in list(db["medicines"]):
        p = find("patients", m.patient_id)
        for t in m.times:
            due = datetime.combine(now.date(), time.fromisoformat(t))
            if last < due <= now:
                start_dose(m, due)
        low = ("low_pills", m.id)
        if m.pills_left < 5 and low not in db["sent"]:
            db["sent"].add(low)
            add_alert("low_pills", "doctor", p, f"{p.name} has {m.pills_left} {m.name} left. Refill needed.")
            add_alert("low_pills", "family", p, f"{p.name} has only {m.pills_left} {m.name} left.")
        elif m.pills_left >= 5:
            db["sent"].discard(low)  # refilled; alert again next time it runs low
        expiring = ("expiring_soon", m.id)
        if m.expiration - now.date() <= timedelta(days=7) and expiring not in db["sent"]:
            db["sent"].add(expiring)
            add_alert("expiring_soon", "family", p, f"{p.name}'s {m.name} expires on {m.expiration}.")
    for d in db["doses"]:
        if d.status != "pending":
            continue
        m = find("medicines", d.medicine_id)
        if now - d.due_at >= MISSED_AFTER:
            d.status = "missed"
            p = find("patients", m.patient_id)
            set_state(p.id, "missed", d, "You missed your pill.")
            push_command(p.id, {"dose_id": d.id, "say_url": None, "sound": "missed"})
            add_alert("missed", "family", p, f"{p.name} missed {m.name} ({d.due_at:%H:%M}).")
        elif now - db["reminded"].get(d.id, d.due_at) >= REMIND_EVERY:
            remind(d, m)


async def scheduler():
    while True:
        try:
            await asyncio.to_thread(tick)  # to_thread: Twilio calls block
        except Exception as e:
            print(f"[scheduler] {e!r}")
        await asyncio.sleep(TICK_SECONDS)


@app.get("/health")
def health():
    return {"ok": True}


# --- Data + doctor dashboard -------------------------------------------------
@app.get("/patients")
def list_patients(doctor_id: Optional[int] = None) -> list[Patient]:
    return [p for p in db["patients"] if doctor_id is None or p.doctor_id == doctor_id]


@app.post("/patients")
def add_patient(p: Patient) -> Patient:
    p.id = next_id("patients")
    db["patients"].append(p)
    return p


@app.get("/patients/{patient_id}/medicines")
def patient_medicines(patient_id: int) -> list[Medicine]:
    return [m for m in db["medicines"] if m.patient_id == patient_id]


@app.post("/medicines")
def add_medicine(m: Medicine) -> Medicine:
    find("patients", m.patient_id)
    if any(x.patient_id == m.patient_id and x.slot == m.slot for x in db["medicines"]):
        raise HTTPException(409, f"slot {m.slot} already has a medicine")
    m.id = next_id("medicines")
    db["medicines"].append(m)
    return m


@app.get("/patients/{patient_id}/doses")
def patient_doses(patient_id: int) -> list[DoseLog]:
    meds = {m.id for m in patient_medicines(patient_id)}
    return sorted((d for d in db["doses"] if d.medicine_id in meds),
                  key=lambda d: d.due_at, reverse=True)


@app.post("/doses/{dose_id}/taken")
def dose_taken(dose_id: int, method: Literal["camera", "screen"] = "screen") -> DoseLog:
    dose = find("doses", dose_id)
    mark_taken(dose, method)
    return dose


@app.get("/alerts")
def list_alerts(since: Optional[datetime] = None) -> list[Alert]:
    return [a for a in db["alerts"] if since is None or a.at > since]


# --- AI (wraps ai/; fake answers until those functions are ready) -----------
@app.post("/ai/label")
async def read_label(photo: UploadFile = File(...)):
    """Label photo -> Medicine draft fields."""
    return {"name": "Aspirin", "dose": "1 pill", "times": ["08:00", "20:00"],
            "expiration": str(date.today() + timedelta(days=180))}


@app.post("/ai/ask")
async def ask(patient_id: int, audio: UploadFile = File(...)):
    """Question audio -> answer text + MP3 url, answered from the dose log."""
    return {"text": "Yes, you took your Aspirin this morning.", "audio_url": None}


# --- Cabinet -----------------------------------------------------------------
@app.get("/cabinet/{patient_id}/command")
def cabinet_command(patient_id: int):
    """Pi only. Each command is handed out once."""
    queue = db["commands"].get(patient_id, [])
    return queue.pop(0) if queue else {}


@app.get("/cabinet/{patient_id}/state")
def cabinet_state(patient_id: int):
    """Cabinet screen only. Read-only, safe to poll."""
    return db["state"].get(patient_id, idle_state())


@app.post("/cabinet/{patient_id}/photo")
async def cabinet_photo(patient_id: int, dose_id: int, phase: Literal["before", "after"],
                        photo: UploadFile = File(...)):
    """Pi sends before/after slot photos; after the 'after' photo we decide taken."""
    dose = find("doses", dose_id)
    m = find("medicines", dose.medicine_id)
    counts = db["counts"].setdefault(dose_id, {})
    # fake count until ai.count_pills is ready: pretend one pill was removed
    counts[phase] = m.pills_left if phase == "before" else counts.get("before", m.pills_left) - 1
    if phase == "after" and counts.get("before", 0) - counts["after"] == 1:
        mark_taken(dose, "camera")
    return {"count": counts[phase]}


# --- Demo controls -------------------------------------------------------------
@app.post("/demo/pill_time")
def demo_pill_time(medicine_id: int) -> DoseLog:
    """Start a dose right now instead of waiting for its scheduled time."""
    return start_dose(find("medicines", medicine_id), datetime.now())


@app.post("/demo/reset")
def demo_reset():
    seed()
    return {"ok": True}


# Apps owner's pages: /doctor and /cabinet. Mounted last so API routes win.
app.mount("/", StaticFiles(directory="web", html=True), name="web")
