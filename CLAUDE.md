# ThuocTracker

Smart pill cabinet (Raspberry Pi 5) + doctor web dashboard + family SMS alerts. HackPSU Fall 2026 hackathon project; Devpost due 12:00 PM Sunday. See README.md for the overview.

## Hard rules

- **All project code must be written at HackPSU**, not before. Skeleton stubs only until the event.
- **The AI never changes a dose.** It reminds and alerts only. Voice answers come from the real dose log, never invented.
- **No AI on the Pi** (1GB RAM). The Pi takes photos/recordings and sends them to the backend; the backend calls Gemini and ElevenLabs.
- **Only the backend talks to the DB and sends SMS.** Cabinet, screens and AI go through the API.
- Demo network is a 2.4 GHz phone hotspot, never campus WiFi.

## Layout

- `backend/main.py`: FastAPI routes (stubs return 501). `backend/models.py`: the shared data contract (Patient, Doctor, Medicine, DoseLog, Alert). Change names there first, then tell the team.
- `ai/__init__.py`: pure functions: `read_label`, `count_pills`, `transcribe`, `answer`, `speak`. Backend routes wrap them.
- `pi/main.py`: polls `GET /cabinet/{id}/command`, drives servos/camera/mic/speaker.
- `web/doctor`, `web/cabinet`: static pages served by the backend. The cabinet page runs full-screen on the Pi touchscreen.

## Rules the backend owns

- Pill time: remind (screen flash + "Time for your pill"), repeat every 10 min, SMS the patient.
- No pill removed after 30 min (30 s in demo) -> `missed`, SMS family. Screen tap "I took it" counts as taken.
- `pills_left < 5` -> `low_pills` alert to doctor and family.
- Expiration within 7 days -> `expiring_soon` alert to family.
- Same dose opened twice -> screen warning "You already took this one."
- Taken = camera count before minus after is exactly 1.

## Commands

```bash
source .venv/bin/activate
uvicorn backend.main:app --reload --host 0.0.0.0   # from repo root
```

Secrets live in `.env` (see `.env.example`); never commit it.

## Fallbacks (keep working in the demo)

Servo broken: screen shows the slot, patient opens by hand. Camera count fails: "I took it" tap. ElevenLabs/WiFi down: Pi plays 4 stored sounds. Pi audio fails: ESP32 speaker + laptop mic.
