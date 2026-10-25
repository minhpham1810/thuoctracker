"""AI functions. Pure in/out so each works alone; the backend wraps them in routes.

Labels: a local vision model on Ollama (Windows or Mac), Gemini if that laptop has no Ollama.
Pill counts: Gemini. Voice questions: local Gemma 4 on Ollama (speech-to-text and answers). ElevenLabs = voice.
.env: GEMINI_API_KEY, ELEVENLABS_API_KEY, OLLAMA_URL when Ollama runs on another laptop, and optionally
OLLAMA_VISION_MODEL to pick the label model (otherwise the first installed one in VISION_MODELS),
and OLLAMA_MODEL for voice when Ollama isn't on a Mac (see below).
"""
import base64
import io
import json
import os
import re
import time
from datetime import date, datetime

import requests
from dotenv import load_dotenv

load_dotenv()

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent"
GEMINI_MODEL = "gemini-3.5-flash"  # pill counts. 2.5 is closed to new keys; 3.8 timed out
# labels: the free tier allows flash only ~1-2 image requests a minute (shared by every laptop on this key), so
# scans kept failing with 429. Lite read 4/4 test labels right in ~7 s each, back to back (tested 2026-10-25).
GEMINI_LABEL_MODEL = "gemini-3.5-flash-lite"
# Ollama hears audio only on its MLX engine, so it must run on an Apple Silicon Mac
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
# Gemma 4 E4B hears and answers a question in ~0.5 s on an M5 Pro. 12b-mlx answers a bit better, but in
# Ollama 0.33.3 it mostly replied "I cannot hear any audio" (tested 2026-10-24).
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gemma4:e4b-mlx")
# Windows/Linux with an NVIDIA GPU: OLLAMA_MODEL=gemma4:e4b also hears audio on Ollama 0.40.5 (tested
# 2026-10-24 on an RTX 5070: exact transcripts, ~2 s per step once loaded, ~30 s for the first load).
# label reading: first installed match wins. gemma4 first: the Mac already has gemma4:e4b-mlx for voice, so labels
# reuse the loaded model (MLX runs only on Apple Silicon; Windows pulls the regular gemma4:e4b).
VISION_MODELS = ("gemma4", "qwen2.5vl", "llama3.2-vision", "minicpm-v", "llava")
VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")  # "Rachel", a calm default voice
# flash: a one-sentence answer in ~0.75 s vs ~1.6-2 s for eleven_multilingual_v2 (measured 2026-10-25),
# so the cabinet speaks right after the answer is ready
VOICE_MODEL = os.getenv("ELEVENLABS_MODEL", "eleven_flash_v2_5")
DONT_KNOW = "I don't know, please ask your doctor."
DIDNT_HEAR = "Sorry, I didn't hear a question. Please try again."
NO_DOSES = "There are no doses in your log yet."
# Guards on answer(): with an empty or short log, Gemma 4 invented doses ("You took metformin at 8:00 AM and
# 8:00 PM" for a patient with no doses and no metformin, 6 of 6 tries). Every medicine, pill color and time
# an answer mentions must be in the dose log, or the answer becomes DONT_KNOW.
COMMON_DRUGS = {
    "acetaminophen", "advil", "albuterol", "allopurinol", "alprazolam", "amlodipine", "amoxicillin", "aspirin",
    "atenolol", "atorvastatin", "carvedilol", "cetirizine", "citalopram", "clopidogrel", "digoxin", "donepezil",
    "escitalopram", "furosemide", "gabapentin", "glipizide", "hydrochlorothiazide", "ibuprofen", "insulin",
    "levothyroxine", "lisinopril", "loratadine", "losartan", "lovastatin", "meloxicam", "memantine", "metformin",
    "metoprolol", "montelukast", "naproxen", "omeprazole", "pantoprazole", "paracetamol", "pravastatin",
    "prednisone", "rosuvastatin", "sertraline", "simvastatin", "tamsulosin", "tramadol", "trazodone", "tylenol",
    "vitamin", "warfarin", "zolpidem"}
