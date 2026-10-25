# ThuocTracker

Smart pill cabinet (Raspberry Pi 5) + doctor web dashboard + family push alerts. HackPSU Fall 2026 hackathon project; Devpost due 12:00 PM Sunday. See README.md for the overview.

## Hard rules

- **All project code must be written at HackPSU**, not before. Skeleton stubs only until the event.
- **The AI never changes a dose.** It reminds and alerts only. Voice answers come from the real dose log, never invented.
- **No AI on the Pi** (1GB RAM). The Pi takes photos/recordings and sends them to the backend; the backend calls Gemini and ElevenLabs.
- **Only the backend talks to the DB and sends push notifications.** Cabinet, screens and AI go through the API.
- **Auth:** app and dashboard routes need `Authorization: Bearer <token>` from `/login` or `/signup`; cabinet routes (Pi + touchscreen) and `/demo/*` are login-free. Several backends may share one Tiger database: only the `scheduler_lease` holder runs the scheduler, and all shared state (Pi commands, cabinet state, photo counts, alerts sent) is in the DB, never in process memory.
- Demo network is a 2.4 GHz phone hotspot, never campus WiFi.

## Team sync (read this first)

The team coordinates through the repo, not the group chat. Who owns what and the API contract are in `TEAM.md`.

- **Before starting work:** `git pull`, then read the `## Status` section at the top of `TEAM.md`. It says what is ready, what changed, and what each person is blocked on.
- **After pushing something another person uses** (a route, a JSON shape, a field in `models.py`, an `ai/` function, a page): add one line at the top of `## Status` (newest first): `- HH:MM <name> (<area>): <what changed / what is now ready / what the reader must do>`.
- Only edit files in your own folder (see `TEAM.md`). If you need something from someone else's folder, add a `NEED:` line to Status naming them instead of editing their files.
- Never change a route or JSON shape in the contract silently: update the contract in `TEAM.md` and add a Status line in the same commit.

## Layout

- `backend/main.py`: FastAPI routes (contract in TEAM.md; in-memory data, fake AI answers until `ai/` is ready). `backend/models.py`: the shared data contract (Patient, Doctor, Medicine, DoseLog, Alert). Change names there first, then tell the team.
- `ai/__init__.py`: pure functions: `read_label`, `count_pills`, `transcribe`, `answer`, `speak`. Backend routes wrap them.
- `pi/main.py`: polls `GET /cabinet/{id}/command`, drives servos/camera/mic/speaker.
- `web/`: Next.js 16 app (see `web/AGENTS.md`: read `web/node_modules/next/dist/docs/` before using Next APIs). `/doctor` is the dashboard, `/cabinet?patient=1` is the Pi touchscreen (kiosk mode). Pages are client components that poll `/api/*`, which `web/next.config.ts` proxies to the backend. Types that mirror `models.py` are in `web/lib/api.ts`: change them when the contract changes. Plain CSS, tokens in `web/app/globals.css`. Run with `cd web && npm run dev` (port 3000, bound to 0.0.0.0).
- `app/`: Expo (React Native) mobile app for patient, family and doctor: status, alerts, per-patient chat, push. Plain JS, no router; screens in `app/src/`. Install packages with `npx expo install`, not npm.

## Rules the backend owns

- Pill time: remind (screen flash + "Time for your pill"), repeat every 10 min, push to the patient's phone and the family's (many patients don't use a phone).
- No pill removed after 30 min (30 s in demo) -> `missed`, push to family and doctor, plus an inform-only push to the patient (never "take it now"). Screen tap "I took it" counts as taken.
- `pills_left < 5` -> `low_pills` alert to doctor and family.
- Expiration within 7 days -> `expiring_soon` alert to family and doctor.
- Same dose opened twice -> screen warning "You already took this one."
- Taken = camera count before minus after is exactly 1.
- Appointments: the doctor opens times; the patient or their family books (one conditional UPDATE, never two bookings for one time); patients never see others' bookings; "Appointment soon" push to patient + family 1 h before.

## Commands

```bash
.venv/bin/python -m uvicorn backend.main:app --reload --host 0.0.0.0   # backend :8000, from repo root (Windows: .venv\Scripts\python)
cd web && npm run dev                                                  # dashboard + cabinet :3000
cd app && npx expo start                                               # mobile app, open in Expo Go
```

Full setup and troubleshooting: README.md "Run".

Secrets live in `.env` (see `.env.example`); never commit it.

## Fallbacks (keep working in the demo)

Servo broken: screen shows the slot, patient opens by hand. Camera count fails: "I took it" tap. ElevenLabs/WiFi down: Pi plays 4 stored sounds. Pi audio fails: ESP32 speaker + laptop mic.
