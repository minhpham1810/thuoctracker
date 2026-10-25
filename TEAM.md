# Who does what

## Status

Newest first. Everyone (and every agent) reads this after `git pull` and adds a line after pushing something others use. Format: `- HH:MM <name> (<area>): <what changed / what is ready / what you need to do>`.

- 20:45 Minh Dau (app + backend): **Scan a medicine label with the phone.** In the mobile app, the doctor or the family opens the patient's Today tab → "Scan a label to add a medicine" → takes a photo (or picks one). Gemini fills in the name, dose, times, expiration and pills in the bottle. They choose a free box (1-7) and a pill color, check every field, and save. If a medicine with the same name is already there: "Aspirin was already added (box 1). Are you sure you want to add it again?"
  - Contract: `POST /medicines` now allows the patient's **family** too, not only the doctor. `/ai/label` allows family and returns a new `quantity` field. Edit and delete stay doctor-only.
  - Minh Pham: `LabelDraft` in `web/lib/api.ts` can gain `quantity: number | null` to prefill pills left on the dashboard (optional).
  - The app now uses `expo-image-picker` (camera). It works in Expo Go now; the Android APK needs a rebuild (Minh Dau is starting one), and until then the old APK says "no camera support" instead of crashing.

- 20:15 Thanh (pi): **ESP32-S3 audio unit over USB.** The speaker (MAX98357A) and mic (INMP441) are on the ESP32 (CircuitPython with `audioi2sin`); the Pi controls it over one USB cable. `pi/esp32/` has `boot.py` + `code.py` to copy onto the board and a setup README (stored sounds as 16 kHz mono WAV in `/sounds`). With `AUDIO=esp32` in `pi/.env`, `pi/main.py` plays the stored sounds and the ElevenLabs answers through it (MP3 converted on the Pi), `record_question` works, and an optional talk button on the ESP32 records a question -> `/ai/ask` -> plays the answer. Bench: `python pi/main.py esp32 ping|play good_job|rec 3|ask`. Tested against a fake board only; needs a run on the real one. New Pi dependency: `pyserial`.
  - Duy: copy `pi/esp32/boot.py` and `code.py` to the board, add the 4 WAVs, plug it into a black USB port on the Pi; set `BUTTON_PIN` in `code.py` if you wire a talk button.
- 20:00 Minh Dau (backend): **Several backends can now run at the same time on the shared database.**
  - **One scheduler:** only one backend runs it, whichever holds the `scheduler_lease` row in the database. If that laptop stops, another backend takes over within about 15 s and catches up on doses due in the gap. `GET /health` returns `"scheduler": true` on the one running it.
  - **Shared state:** the Pi command queue, cabinet screen state, photo counts, "alerts already sent" and reminder times moved from process memory into tables (`cabinet_commands`, `cabinet_state`, `photo_counts`, `alerts_sent`, `doses.reminded_at`). The Pi, the cabinet screen and the dashboard can each talk to any backend.
  - **No duplicates:** each scheduler step is a conditional write, and the database allows only one dose per medicine per pill time (`doses_one_per_time`). Even if two schedulers overlap briefly, nothing is sent twice.
  - **Tested** with two backends at once against a throwaway schema, never the real tables: pill time on B reached the Pi via A; "I took it" on B showed on A; missed and expiring alerts went out exactly once to family and to doctor; after hard-killing the scheduler backend, the other took over.
  - No contract change for the Pi, web or app. New tables are created on the first start of the new code.
  - Everyone: keep laptop clocks on automatic time. Dose times still use each laptop's local clock.

- 19:45 Thanh (pi + cabinet screen): **Cabinet sign-in now accepts any patient account** (doctor/family still refused). `pi/kiosk.sh` opens plain `/cabinet`; an old `?hw=1` URL also works. Heads-up: the Pi's doors, speaker and camera still follow `PATIENT_ID` in `pi/.env`, so sign the screen in as that same patient (Grandma Lan = 1) or the screen and the hardware will show different people. `?patient=N` still skips the sign-in.
- 19:25 Thanh (pi + cabinet screen): **Cabinet sign-in: a one-time setup on the Pi.** `/cabinet?hw=N` (what `pi/kiosk.sh` now opens; N = `PATIENT_ID` in `pi/.env`) asks once for patient N's email + password on a big built-in keyboard and remembers it; only that patient's account is accepted, so the screen always matches the Pi's boxes. Doctor/family accounts are refused; the login session is ended right away (the cabinet routes stay login-free). Menu has **Switch patient** (Cancel, or it goes back after 1 min idle). `/cabinet?patient=N` still works with no sign-in, for laptops and the demo. `kiosk.sh` dropped `--incognito` so the sign-in survives reboots. No backend change.
  - Thanh: on the Pi, `git pull`, then restart the kiosk (`pkill chromium`) and sign in once as lan@demo.com.