PILL_COLORS = {"blue", "red", "yellow", "green", "white", "orange", "pink", "purple", "brown", "black", "gray", "grey"}
_PARTS = r"a\.?m\.?|p\.?m\.?|in the morning|in the afternoon|in the evening|at night"
# a number is only a time with minutes or a part of the day ("8:00", "8 AM", "6:40 in the evening"), not "2 pills"
TIME_RE = re.compile(rf"\b(\d{{1,2}})(?::(\d{{2}}))?\s*({_PARTS})(?![a-z])|\b(\d{{1,2}}):(\d{{2}})\b|\b(noon|midnight)\b",
                     re.I)


def _gemini(prompt: str, data: bytes = None, mime: str = None, as_json: bool = False, model: str = GEMINI_MODEL) -> str:
    parts = [{"text": prompt}]
    if data:
        parts.append({"inline_data": {"mime_type": mime, "data": base64.b64encode(data).decode()}})
    body = {"contents": [{"parts": parts}], "generationConfig": {"temperature": 0}}
    if as_json:
        body["generationConfig"]["responseMimeType"] = "application/json"
    for attempt in (1, 2):
        # key in a header, not the URL, so it never shows up in error messages or logs
        r = requests.post(GEMINI_URL.format(model), headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]}, json=body, timeout=30)
        if r.status_code == 429 and attempt == 1:  # free tier: only a few requests a minute; wait and try once more
            time.sleep(_retry_after(r))
            continue
        break
    r.raise_for_status()
    parts = r.json()["candidates"][0]["content"]["parts"]
    return "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()


def _retry_after(r) -> float:
    """Seconds Gemini asks us to wait ("retryDelay": "12s"), capped so the phone isn't kept waiting long."""
    try:
        for d in r.json()["error"]["details"]:
            if "retryDelay" in d:
                return min(float(d["retryDelay"].rstrip("s")), 15)
    except Exception:
        pass
    return 5


def _why(e: Exception) -> str:
    """Short reason for the person scanning: "429 Too Many Requests", "not running"..."""
    if isinstance(e, requests.HTTPError) and e.response is not None:
        return f"{e.response.status_code} {e.response.reason}"
    if isinstance(e, requests.ConnectionError):
        return "not running"
    return str(e)[:120]


def _ollama(messages: list[dict], model: str = OLLAMA_MODEL, format=None, timeout: int = 60) -> str:
    body = {"model": model, "messages": messages, "stream": False, "think": False,
            "keep_alive": -1,  # never unload: after "1h" idle, the next question waited ~30 s for a reload
            "options": {"temperature": 0}}
    if format:
        body["format"] = format  # JSON schema: Ollama constrains the output to it
    r = requests.post(f"{OLLAMA_URL}/api/chat", json=body, timeout=timeout)
    if not r.ok:  # Ollama's text says why: model not pulled, audio not WAV...
        raise RuntimeError(f"Ollama {r.status_code}: {r.text[:200]}")
    return r.json()["message"]["content"].strip()


LABEL_PROMPT = (
    "This is a prescription bottle label. Return JSON with exactly these keys: "
    '"name" (medicine name, e.g. "Aspirin"), "dose" (amount per dose, e.g. "1 pill"), '
    '"times" (list of 24h "HH:MM" times per day from the directions; once daily = ["08:00"], '
    'twice = ["08:00","20:00"], three times = ["08:00","14:00","20:00"]), '
    '"expiration" ("YYYY-MM-DD", or null if not printed), '
    '"quantity" (number of pills in the bottle, e.g. QTY 30 -> 30, or null). Use null for anything unreadable.')
LABEL_KEYS = ("name", "dose", "times", "expiration", "quantity")
LABEL_SCHEMA = {"type": "object", "required": list(LABEL_KEYS), "properties": {
    "name": {"type": ["string", "null"]}, "dose": {"type": ["string", "null"]},
    "times": {"type": ["array", "null"], "items": {"type": "string"}},
    "expiration": {"type": ["string", "null"]}, "quantity": {"type": ["integer", "null"]}}}


