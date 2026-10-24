# ThuocTracker

A smart medicine cabinet for elderly and Alzheimer's patients, connected to an app for their doctor.

> The doctor writes the prescription and never knows if it was taken. We close the loop.

Built at HackPSU Fall 2026.

## How it works

- **Cabinet** (Raspberry Pi 5): 3 servo-controlled slots, touchscreen, camera that checks whether a pill was really taken, mic + speaker you can talk to.
- **Doctor dashboard** (web): patients, taken/missed doses, pills left, live alerts.
- **Family alerts** (Expo push to the mobile app): missed dose, low pills, expiring soon.
- **AI**: Gemini reads medicine labels and counts pills from camera photos. Voice questions ("Did I take my pill today?") are answered from the real dose log and spoken with ElevenLabs.

## Architecture

Nothing talks directly to anything else. The cabinet, screens, phones and AI all go through the backend, and only the backend stores data, calls AI services and sends texts. Everything runs on one laptop on a phone hotspot.

```
 ON THE HOTSPOT                    LAPTOP                              CLOUD

 ┌────────────────────┐     ┌────────────────────────┐
 │ Pi touchscreen     ├────►│ web/  Next.js   :3000  │
 │ (Chromium kiosk)   │     │  /cabinet  touchscreen │
 └────────────────────┘     │  /doctor   dashboard   │
 ┌────────────────────┐     │                        │
 │ Doctor's browser   ├────►│                        │
 └────────────────────┘     └───────────┬────────────┘
                                        │ /api/* proxy
                                        ▼
 ┌────────────────────┐     ┌────────────────────────┐     ┌────────────────────┐
 │ Pi cabinet   pi/   ├────►│ backend/ FastAPI :8000 ├────►│ Gemini             │
 │ servos, camera,    │     │  routes + rules        │     │ labels, pill count,│
 │ mic, speaker       │     │  scheduler (every 2 s) │     │ speech, answers    │
 └────────────────────┘     │  in-memory data        │     ├────────────────────┤
                            │  /audio/*.mp3          ├────►│ ElevenLabs  voice  │
 ┌────────────────────┐     │                        │     ├────────────────────┤
 │ Phones  app/ Expo  │◄───►│  ai/ pure functions    ├────►│ Expo push          │
 │ patient, family,   │     │  (called by routes)    │     │ alerts, pill time, │
 │ doctor             │     │                        │     │ chat               │
 └─────────▲──────────┘     └────────────────────────┘     └─────────┬──────────┘
           │                                                         │
           └──────────────────── push notifications ─────────────────┘
```

| Part | Talks to | How |
|---|---|---|
| Pi (`pi/main.py`) | backend :8000 | polls `GET /cabinet/{id}/command`, posts slot photos and voice questions, plays `/audio/*.mp3` |
| Touchscreen + dashboard (`web/`) | backend via Next.js `/api/*` proxy | polls `/cabinet/{id}/state` every 1 s, dashboard polls every 3 s |
| Mobile app (`app/`) | backend :8000 directly | polls status, alerts and chat; registers for push |
| Backend (`backend/`) | Gemini, ElevenLabs (through `ai/`), Expo push | the only part that decides anything |

### Main flows

**Pill time**
1. The scheduler sees a dose is due → creates a `pending` dose.
2. `ai.speak()` (ElevenLabs) makes "Time for your blue pill" → MP3 in `/audio/`.
3. The Pi gets a command: open slot 2, play the MP3. The screen highlights the slot. The patient's phone gets a push.
4. The Pi photographs the slot before and after. `ai.count_pills()` (Gemini) counts both. Exactly one fewer → **taken**. The patient can also tap "I took it".
5. Nothing after 30 min (30 s with `DEMO=1`) → **missed**, push to family, alert on the dashboard.

**Voice question**
Patient asks "Did I take my pill today?" (Pi mic or the screen's Ask button) → `ai.transcribe()` → `ai.answer()` answers **only from the dose log** (otherwise "ask your doctor") → `ai.speak()` → the Pi or screen plays it.

**New prescription**
Doctor uploads a label photo on the dashboard → `ai.read_label()` (Gemini) fills in name, dose, times and expiration → the doctor checks every field → saved.

**Background checks:** fewer than 5 pills → refill alert to doctor and family. Expires within 7 days → alert to family. Each alert is sent once.

If a cloud service is down, the demo keeps working: the Pi plays 4 stored sounds, pill counting falls back to the "I took it" tap, and texts are printed in the backend console.

**Safety:** the AI never changes a dose. It only reminds and alerts the doctor and family.

## Layout

| Dir | Owner | What |
|---|---|---|
| `backend/` | Backend | API, data contract (`models.py`), rules, push |
| `ai/` | AI | label reading, pill counting, voice (pure functions) |
| `pi/` | Hardware | servos, camera, mic, speaker runtime |
| `web/` | Apps | Next.js: doctor dashboard (`/doctor`) and cabinet touchscreen (`/cabinet`) |
| `app/` | Backend | Expo mobile app for patients, families, doctors: chat + push |

## Run

Three terminals on the backend laptop, all from the repo root. Laptop, phones and Pi must be on the same **2.4 GHz phone hotspot** (campus WiFi blocks device-to-device traffic). Find the laptop IP with `ipconfig` (Windows) or `ipconfig getifaddr en0` (Mac).

**One-time setup**

```bash
cp .env.example .env                      # fill in keys; DEMO=1 for 30 s timings
python -m venv .venv
.venv/bin/pip install -r backend/requirements.txt          # Windows: .venv\Scripts\pip ...
cd web && npm install && cd ..
cd app && npm install && cd ..
```

**1. Backend (port 8000)**

```bash
.venv/bin/python -m uvicorn backend.main:app --reload --host 0.0.0.0
# Windows: .venv\Scripts\python -m uvicorn backend.main:app --reload --host 0.0.0.0
```

API docs: `http://localhost:8000/docs`. Restart after editing `.env` (`--reload` only watches `.py`).

**2. Web: doctor dashboard + cabinet screen (port 3000)**

```bash
cd web && npm run dev
```

Dashboard `http://localhost:3000/doctor`, cabinet `http://<laptop-ip>:3000/cabinet?patient=1`. The web app proxies `/api/*` to the backend (`BACKEND_URL`, default `http://localhost:8000`).

**3. Mobile app (Expo)**

```bash
cd app && npx expo start          # or: npx expo start --tunnel   if the phone can't load it
```

Install **Expo Go** on the phone, scan the QR code (iPhone: Camera app; Android: inside Expo Go). On the login screen enter `http://<laptop-ip>:8000` and an email: `lan@demo.com` (patient), `minh@demo.com` (family) or `doctor@demo.com` (doctor). On a computer, `npx expo start --web` runs the same app in the browser. Check the phone can reach the backend by opening `http://<laptop-ip>:8000/health` in its browser. Allow Python and Node through Windows Firewall when asked.

Notifications: in Expo Go they show while the app is running. Real push needs `npx eas init` in `app/` (Expo account), and on Android a development build (`npx eas build --profile development --platform android`).

On the Pi: `pip install -r pi/requirements.txt`, then `BACKEND_URL=http://<laptop-ip>:8000 python pi/main.py`.
Use a 2.4 GHz phone hotspot for the laptop and the Pi, not campus WiFi.

## Status

Working end to end on in-memory sample data. Live progress and who is doing what: `TEAM.md`.