- 18:56 Minh Pham (app): **Fixed `npx expo start` asking to install the old global `expo-cli`.** `app/package.json` had been downgraded to `"expo": "^44.0.6"`, probably by an `npm install` when `expo-file-system` was added. Set back to `~58.0.19` and reinstalled (`npx expo --version` = 58.1.15).
  - Everyone: `git pull`, then `cd app && npm install`. Add Expo packages only with `npx expo install <pkg>`, never `npm install <pkg>`, and don't run `npm audit fix --force`: both can downgrade Expo again. If `npx expo start` offers to install `expo-cli` globally, say no.
  - Expo Go QR: on iPhone scan with the Camera app; on Android scan from inside Expo Go. Or in Expo Go tap "Enter URL manually" and type the `exp://…:8081` address it prints. Update Expo Go first (SDK 58). If the phone can't reach the laptop, use `npx expo start --go --tunnel`.

- 18:50 Minh Dau (backend + app): **The family now gets the pill-time push too**: "Time for Grandma Lan's blue pill (Aspirin), slot 1." Many older patients don't use a phone, so the family can call or help. It's sent once when the dose starts, not on every repeat reminder. In the app, the family's in-app banner shows it too (for phones without push).

- 18:40 Minh Dau (backend + app): **Alerts now go to more people.** A missed dose alerts family **and doctor**, and the patient gets an inform-only push: "You missed your 12:00 Metformin. Your family and doctor have been told." It never says "take it now", because a late pill could double up with the next dose. Expiring soon now alerts family **and doctor**. Low pills is unchanged (doctor + family). In the app, the patient's in-app banner also announces a missed dose (for phones without push).
  - Minh Pham: there are now two alert rows per missed or expiring event (`to: "family"` and `to: "doctor"`), the same as low pills already had. The dashboard may want to show only the doctor rows.
  - Heads-up: a backend test of mine ran `/demo/reset` on the shared Tiger Data database around 18:30, so anything added since the last reset was wiped back to the demo seed. Sorry. I won't test against the shared database again.

- 18:30 Thanh (cabinet screen): **Cabinet screen: dark theme + Menu button** (`web/app/cabinet/*` only, no contract change). A Menu button sits top-left. It opens: Screen Light / Dark / Auto (Auto = dark from 7 PM to 7 AM, the default), Text size Normal / Large, and Today's pills (every dose today with its box and Taken / Missed / Due now / Coming up). Tapping the Today strip also opens that list. Choices are saved in the Pi's browser. The menu closes on its own after 30 s and whenever a pill is due. Dark keeps 4.5:1 contrast everywhere.
  - Thanh: restart the :3000 server (`cd web && npx next start -H 0.0.0.0 -p 3000`) so the Pi shows it.
- 18:15 Thanh (cabinet screen): **Cabinet screen polish + accessibility pass** (`web/app/cabinet/*` only, same behavior and layout). The cabinet picture now looks like the real thing: teal body, white doors with pulls, empty boxes as dark recesses; the open door lifts and glows with OPEN, the rest fade. Pill colour is a capsule in each box's corner; "box N" on the take screen is drawn like the glowing door. Bigger text everywhere (nothing under 14px at 800x480), Today strip shows at most 4 doses so names fit, the hero shows a mic while you ask, the lit box uses the mode colour (green taken, amber already took, red missed). A11y: box labels read pills left, refill and expiry in full; Today chips say taken/missed for screen readers; details card takes focus, closes on Escape, and the page behind it is inert. No contract change.
  - Thanh: the :3000 server reads `web/.next`, which this build rewrote: restart it (`cd web && npx next start -H 0.0.0.0 -p 3000`) so the Pi shows the new design.
