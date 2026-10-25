# Demo video script (5 minutes)

Two parts, then one slide-style edit:

- **Part A: the cabinet** (about 1:20). One phone camera films the real cabinet: the Pi screen, the doors, the voice.
- **Part B: three phones, three roles** (about 3:00). Doctor, patient and family phones are screen-recorded **at the same time, same start, same end**, and shown side by side on one 16:9 slide so judges watch cause and effect: a tap on one phone, the result on another.

Intro and outro add about 40 seconds. Narration is recorded **afterwards** over the edited video.

---

## Who does what on filming day

| Role | Device | Logs in as | Job |
|---|---|---|---|
| **Doctor** | phone (ThuocTracker app) | `doctor@demo.com` / `demo1234` (Dr. Miller) | taps the doctor's steps |
| **Patient** | phone | `mary@demo.com` / `demo1234` (Mary Johnson, 78) | taps the patient's steps |
| **Family** | phone | `emily@demo.com` / `demo1234` (Emily, Mary's granddaughter) | taps the family's steps |
| **Operator** (off camera) | laptop, web dashboard `localhost:3000/doctor` as `doctor@demo.com` | | presses **Pill time now** when the script says |
| **Camera** | spare phone on a stand | | films the cabinet in Part A |
| **Narrator** | | | reads the lines below later, over the edit |

Mary's cabinet after a reset: **Aspirin** (blue, box 1, 8 AM), **Metformin** (red, box 2, 8 AM and 6 PM, only 4 left), **Atorvastatin** (white, box 3, 9 PM, expires in 5 days). Boxes 4-7 are free.

---

## Before you press record (15 minutes)

1. **One backend** runs (`.venv\Scripts\python -m uvicorn backend.main:app --host 0.0.0.0`), with `DEMO=1` in `.env` (a dose is missed after 30 seconds), and the Gemini, ElevenLabs and Ollama setup working (Ollama on the laptop that answers voice).
2. **Fresh demo data:** open `http://localhost:8000/docs` → `POST /demo/reset` → *Try it out* → *Execute*. This wipes the shared database for everyone, so tell the team first. Then **log in again** on all three phones and the dashboard (reset logs everyone out).
3. **Phones:** fully charged; **Do Not Disturb on**, but allow Expo Go / ThuocTracker; clear old notifications; screen brightness up; same font size on all three if possible.
4. **Screen recording with sound** (needed for syncing):
   - iPhone: Control Center → long-press the record button → **Microphone On**.
   - Android: screen recorder settings → **include microphone** (or "Device audio and microphone").
5. **A real bottle with a clear printed label** for scene 1, e.g. a vitamin bottle (name, "take 1 daily", quantity, expiration). Test-scan it once before filming.
6. Each phone starts on its **home tab**: Doctor on **Patients**, Patient on **Today**, Family on **Today**.
7. Do one full **practice run** without recording. Then reset again (step 2) and film.

---

## Part A: the cabinet (camera on a stand, about 1:20)

Frame: the whole cabinet with the Pi screen readable. Patient actor stands next to it.

| Time | What happens | Narrator |
|---|---|---|
| 0:00 | Cabinet idle, Today strip on the screen. | "This is ThuocTracker: a smart pill cabinet for older adults. Seven boxes, a touchscreen, a camera, a speaker and a microphone, run by a Raspberry Pi." |
| 0:12 | Operator presses **Pill time now** on Aspirin, then on Metformin (dashboard, off camera). | "It's 8 AM. Two pills are due." |
| 0:15 | The cabinet says *"Hi, Mary Johnson, please pay attention. You have a blue pill and a red pill. Aspirin and Metformin, now."* Box 1 glows and opens. | (let the cabinet speak, no narration) |
| 0:28 | Patient takes a candy from the open box. The door closes. | "The camera counts the pills before and after. One fewer means taken." |
| 0:40 | Screen: **Good job!** | "No buttons needed. If the camera can't tell, she can tap *I took it*." |
| 0:48 | Patient asks the cabinet: **"What do I need to take now?"** | |
| 0:52 | The cabinet answers out loud (the red pill, Metformin, box 2). | "She can just ask. Answers come only from her real dose log and schedule. The AI never changes a dose; it only reminds and informs." |
| 1:05 | Patient asks: **"Did I take my aspirin today?"** The cabinet answers. | "And it runs on a local AI model on our laptop, so her questions don't leave the house." |
| 1:20 | Cut. | |

---

## Part B: three phones at the same time (about 3:00)

**Start:** all three press screen record → wait 2 seconds → someone **claps once** near the phones → wait 2 seconds → begin scene 1. (The editor lines the three videos up on the clap.)

**Rhythm:** do the action, then **wait about 5 seconds** so the result arrives on the other phones and the viewer sees it. The apps refresh every few seconds. Don't talk over each other.

Each row: who taps, where the viewer should look (highlight that column in the edit), what the narrator says.

### Scene 1: the doctor adds a medicine by scanning the label (about 0:45)

| Doctor | Patient | Family | Narrator |
|---|---|---|---|
| **Patients** tab → tap **Mary Johnson** → **Today** tab → scroll to **Medicines** → **Scan a label** → photograph the bottle. | | | "Dr. Miller just prescribed a new medicine. She points her phone at the bottle." |
| The form fills in by itself (name, dose, time, expiration, pills). Pick **box 4** → pick its color → **Save to cabinet**. | | | "AI reads the label, so nobody types. She checks every field, picks a free box, and saves." |
| | **Today** → the new medicine appears under Medicines (scroll if needed). | **Today** → it appears for Emily too. | "It's in Mary's cabinet, and her granddaughter sees it right away." |

### Scene 2: pill time, two pills, one yes and one not yet (about 1:10)

| Doctor | Patient | Family | Narrator |
|---|---|---|---|
| | | | *(Operator presses **Pill time now** on Aspirin, then Metformin.)* "Pill time." |
| | Popup: **Did you take your 2 pills?** Aspirin and Metformin, each with Yes / Not yet. | Banner: **Pill time**. | "Mary's phone asks her. Emily is told too, because many older patients don't use a phone." |
| | Tap **Yes, I took it** on **Aspirin**. | | "Yes for the aspirin." |
| Tap **Mary Johnson** → **Today**: Aspirin shows **Taken**. | | | "The doctor sees it the moment Mary confirms." |
| | Tap **Not yet** on **Metformin**. Put the phone down. | | "Not yet for the metformin. The app will ask again in 30 minutes." |
| *(30 seconds pass: speed this up in the edit, caption "30 seconds later, demo mode")* | | | |
| Banner: **Mary Johnson missed Metformin**. Today shows Metformin **Missed**. | Banner: **Missed pill**. "Your family and doctor have been told." | Banner: **Mary Johnson missed Metformin**. | "No pill was removed, so it's marked missed. Emily and Dr. Miller are alerted. Mary is told too, but never 'take it now': a late pill can double up with the next one." |

### Scene 3: the doctor follows up with the family (about 0:35)

| Doctor | Patient | Family | Narrator |
|---|---|---|---|
| Back to **Patients** → tap **Emily (granddaughter)** → type: *"Hi Emily, Mary missed her metformin this morning. Could you check on her today?"* → send. | | Banner with Dr. Miller's message. | "Dr. Miller follows up with the family directly." |
| | | **Care team** → **Dr. Miller** → reply: *"Thanks, I'll call her now. She said she feels tired on it."* → send. | |
| Banner, and the reply appears in the chat. | | | "Doctor and family, in the same loop." |

### Scene 4: opening times and booking a visit (about 0:40)

| Doctor | Patient | Family | Narrator |
|---|---|---|---|
| **Schedule** tab → on the calendar tap **next Tuesday** → From **09:00** To **12:00** → **30 min** → Repeat **Every Tue, 13 weeks** → **Open these times**. | | | "Dr. Miller opens Tuesday mornings for the next three months, in one tap." |
| Note: *"Opened 78 times on 13 days."* Green Tuesdays on the calendar. | | | |
| | | **Visits** tab → the calendar shows green Tuesdays → tap **next Tuesday** → tap **10:00 AM** → Reason: *"Feeling tired on metformin"* → **Book …**. | "Emily books a visit for her grandmother, and says why." |
| Banner **New appointment**; the Tuesday on the calendar gets a dot; tap it to see Mary at 10:00 AM with the reason. | **Visits** → the visit shows under **Your visits**. | | "The doctor has it with the reason, and Mary sees it in her own app. One hour before, everyone gets a reminder." |

**End:** wait 2 seconds, stop all three recordings.

---

## Intro and outro (narrator over the dashboard or photos)

- **Intro (0:20):** "Older adults often forget pills or take them twice. Their doctor writes the prescription but never knows if it was taken, and their family worries but can't check all day. We built ThuocTracker to close that loop."
- **Outro (0:20):** "ThuocTracker: a cabinet that reminds and checks, a doctor who knows, and a family that's told. It never changes a dose; it only reminds and alerts. Next: a real iPhone app, pharmacy refills, and testing with families. We're [names], at HackPSU."

---

## Editing (Clipchamp on Windows, or CapCut)

1. Import the three Part B recordings; line them up on the clap's spike in the audio; cut all three at the same start and end.
2. **Layout:** three portrait videos side by side fill a 16:9 frame. Put labels on top: **DOCTOR | PATIENT | FAMILY**.
3. When something happens, **highlight that column** (a colored border or a short zoom) and dim the others a little.
4. **Speed up** waiting (the 30-second missed window, typing) and add a small caption saying so.
5. Mute the phones' own audio (the mics were only for syncing), then add the narration track.
6. Add **captions** for the narration and for what the cabinet says in Part A.
7. Order: Intro → Part A → Part B → Outro. Keep it **under 5:00**. Export 1080p and upload to YouTube as **Unlisted** for Devpost.

## If something goes wrong while filming

- **A banner doesn't show:** keep going; the change is still visible in the app a few seconds later (switch to that tab).
- **The label scan fails:** use **Type it in** and fill the fields; say "you can also type it in".
- **The cabinet's voice is silent:** the ElevenLabs key or the internet is down; the Pi plays its stored sound instead. Film again after fixing, or keep the take.
- **Something got wrong data:** stop, run `POST /demo/reset` again, everyone logs in again, start the scene over.