def read_label(image: bytes) -> dict:
    """Label photo -> {name, dose, times, expiration, quantity}. A draft: a person checks it before saving.
    Local Ollama vision model first; Gemini if this laptop has no Ollama or no vision model."""
    try:
        out = json.loads(_ollama([{"role": "user", "content": LABEL_PROMPT,
                                   "images": [base64.b64encode(_shrink(image)).decode()]}],
                                 model=_vision_model(), format=LABEL_SCHEMA, timeout=120))  # CPU-only laptops are slow
    except Exception as e:
        if not os.getenv("GEMINI_API_KEY"):
            raise RuntimeError(f"local model: {_why(e)}") from e
        print(f"[ai] Ollama label read failed ({e!r}); using Gemini")
        try:
            # shrunk too: a full phone photo uses up the free tier's per-minute allowance in one or two scans
            out = json.loads(_gemini(LABEL_PROMPT, _shrink(image), "image/jpeg", as_json=True, model=GEMINI_LABEL_MODEL))
        except Exception as e2:
            raise RuntimeError(f"local model: {_why(e)}; Gemini: {_why(e2)}") from e2
    return _clean_label(out)


def _vision_model() -> str:
    """OLLAMA_VISION_MODEL, else the first installed model in VISION_MODELS."""
    if os.getenv("OLLAMA_VISION_MODEL"):
        return os.environ["OLLAMA_VISION_MODEL"]
    installed = [m["name"] for m in requests.get(f"{OLLAMA_URL}/api/tags", timeout=3).json().get("models", [])]
    for family in VISION_MODELS:
        for name in installed:
            if name.startswith(family):
                return name
    raise RuntimeError(f"no vision model in Ollama ({installed}); run: ollama pull gemma4:e4b")


def _shrink(image: bytes, longest: int = 1280) -> bytes:
    """Phone photos are ~4000 px; local vision models are much faster on ~1280 and still read the label."""
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(image))
        if max(img.size) <= longest:
            return image
        img.thumbnail((longest, longest))
        buf = io.BytesIO()
        img.convert("RGB").save(buf, "JPEG", quality=85)
        return buf.getvalue()
    except Exception:  # no Pillow or not a readable image: send it as is
        return image


def _clean_label(out: dict) -> dict:
    """Small local models format loosely ("8:00", "1/31/2027", "30 tablets"): keep only what the form accepts."""
    def text(v):
        return v.strip() if isinstance(v, str) and v.strip() else None

    times = []
    for t in out.get("times") or []:
        m = re.fullmatch(r"\s*(\d{1,2}):(\d{2})\s*", str(t))
        if m and int(m[1]) < 24 and int(m[2]) < 60:
            times.append(f"{int(m[1]):02d}:{m[2]}")
    expiration = text(out.get("expiration"))
    try:
        expiration = date.fromisoformat(expiration).isoformat() if expiration else None
    except ValueError:
        expiration = None
    q = re.search(r"\d+", str(out.get("quantity"))) if out.get("quantity") is not None else None
    return {"name": text(out.get("name")), "dose": text(out.get("dose")), "times": times or None,
            "expiration": expiration, "quantity": int(q[0]) if q and int(q[0]) > 0 else None}


def count_pills(image: bytes) -> int:
    """Slot photo -> number of pills visible."""
    out = json.loads(_gemini(
        'Count the pills (small candies/tablets) in this photo of a pill slot. '
        'Count each one separately, including ones touching or partly hidden. '
        'Return JSON: {"count": <integer>}. If the slot is empty, count is 0.',
        image, "image/jpeg", as_json=True))
    return int(out["count"])


def transcribe(audio: bytes) -> str:
    """Question audio -> text ("" if nobody spoke). WAV only (Ollama decodes nothing else): the Pi and the
    cabinet screen send 16 kHz mono."""
    if audio[:4] != b"RIFF":
        raise ValueError("audio must be WAV")
    return _ollama([
        # Ollama's own transcription prompt (the audio is a question: don't answer it here), plus:
        # "English" stops odd voices coming back as Japanese; the context turns "aspirant" into "aspirin"
        {"role": "system", "content": "Transcribe the audio exactly as spoken. Output only the spoken words. "
                                      "Do not answer any question in the audio. The audio is in English. "
                                      "If nobody speaks, output nothing. Context: an older adult asking their "
                                      "pill cabinet about their medicines and doses."},
        {"role": "user", "content": "What exact words are spoken in this audio?",
         "images": [base64.b64encode(audio).decode()]}])


