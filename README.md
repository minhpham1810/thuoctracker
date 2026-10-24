# ThuocTracker

A smart medicine cabinet for elderly and Alzheimer's patients, connected to an app for their doctor.

> The doctor writes the prescription and never knows if it was taken. We close the loop.

Built at HackPSU Fall 2026.

## How it works

- **Cabinet** (Raspberry Pi 5): 3 servo-controlled slots, touchscreen, camera that checks whether a pill was really taken, mic + speaker you can talk to.
- **Doctor dashboard** (web): patients, taken/missed doses, pills left, live alerts.
- **Family alerts** (Twilio SMS): missed dose, low pills, expiring soon.
- **AI**: Gemini reads medicine labels and counts pills from camera photos. Voice questions ("Did I take my pill today?") are answered from the real dose log and spoken with ElevenLabs.

Nothing talks directly to anything else. The cabinet, screens and AI all read and write through the backend, and only the backend sends texts.

```
Pi cabinet ──┐
cabinet web ─┼──► backend (FastAPI, laptop) ──► Gemini / ElevenLabs / Twilio
doctor web ──┘
```

**Safety:** the AI never changes a dose. It only reminds and alerts the doctor and family.

## Layout

| Dir | Owner | What |
|---|---|---|
| `backend/` | Backend | API, data contract (`models.py`), rules, Twilio |
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

Install **Expo Go** on the phone, scan the QR code (iPhone: Camera app; Android: inside Expo Go). On the login screen enter `http://<laptop-ip>:8000`, pick a role. Check the phone can reach the backend by opening `http://<laptop-ip>:8000/health` in its browser. Allow Python and Node through Windows Firewall when asked.

Notifications: in Expo Go they show while the app is running. Real push needs `npx eas init` in `app/` (Expo account), and on Android a development build (`npx eas build --profile development --platform android`).

On the Pi: `pip install -r pi/requirements.txt`, then `BACKEND_URL=http://<laptop-ip>:8000 python pi/main.py`.
Use a 2.4 GHz phone hotspot for the laptop and the Pi, not campus WiFi.

## Status

Backend API runs on in-memory sample data (see TEAM.md for routes); AI routes return fake answers and Pi/AI functions are still stubs.