- 18:05 Minh Dau (app + backend): **Real push notifications on Android.** The app is a development build now: Expo project `@minhdeptraivcl/thuoctracker` with Firebase FCM set up. Install the APK on Android phones: https://expo.dev/artifacts/eas/eGW9mu9nQSFXYmpwcVxmKkgN8vcxr0A8b4TIdMBRKus.apk
  - To run: on the laptop, `cd app`, then `$env:REACT_NATIVE_PACKAGER_HOSTNAME="192.168.137.1"; npx expo start`. Open the installed ThuocTracker app (not Expo Go), log in, and allow notifications. Alerts, pill time and chat then push even with the app closed.
  - iPhone: keep using Expo Go with `npx expo start --go`. Plain `npx expo start` now opens the development build.
  - Network: Minh Dau's laptop hotspot. Backend `http://192.168.137.1:8000`, web `http://192.168.137.1:3000`. Thanh: `BACKEND_URL=http://192.168.137.1:8000`, kiosk `http://192.168.137.1:3000/cabinet?patient=1`.
  - Push failures print as `[push error] …` in the uvicorn console.
  - Minh Pham: the dashboard's "Push sent to … phone" line appears even when no phone is registered. It's true now only if the family or doctor is logged in on a development build.

- 17:30 Thanh (pi + cabinet screen): **Contract change: the cabinet has 7 boxes, `Medicine.slot` is now 1-7.** Boxes 1-3 top row, 4-6 middle row, 7 a long box across the bottom; every box holds pills like a slot. Additive: slots 1-3 still work. Changed `models.py`, `web/lib/api.ts` (`SLOTS`, `LONG_SLOT`), the add-medicine slot picker and the dashboard's prescription cards (filled boxes plus one "add" card), and `pi/main.py` (box n = PCA9685 channel n-1). **Cabinet screen redesigned** as a picture of the cabinet: the box to open glows with OPEN and the rest fade, each box shows its pills left with "Refill soon" / "Expires in N d", tapping a box opens its details, the take screen says "Open box N · take <dose>", and a Today strip along the bottom shows taken / missed / due / coming doses. Tested on the Pi touchscreen (800x480). Also: the Pi now boots straight into the kiosk with the mic flags (`pi/setup.sh`).
  - Minh Dau: please check the slot change is fine with the backend; nothing else in the backend needed changing.
  - Minh Pham: I edited `web/app/cabinet/*` and two doctor files (slot lists only). On the Pi, serve the web app with `npm run build && npx next start -H 0.0.0.0`: dev mode blocks the Pi's browser (cross-origin dev resources).

- 16:25 Minh Pham (web + ai): **Cabinet screen: "Ask a question" button** (records in the browser -> `/ai/ask` -> shows the answer big and plays the ElevenLabs MP3). Hidden while a pill is due. **Dashboard: "Cabinet camera test"** under the prescriptions: upload before/after slot photos for the waiting dose, see Gemini's counts, and the dose turns taken when exactly 1 is removed (tests counting without the Pi). `ai.transcribe` now detects WAV/WebM/MP4/OGG/MP3 by itself.
  - NEED Thanh (pi): Chromium only allows the mic on https or localhost. Start the kiosk with `--unsafely-treat-insecure-origin-as-secure=http://<laptop-ip>:3000` or the Ask button says the mic isn't available. If the Pi mic is unreliable, keep using `record_question` + `/ai/ask` from `pi/main.py`.
- 16:08 Minh Pham (ai): **All 5 `ai/` functions are real now** (Gemini `gemini-3.5-flash` + ElevenLabs over `requests`, no new SDKs; tested live: speak, transcribe, answer). The backend's existing `try_ai` wiring picks them up, nothing to change. Checked the whole flow offline with faked APIs: `/ai/label`, `/ai/ask` -> MP3, pill time -> SMS + `say_url`, before/after photos -> taken. Test: `python -m ai.test_ai`.
  - Everyone: put `GEMINI_API_KEY` and `ELEVENLABS_API_KEY` in `.env` and restart the backend. Optional `ELEVENLABS_VOICE_ID`.
  - Minh Dau: I touched `backend/` only for a docstring, and fixed `.gitignore` (`.DS_Store` and `audio/` were on one line, so `audio/` MP3s were not ignored).