def answer(question: str, dose_log: list[dict], medicines: list[dict] = ()) -> str:
    """Answer ONLY from the patient's real data. Never advise or change a dose.

    dose_log items, newest first: {"medicine", "color", "due_at", "status", "taken_at"} (see TEAM.md).
    medicines: the cabinet's Medicine rows as JSON ({"name", "color", "dose", "times", "slot", "pills_left",
    "expiration"}), so it can also say what's next, which box, and how many are left.
    """
    if not question.strip():
        return DIDNT_HEAR
    log = dose_log[:50]
    if not log and not medicines:
        return NO_DOSES  # from the data: nothing for the model to read, so it can only make things up
    now = datetime.now()
    meds, today, schedule = [], [], []  # schedule: today's pill times in the log's shape, for the checks below
    for m in medicines:
        pill = f"{m['name']} ({m['color']} pill)"
        at = sorted(now.replace(hour=int(t[:2]), minute=int(t[3:]), second=0, microsecond=0) for t in m["times"])
        exp = date.fromisoformat(m["expiration"])
        meds.append(f"- {pill}: {m['dose']} at {' and '.join(map(_clock, at))}, box {m['slot']}, "
                    f"{m['pills_left']} pills left, expires {exp:%B} {exp.day}, {exp.year}")
        for t in at:
            schedule.append({"medicine": m["name"], "color": m["color"], "due_at": t.isoformat(), "taken_at": None})
            # today's doses worked out here: left to guess from the times, the model called later doses
            # "missed" and gave an 8 AM dose as taken at 2 AM
            row = next((x for x in log if x["medicine"] == m["name"] and x["due_at"][:16] == t.isoformat()[:16]), None)
            today.append((t, pill, _did(row) if row else "still to come" if t > now else "not in the log"))
    today.sort()
    # the next pill too (left alone, the model said "your next dose is not listed in the log")
    nxt = next(((t, p) for t, p, did in today if did == "still to come"), None)
    if nxt:
        next_pill = f"Next pill: {nxt[1]} at {_clock(nxt[0])} today."
    elif today:
        next_pill = f"Next pill: tomorrow, {today[0][1]} at {_clock(today[0][0])}."
    names = {x["medicine"].lower() for x in log + schedule}
    # asking about a medicine that isn't in the log: answer from the data too (the model invented doses for it)
    for drug in sorted(_drugs_in(question)):
        if not _in_log(drug, names):
            return f"Your log doesn't mention {drug}."
    lines = []
    # small local models get days wrong from raw timestamps ("yesterday" became "today"), so Python writes
    # "Yesterday, 8 in the morning" and the model only reads. Newest 50: Ollama's default context is 4096 tokens.
    for x in log:
        due = datetime.fromisoformat(x["due_at"])
        # without the color the model guessed which pill was "the red one", and got it wrong
        pill = f"{x['medicine']} ({x['color']} pill)" if x.get("color") else x["medicine"]
        lines.append(f"- {_day(due, now)}, {_clock(due)}: {pill}, {_did(x)}")
    cabinet = ""
    if medicines:
        cabinet = ("Medicines the patient takes (every pill time, box, pills left, expiry):\n" + "\n".join(meds) + "\nToday's pills:\n"
                   + "\n".join(f"- {_clock(t)}: {p}, {did}" for t, p, did in today) + f"\n{next_pill}\n")
    text = _ollama([
        {"role": "system", "content":
            "You are the voice of a pill cabinet, talking to an elderly patient. Answer in one or two short, kind "
            "sentences, using only the medicines and dose log you are given. Mention every dose the question covers, "
            "missed ones too. Say times exactly as they are written. For today's doses, go by Today's pills. "
            "Never tell the patient to take, skip, double or change any dose, and never give medical advice. "
            "If the question asks for advice (like whether to take a pill now), or what you are given does not "
            f'answer it, reply with exactly this sentence and nothing else: "{DONT_KNOW}" '
            # the Pi raises quiet recordings up to 20x, so people talking across the room come through clearly
            "If the words are not a question to you about the patient's medicines or pills (for example people "
            f'talking to each other nearby), reply with exactly this sentence and nothing else: "{DIDNT_HEAR}"'},
        {"role": "user", "content": f"It is now {now:%A %B} {now.day}, {_clock(now)}.\n" + cabinet
                                    + "Dose log, newest first:\n" + ("\n".join(lines) or "- no doses yet")
                                    + f"\n\nQuestion: {question}"}])
    # a refusal is exact: the small model sometimes adds "facts" before it, once a dose that never existed
    if DIDNT_HEAR.rstrip(".") in text:
        return DIDNT_HEAR
    if DONT_KNOW.rstrip(".") in text:
        return DONT_KNOW
    why = _ungrounded(text, log + schedule, now)
    if why:
        print(f"[ai] answer not in the dose log ({why}), said DONT_KNOW instead: {text!r}")
        return DONT_KNOW
    return text


