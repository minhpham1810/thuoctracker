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

```bash
cp .env.example .env            # fill in keys
python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --host 0.0.0.0

# second terminal (Node 20+)
cd web && npm install && npm run dev
# Dashboard: http://localhost:3000/doctor   Cabinet: http://localhost:3000/cabinet?patient=1
```

The web app proxies `/api/*` to the backend (`BACKEND_URL`, default `http://localhost:8000`).

Mobile app: `cd app && npm install && npx expo start`, scan the QR code with Expo Go, enter `http://<laptop-ip>:8000` on the login screen.

On the Pi: `pip install -r pi/requirements.txt`, then `BACKEND_URL=http://<laptop-ip>:8000 python pi/main.py`.
Use a 2.4 GHz phone hotspot for the laptop and the Pi, not campus WiFi.

## Status

Backend API runs on in-memory sample data (see TEAM.md for routes); AI routes return fake answers and Pi/AI functions are still stubs.
