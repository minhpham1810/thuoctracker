"""Backend API. Every other part reads/writes through here.

Run: uvicorn backend.main:app --reload --host 0.0.0.0   (from repo root)
"""
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles

from .models import Alert, DoseLog, Medicine, Patient

app = FastAPI(title="ThuocTracker")

# shortcut: in-memory store, swap for SQLite if we need data to survive restarts
db: dict[str, list] = {"patients": [], "medicines": [], "doses": [], "alerts": []}


def todo():
    raise HTTPException(501, "not implemented yet")


@app.get("/health")
def health():
    return {"ok": True}


# --- Backend owner ---------------------------------------------------------
@app.post("/patients")
def add_patient(p: Patient):
    todo()


@app.get("/patients")
def list_patients():
    todo()


@app.post("/medicines")
def add_medicine(m: Medicine):
    todo()


@app.get("/patients/{patient_id}/medicines")
def patient_medicines(patient_id: int):
    todo()


@app.post("/doses")
def log_dose(d: DoseLog):
    """Record taken/missed. Must warn if the same dose was already taken."""
    todo()


@app.get("/patients/{patient_id}/doses")
def patient_doses(patient_id: int):
    todo()


@app.get("/alerts")
def list_alerts() -> list[Alert]:
    todo()


# TODO scheduler: reminders every 10 min, missed after 30 min (30 s in demo),
# low (<5 pills), expiring (<7 days). Texts via Twilio.


# --- AI owner (calls into ai/) ----------------------------------------------
@app.post("/ai/label")
async def read_label(photo: UploadFile = File(...)):
    """Label photo -> Medicine fields."""
    todo()


@app.post("/ai/count")
async def count_pills(photo: UploadFile = File(...)):
    """Slot photo -> {"count": int}."""
    todo()


@app.post("/ai/ask")
async def ask(patient_id: int, audio: UploadFile = File(...)):
    """Question audio -> answer text + MP3 url, answered from the dose log."""
    todo()


# --- Cabinet (Pi) -----------------------------------------------------------
@app.get("/cabinet/{patient_id}/command")
def cabinet_command(patient_id: int):
    """Pi polls this: e.g. {"open_slot": 2, "say": "Time for your pill"} or {}."""
    todo()


# Apps owner's pages: /doctor and /cabinet. Mounted last so API routes win.
app.mount("/", StaticFiles(directory="web", html=True), name="web")