def _did(x: dict) -> str:
    """What happened to one dose-log entry, in words."""
    taken = f"taken at {_clock(datetime.fromisoformat(x['taken_at']))}" if x["taken_at"] else "taken"
    return {"taken": taken, "missed": "missed", "pending": "due now, not taken yet"}.get(x["status"], x["status"])


def _drugs_in(text: str) -> set[str]:
    return set(re.findall(r"[a-z]+", text.lower())) & COMMON_DRUGS


def _in_log(word: str, names: set[str]) -> bool:
    return any(word in n or n in word for n in names)  # "vitamin" is in "vitamin d"


def _times_in(text: str) -> list[tuple[int, int, bool]]:
    """(hour 0-23, minute, sure) for each time in an answer; sure=False for a bare "8:00" (8 or 20)."""
    out = []
    for h, m, part, h2, m2, word in TIME_RE.findall(text):
        if word:
            out.append((12 if word.lower() == "noon" else 0, 0, True))
            continue
        if h2:
            hour, minute = int(h2), int(m2)
            out.append((hour % 24, minute, hour > 12 or hour == 0))
            continue
        hour, minute, part = int(h), int(m or 0), part.lower().replace(".", "")
        if part == "am" or part == "in the morning":
            hour %= 12
        elif part == "pm" or part == "in the evening":
            hour = hour % 12 + 12
        elif part == "in the afternoon":
            hour = 12 if hour == 12 else hour + 12
        elif part == "at night":  # _clock: before 4 or from 9 at night
            hour = 0 if hour == 12 else hour + 12 if hour >= 9 else hour
        out.append((hour, minute, True))
    return out


def _ungrounded(text: str, log: list[dict], now: datetime) -> str:
    """Why an answer isn't backed by the dose log ("" if it is): every medicine, pill color and time it names
    must be in the log or the schedule answer() adds to it (a time can also be "now")."""
    names = {x["medicine"].lower() for x in log}
    for drug in _drugs_in(text):
        if not _in_log(drug, names):
            return f"medicine {drug}"
    colors = {(x.get("color") or "").lower() for x in log}
    for color in set(re.findall(r"[a-z]+", text.lower())) & PILL_COLORS:
        if color not in colors:
            return f"color {color}"
    times = {(now.hour, now.minute)}
    for x in log:
        for stamp in (x["due_at"], x["taken_at"]):
            if stamp:
                d = datetime.fromisoformat(stamp)
                times.add((d.hour, d.minute))
    for hour, minute, sure in _times_in(text):
        if (hour, minute) not in times and (sure or (hour + 12, minute) not in times):
            return f"time {hour}:{minute:02d}"
    return ""


def _clock(d: datetime) -> str:
    """'8 in the morning', '6:40 in the evening': already spoken, so the model can't turn 9 PM into morning."""
    part = ("at night" if d.hour < 4 or d.hour >= 21 else "in the morning" if d.hour < 12
            else "in the afternoon" if d.hour < 17 else "in the evening")
    minutes = f":{d.minute:02d}" if d.minute else ""
    return f"{d.hour % 12 or 12}{minutes} {part}"


def _day(d: datetime, now: datetime) -> str:
    return {0: "Today", 1: "Yesterday"}.get((now.date() - d.date()).days, f"{d:%A %B} {d.day}")


def speak(text: str) -> bytes:
    """Text -> MP3 bytes. ElevenLabs."""
    r = requests.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}",
        headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"], "accept": "audio/mpeg"},
        json={"text": text, "model_id": VOICE_MODEL}, timeout=30)
    r.raise_for_status()
    return r.content