- 17:20 Minh Dau (backend): **Pulled Thanh's Pi loop: it matches the contract.** I fixed one backend bug it exposed. A door cycle (10 s open + 2 photos) takes longer than the 10 s demo reminder, so door commands piled up and an old reminder could reopen the door after the pill was taken. Now at most one door command per dose waits in the queue, and taking the pill or missing the dose removes it. Thanh: no change needed on the Pi; audio-only commands (`good_job`, `missed`) still arrive as before.
- 16:55 Minh Dau (backend): **Done: the backend no longer serves `web/`** (Minh Pham's NEED). Port 8000 is now API + `/audio/` only, and `web/` files return 404. I checked every route the Next.js pages call (`/patients`, `/alerts`, `/medicines`, `/doses/{id}/taken`, `/cabinet/{id}/state`, `/ai/label` with field `photo`, `/demo/*`): all exist with matching shapes.
  - Minh Pham: `LabelDraft` allows `null` fields. Return `None` from `read_label` for anything unreadable and the backend passes it through. Chat on the dashboard is optional; the mobile app already has it.

- 15:50 Minh Pham (frontend): **Doctor dashboard + cabinet screen are live on the real API**, now a Next.js app in `web/` (whole folder is mine). Run `cd web && npm install && npm run dev` → dashboard `http://<laptop-ip>:3000/doctor`, cabinet `http://<laptop-ip>:3000/cabinet?patient=1`. The browser calls `/api/*` on :3000, which proxies to the backend (`BACKEND_URL`, default `http://localhost:8000`), so no CORS needed. Dashboard has "Pill time now" (calls `/demo/pill_time`) and "Add medicine" (label photo → `/ai/label` → form → `POST /medicines`).
  - Minh Dau: the dashboard moved from static `web/doctor` to Next.js, so it is no longer served on :8000. It handles cabinet `mode: "missed"` and the new alerts; chat on the dashboard is not built yet.
  - NEED Thanh (pi): the kiosk URL is now `http://<laptop-ip>:3000/cabinet?patient=1` (port 3000, not 8000).
  - NEED Minh Dau (backend): please delete the `app.mount("/", StaticFiles(directory="web", ...))` line in `backend/main.py`. `web/` is Next.js source now, so that mount would serve `node_modules`, `.next` and any `web/.env*` file to anyone on the hotspot.
- 16:40 Minh Dau (app): **First version of the mobile app is in `app/`.** Pick a role (patient, family or doctor). The doctor sees all their patients with taken/missed counts and refill badges; each patient has a Today tab (medicines, pills left, alerts, dose history, "take your pill" banner) and a Chat tab shared by patient, family and doctor. Phone notifications show while the app is running; real push turns on after `npx eas init` (Android also needs a development build). To try it: `cd app && npm install && npx expo start`, open it in Expo Go, and enter `http://<laptop-ip>:8000`. Nobody else needs to change anything.
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
| **Minh Pham**: AI + Frontend | `ai/__init__.py`, `web/` (Next.js: `/doctor`, `/cabinet`) | The 5 AI functions work alone; dashboard and cabinet screen run on the real API |
| **Thanh**: Raspberry Pi code | `pi/` (code, backup sounds, Pi software setup) | Pi polls the backend, opens slots, sends photos/recordings, plays audio |
| **Duy**: Hardware (joins later) | The physical cabinet: wiring, servos, camera mount, audio parts, box. No repo folder | Thanh's code runs on real parts instead of mock mode |

Rules that stop overlap:

- **AI functions stay pure.** Minh Pham writes `read_label`, `count_pills`, `transcribe`, `answer`, `speak` (bytes/text in, data out, no FastAPI, no DB). Minh Dau calls them from the routes.
- **Only the backend decides.** The Pi never logs a dose or calls `/ai/count` itself: it sends photos, the backend counts and decides "taken". The screens never compute alerts: they show what the API returns.
- **`models.py` is Minh Dau's.** Need a field? Ask in the group chat; Minh Dau adds it and tells everyone.
- Need something in someone else's folder? Message them, don't edit it.

## The API contract (agree in Hour 0, then don't break it)

Minh Dau's first job is making **every route below return fake data within the first hour**, so Minh Pham and Thanh can build against it right away. Then fill in the real logic behind the same shapes.

### Accounts and auth

Data lives in Tiger Data (Postgres, `DATABASE_URL` in `.env`). **Several backends can run against one database at once.** Only one runs the scheduler (whoever holds the `scheduler_lease` row; another takes over within ~15 s if it stops), and the Pi queue, cabinet screen state and photo counts are in the database, so the Pi, screen and dashboard can each talk to any backend. `GET /health` says `"scheduler": true` on the one running it. Keep laptop clocks on automatic time.

One `users` table, one role per account. Patient: `age`, `doctor_id`. Family: `patient_id`. Demo accounts (password `demo1234`): `doctor@demo.com`, `lan@demo.com` (patient 1), `minh@demo.com` (Lan's family).

App and dashboard routes need `Authorization: Bearer <token>` (401 without it). Cabinet routes and `/demo/*` are login-free.

| Route | Who | Returns |
|---|---|---|
| `POST /signup` `{role, name, email, password, age?, doctor_email?, patient_email?}` | anyone | `{token, user}`. Patient needs `age` + an existing doctor's email; family needs an existing patient's email. 409 if the email is taken |
| `POST /login` `{email, password}` | anyone | `{token, user}`; 401 "Wrong email or password" |
| `POST /logout`, `GET /me` | logged in | `{ok}`, the `User` |
| `GET /contacts` | logged in | `[{user, unread, last}]`: their care circle. Doctor: patients + their families. Patient: doctor + family. Family: patient + doctor |
| `GET /messages?with_id=&since=` | logged in | `[Message]` `{id, from_id, to_id, text, at}` oldest first; with `with_id`, also marks that person's messages read |
| `POST /messages` `{to_id, text}` | logged in | `Message`; 403 outside the circle; pushes to `to_id` |
| `GET /alerts?since=` | logged in | Doctor: every alert about their patients. Family: their patient's family alerts. Patient: `[]` |
| `POST /push/register` `{token}` | logged in | Expo push token, kept on this login (logout stops pushes) |

### Data + doctor dashboard

| Route | Who | Returns |
|---|---|---|
| `GET /patients/{id}/medicines`, `GET /patients/{id}/doses` | patient, their family, their doctor | `[Medicine]`, `[DoseLog]` newest first |
| `POST /medicines` | the patient's doctor or family | `Medicine` with `id`; 409 if the slot is taken |
| `PATCH /medicines/{id}` (any fields) | the patient's doctor | updated `Medicine` (refill = `pills_left`) |
| `DELETE /medicines/{id}` | the patient's doctor | `{ok}`; its doses go too |
| `POST /doses/{id}/taken` | the patient | `DoseLog` (phone "I took it") |
| `POST /ai/label` (photo) | doctors and family | `{name, dose, times, expiration, quantity}` draft for the add-medicine form (`quantity` = pills in the bottle; any field may be `null`) |

### Cabinet: two pollers, two routes

The Pi and the cabinet screen both poll. If they share one route, whoever reads first "eats" the command. So:

| Route | Who calls it | Returns |
|---|---|---|
| `GET /cabinet/{id}/command` | **Pi only.** Each command is given out once | `{}` or `{"dose_id": 7, "open_slot": 2, "say_url": "/audio/7.mp3", "sound": "time_for_pill"}` |
| `GET /cabinet/{id}/state` | **Screen only.** Read-only, safe to poll | `{"mode": "idle" \| "take" \| "taken" \| "already_took" \| "missed", "dose_id", "slot", "medicine", "color", "message"}` |
| `POST /cabinet/{id}/photo?dose_id=7&phase=before\|after` (photo) | Pi | `{"count": 10}` or `{"count": null}` if counting failed; after the "after" photo the backend decides taken (before − after == 1). Never guesses: on `null` the dose stays pending until "I took it" |
| `GET /cabinet/{id}/today` | Screen | `{name, medicines, doses}` |
| `POST /cabinet/{id}/taken?dose_id=7` | Screen "I took it" button | updated `DoseLog` |
| `POST /ai/ask?patient_id=1` (audio) | Pi | `{"text": "...", "audio_url": "/audio/q12.mp3"}` |
| `GET /audio/{file}.mp3` | Pi | MP3 the backend made with `speak()` |

`open_slot` is optional: a command without it (e.g. `{"dose_id": 7, "say_url": null, "sound": "missed"}`) only plays audio. The same dose can arrive again as a repeat reminder. `sound` is one of `time_for_pill`, `good_job`, `already_took`, `missed`. If `say_url` fails to download, the Pi plays its stored file with that name.

Every alert goes to the dashboard and by push to that role's phones. Pill time pushes to the patient's phone too.

### Demo controls (Minh Dau)

- `DEMO=1` in `.env`: missed after 30 s instead of 30 min, reminder repeat 10 s instead of 10 min.
- `POST /demo/pill_time?medicine_id=1`: start a dose right now (don't wait for 8:00).
- `POST /demo/reset`: reload the sample patients.

## Contract changes to make in Hour 0 (Minh Dau, in `models.py`)

1. `Patient.phone`: the reminder text goes to the patient's own phone, but only `family_phone` exists today.
2. `Doctor.phone` (optional): only if we want refill alerts as SMS too; otherwise doctor alerts just show on the dashboard.
3. `Medicine.slot` is `1`-`7` (boxes 1-3 top row, 4-6 middle row, 7 the long bottom box; changed from 1-3 at 17:30). Two medicines can't share a slot: reject in `POST /medicines`.
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
- Pi OS, join the hotspot, open `http://<laptop-ip>:3000/cabinet?patient=1` full-screen in Chromium kiosk mode.
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
