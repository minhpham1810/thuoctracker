# Who does what

## Status

Newest first. Everyone (and every agent) reads this after `git pull` and adds a line after pushing something others use. Format: `- HH:MM <name> (<area>): <what changed / what is ready / what you need to do>`.

- 16:00 Minh Dau (backend + app): **Adding a mobile app** (Expo, in `app/`, built by Minh Dau) for patients, families and doctors, with a chat per patient and push notifications. The backend part is ready: chat routes, push registration, and every alert sent by both push and SMS (see "Mobile app" in the contract). Added a 3rd sample patient, Mrs. Hoa.
  - Minh Pham: the web doctor dashboard stays (it's the big screen at the judging table), with no change needed. Optional: show the patient chat on the dashboard with `GET /patients/{id}/messages`.

- 15:35 Minh Dau (backend): **The AI routes now call `ai/`.** `/ai/label`, `/ai/ask` and `/cabinet/{id}/photo` call `read_label`, `count_pills`, `transcribe`, `answer` and `speak`. A function that still raises `NotImplementedError` gets a fake answer, so Minh Pham can push one function at a time and it goes live with no backend change.
  - Minh Pham: match the signatures in `ai/__init__.py` exactly. `answer(question, log)` receives the dose-log shape in this file (contract change 4). `speak` returns MP3 bytes; the backend saves them and serves them at `/audio/…`. Make sure `import ai` never crashes, or the backend won't start.
  - Thanh: `say_url` and `audio_url` become real MP3 links (prefix with `BACKEND_URL`) once `speak` is written; while they're `null`, play the backup `sound`. After a dose the Pi also gets `{"sound": "good_job"}` or `{"sound": "already_took"}`. `/photo` can return `{"count": null}`: carry on, the backend won't guess.

- 15:20 Minh Dau (backend): **The scheduler is running.** Pill time starts a dose on its own, the reminder repeats, a dose with no pill taken is marked missed, and the low-pills and expiring alerts fire once each. Texts go through Twilio, or are printed to the console when `.env` has no keys. Put `DEMO=1` in `.env` for the 30 s missed / 10 s reminder timing.
  - Thanh: **contract change.** A command may come without `open_slot` (e.g. `{"dose_id": 7, "sound": "missed"}`): just play the sound. The same `dose_id` can arrive again as a repeat reminder: open the slot again.
  - Minh Pham: the cabinet `/state` can now be `mode: "missed"`. New alerts appear in `/alerts` on their own, so poll with `?since=`.

- 15:10 Minh Dau (backend): **API is live on in-memory sample data.** Every route in the contract below works with the exact JSON shapes. Run `uvicorn backend.main:app --reload --host 0.0.0.0` from the repo root, or use Minh Dau's laptop IP on the hotspot, port 8000. Fake pill time: `POST /demo/pill_time?medicine_id=1`; reset: `POST /demo/reset`.
  - Minh Pham: build the dashboard on `/patients`, `/patients/{id}/medicines`, `/patients/{id}/doses`, `/alerts`; the cabinet screen polls `/cabinet/1/state`. `/ai/label` and `/ai/ask` return fixed fake answers until your `ai/` functions are pushed. Add a Status line when each one is ready.
  - Thanh: the Pi polls `/cabinet/1/command` and posts photos to `/cabinet/1/photo?dose_id=&phase=before|after`. `say_url` is `null` for now, so play the backup sound named in `sound`.
  - `models.py`: `Patient.phone` (required) and `Doctor.phone` (optional) were added.
  - Not done yet: the scheduler (timed reminders, missed doses, low and expiring alerts) and Twilio.

4 people. Each person owns **folders**, not features, so nobody edits the same file. Duy joins later for the physical build.

| Person | Owns (only you edit these) | Done means |
|---|---|---|
| **Minh Dau**: Backend + mobile app | `backend/` (all of it: `main.py`, `models.py`, rules, Twilio, push, the `/ai/*` route wrappers) and `app/` (Expo mobile app for patient, family, doctor: chat + push) | Every endpoint below returns real data; alerts and texts fire on their own |
| **Minh Pham**: AI + Frontend | `ai/__init__.py`, `web/doctor/`, `web/cabinet/` | The 5 AI functions work alone; dashboard and cabinet screen run on the real API |
| **Thanh**: Raspberry Pi code | `pi/` (code, backup sounds, Pi software setup) | Pi polls the backend, opens slots, sends photos/recordings, plays audio |
| **Duy**: Hardware (joins later) | The physical cabinet: wiring, servos, camera mount, audio parts, box. No repo folder | Thanh's code runs on real parts instead of mock mode |

Rules that stop overlap:

- **AI functions stay pure.** Minh Pham writes `read_label`, `count_pills`, `transcribe`, `answer`, `speak` (bytes/text in, data out, no FastAPI, no DB). Minh Dau calls them from the routes.
- **Only the backend decides.** The Pi never logs a dose or calls `/ai/count` itself: it sends photos, the backend counts and decides "taken". The screens never compute alerts: they show what the API returns.
- **`models.py` is Minh Dau's.** Need a field? Ask in the group chat; Minh Dau adds it and tells everyone.
- Need something in someone else's folder? Message them, don't edit it.

## The API contract (agree in Hour 0, then don't break it)

Minh Dau's first job is making **every route below return fake data within the first hour**, so Minh Pham and Thanh can build against it right away. Then fill in the real logic behind the same shapes.

### Data + doctor dashboard (used by Minh Pham)

| Route | Returns |
|---|---|
| `GET /patients?doctor_id=1` | `[Patient]` |
| `POST /patients` | `Patient` with `id` |
| `GET /patients/{id}/medicines` | `[Medicine]` |
| `POST /medicines` | `Medicine` with `id` |
| `GET /patients/{id}/doses` | `[DoseLog]` newest first |
| `GET /alerts?since=<iso time>` | `[Alert]` (dashboard polls every 3 s for "live" alerts) |
| `POST /ai/label` (photo) | `{name, dose, times, expiration}` draft; dashboard pre-fills the add-medicine form, doctor fixes slot/pills/color, then `POST /medicines` |

### Cabinet: two pollers, two routes

The Pi and the cabinet screen both poll. If they share one route, whoever reads first "eats" the command. So:

| Route | Who calls it | Returns |
|---|---|---|
| `GET /cabinet/{id}/command` | **Pi only.** Each command is given out once | `{}` or `{"dose_id": 7, "open_slot": 2, "say_url": "/audio/7.mp3", "sound": "time_for_pill"}` |
| `GET /cabinet/{id}/state` | **Screen only.** Read-only, safe to poll | `{"mode": "idle" \| "take" \| "taken" \| "already_took" \| "missed", "dose_id", "slot", "medicine", "color", "message"}` |
| `POST /cabinet/{id}/photo?dose_id=7&phase=before\|after` (photo) | Pi | `{"count": 10}` or `{"count": null}` if counting failed; after the "after" photo the backend decides taken (before − after == 1). Never guesses: on `null` the dose stays pending until "I took it" |
| `POST /doses/{dose_id}/taken?method=screen` | Screen "I took it" button | updated `DoseLog` |
| `POST /ai/ask?patient_id=1` (audio) | Pi | `{"text": "...", "audio_url": "/audio/q12.mp3"}` |
| `GET /audio/{file}.mp3` | Pi | MP3 the backend made with `speak()` |

`open_slot` is optional: a command without it (e.g. `{"dose_id": 7, "say_url": null, "sound": "missed"}`) only plays audio. The same dose can arrive again as a repeat reminder. `sound` is one of `time_for_pill`, `good_job`, `already_took`, `missed`. If `say_url` fails to download, the Pi plays its stored file with that name.

### Mobile app: chat + push (Minh Dau)

| Route | Returns |
|---|---|
| `GET /doctors` | `[Doctor]` |
| `GET /patients/{id}/messages?since=<iso>` | `[Message]` oldest first. One chat per patient: patient + family + doctor |
| `POST /patients/{id}/messages` | body `{patient_id, sender: "patient"\|"family"\|"doctor", sender_name, text}` → `Message` with `id`, `at`; pushes to the other two roles |
| `POST /push/register` | body `{role, user_id, token}` (Expo push token; `user_id` = patient id for patient/family, doctor id for doctor) |

Every alert now goes to the app (dashboard + push to that role's phones) **and** by SMS. Pill time pushes to the patient's phone too.

### Demo controls (Minh Dau)

- `DEMO=1` in `.env`: missed after 30 s instead of 30 min, reminder repeat 10 s instead of 10 min.
- `POST /demo/pill_time?medicine_id=1`: start a dose right now (don't wait for 8:00).
- `POST /demo/reset`: reload the sample patients.

## Contract changes to make in Hour 0 (Minh Dau, in `models.py`)

1. `Patient.phone`: the reminder text goes to the patient's own phone, but only `family_phone` exists today.
2. `Doctor.phone` (optional): only if we want refill alerts as SMS too; otherwise doctor alerts just show on the dashboard.
3. `Medicine.slot` is `1 | 2 | 3`; keep it. Two medicines can't share a slot: reject in `POST /medicines`.
4. Dose log passed to `answer()`: a list of `{"medicine": "Aspirin", "due_at": iso, "status": "taken", "taken_at": iso}`. Minh Pham codes against this shape.

## Each person's task list

### Minh Dau: Backend

**Hours 0-1**
- Make the `models.py` changes above, push, post in chat.
- Stub every route in the contract with fake JSON. Push. This unblocks everyone.

**Hours 1-6**
- In-memory store (`db` dict) for patients, medicines, doses, alerts. SQLite only if time allows.
- Real CRUD routes. Sample data loader (1 doctor, 2 patients, 3 medicines).
- `/cabinet/{id}/command` queue + `/cabinet/{id}/state`.
- `/cabinet/{id}/photo` → `ai.count_pills()` → taken logic. Wrap `/ai/label` and `/ai/ask` around Minh Pham's functions (use fake returns until theirs are ready).

**Hours 6-10**
- Scheduler (background loop every few seconds): pill time → create `pending` dose, push command, SMS patient; repeat reminder; missed → SMS family; `pills_left < 5` → `low_pills`; expiration ≤ 7 days → `expiring_soon`. Don't send the same alert twice.
- "Already took" check: second open of a `taken` dose → state `already_took`, sound `already_took`.
- Twilio texts (verify everyone's numbers on the trial account first).
- Save `speak()` MP3s to a folder and serve them at `/audio/`.

**Hours 14-18**: demo routes, bug fixes, realistic sample data.

### Minh Pham: AI + Frontend

**Hours 1-6**
- `read_label`: Gemini on 3 real bottles. Return JSON only, `expiration` as `YYYY-MM-DD`, `times` as `["08:00"]`.
- `count_pills`: Gemini on slot photos (candy pills). Test with 0, 1, 5, 10 pills.
- Doctor dashboard against Minh Dau's fake API: patient list, each patient's medicines + pills left, dose history (taken/missed), alerts panel.
- Cabinet screen: big message, slot highlighted in the medicine's color, big "I took it" button. Polls `/state` every 1 s.

**Hours 6-10**
- `transcribe` (Gemini audio or ElevenLabs STT), `answer` (only from the dose log; if the log doesn't say, answer "I don't know, ask your doctor"), `speak` (ElevenLabs → MP3 bytes).
- Dashboard: "Add medicine from photo" (upload → `/ai/label` → pre-filled form → `POST /medicines`).
- Switch both pages from fake to real API.

**Hours 14-18**: polish, live alerts, demo video.

### Thanh: Raspberry Pi

Duy wires the hardware later, so write the code first with a **mock mode**: `MOCK=1 python pi/main.py` prints "open slot 2", uses a test JPG instead of the camera, a test WAV instead of the mic, and the laptop speaker. Then flip to real parts one at a time as Duy connects them.

**Hours 1-6**
- Pi OS, join the hotspot, open `http://<laptop-ip>:8000/cabinet/` full-screen in Chromium kiosk mode.
- Poll loop against Minh Dau's fake `/command`. Mock mode working end to end.
- Keep each hardware call (`open_slot`, `snap`, `play_mp3`, `record_question`) behind the mock flag so Duy can test one part at a time.

**Hours 6-10**
- Real flow per command: snap `before` → POST photo → open slot → play `say_url` (or backup sound) → wait for door close / fixed seconds → close slot → snap `after` → POST photo.
- Voice: a button (or screen tap) records 5 s → `POST /ai/ask` → play `audio_url`.
- All 3 slots. Record the 4 backup sounds (`time_for_pill`, `good_job`, `already_took`, `missed`) into `pi/sounds/`.

**Hours 14-18**: run the full flow on real hardware with Duy, fix timing bugs.

### Duy: Hardware (when you join)

Wiring tables are in the team plan PDF (Pi wiring section).
- Camera first: check the 22-to-15-pin Pi 5 cable. Mount it looking down at the slots.
- PCA9685 servo driver + 1 servo, then all 3. Servo power from the separate 5 V bank, not the Pi.
- Audio: `dtoverlay=googlevoicehat-soundcard` for the INMP441 + MAX98357A, **1 hour max**, then switch to the ESP32 speaker backup.
- Touchscreen per Freenove's guide.
- Box: 3 slots with doors, camera mount on top, slot labels, tidy cables.
- Tell Thanh each time a part works so they can turn off mock mode for it.

## When we connect (hours 6-10)

Order, so a failure is easy to find:
1. Pi mock mode ↔ real backend (no hardware).
2. Cabinet screen ↔ real backend.
3. Real camera photo → `/cabinet/{id}/photo` → real `count_pills`.
4. Servos, then audio.

Run the full demo script (README / team plan) once at hour 10, again at hour 18.
