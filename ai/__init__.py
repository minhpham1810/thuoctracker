"""AI functions. Pure in/out so each works alone; the backend wraps them in routes.

Labels: a local vision model on Ollama (Windows or Mac), Gemini if that laptop has no Ollama.
Pill counts: Gemini. Voice questions: local Gemma 4 on Ollama (speech-to-text and answers). ElevenLabs = voice.
.env: GEMINI_API_KEY, ELEVENLABS_API_KEY, OLLAMA_URL when Ollama runs on another laptop, and optionally
OLLAMA_VISION_MODEL to pick the label model (otherwise the first installed one in VISION_MODELS).
"""
import base64
import io
import json
import os
import re
from datetime import date, datetime

import requests
from dotenv import load_dotenv

load_dotenv()

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent"  # 2.5 is closed to new keys; 3.8 timed out
# Ollama hears audio only on its MLX engine, so it must run on an Apple Silicon Mac
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
# Gemma 4 E4B hears and answers a question in ~0.5 s on an M5 Pro. 12b-mlx answers a bit better, but in
# Ollama 0.33.3 it mostly replied "I cannot hear any audio" (tested 2026-10-24).
OLLAMA_MODEL = "gemma4:e4b-mlx"
# label reading: first installed match wins. qwen2.5vl reads small print best and runs on Windows and Mac
# (`ollama pull qwen2.5vl:7b`); gemma4 is what the Mac already has for voice.
VISION_MODELS = ("qwen2.5vl", "gemma4", "llama3.2-vision", "minicpm-v", "llava")
VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")  # "Rachel", a calm default voice
DONT_KNOW = "I don't know, please ask your doctor."
DIDNT_HEAR = "Sorry, I didn't hear a question. Please try again."


def _gemini(prompt: str, data: bytes = None, mime: str = None, as_json: bool = False) -> str:
    parts = [{"text": prompt}]
    if data:
        parts.append({"inline_data": {"mime_type": mime, "data": base64.b64encode(data).decode()}})
    body = {"contents": [{"parts": parts}], "generationConfig": {"temperature": 0}}
    if as_json:
        body["generationConfig"]["responseMimeType"] = "application/json"
    # key in a header, not the URL, so it never shows up in error messages or logs
    r = requests.post(GEMINI_URL, headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]}, json=body, timeout=30)
    r.raise_for_status()
    parts = r.json()["candidates"][0]["content"]["parts"]
    return "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()


def _ollama(messages: list[dict], model: str = OLLAMA_MODEL, format=None, timeout: int = 60) -> str:
    body = {"model": model, "messages": messages, "stream": False, "think": False,
            "keep_alive": "1h",  # stay loaded: a cold load adds seconds to the first question
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
            raise
        print(f"[ai] Ollama label read failed ({e!r}); using Gemini")
        out = json.loads(_gemini(LABEL_PROMPT, image, "image/jpeg", as_json=True))
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
    raise RuntimeError(f"no vision model in Ollama ({installed}); run: ollama pull qwen2.5vl:7b")


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


def answer(question: str, dose_log: list[dict]) -> str:
    """Answer ONLY from the real dose log. Never advise or change a dose.

    dose_log items, newest first: {"medicine", "color", "due_at", "status", "taken_at"} (see TEAM.md).
    """
    if not question.strip():
        return DIDNT_HEAR
    now = datetime.now()
    lines = []
    # small local models get days wrong from raw timestamps ("yesterday" became "today"), so Python writes
    # "Yesterday, 8 in the morning" and the model only reads. Newest 50: Ollama's default context is 4096 tokens.
    for x in dose_log[:50]:
        due = datetime.fromisoformat(x["due_at"])
        taken = f"taken at {_clock(datetime.fromisoformat(x['taken_at']))}" if x["taken_at"] else "taken"
        did = {"taken": taken, "missed": "missed", "pending": "due now, not taken yet"}.get(x["status"], x["status"])
        # without the color the model guessed which pill was "the red one", and got it wrong
        pill = f"{x['medicine']} ({x['color']} pill)" if x.get("color") else x["medicine"]
        lines.append(f"- {_day(due, now)}, {_clock(due)}: {pill}, {did}")
    text = _ollama([
        {"role": "system", "content":
            "You are the voice of a pill cabinet, talking to an elderly patient. Answer in one or two short, kind "
            "sentences, using only the dose log you are given. Mention every dose the question covers, missed ones "
            "too. Say times exactly as the log writes them. Never tell the patient to take, skip, "
            "double or change any dose, and never give medical advice. If the question asks what to do (like whether "
            "to take a pill now), or the log does not answer it, reply with exactly this sentence and nothing else: "
            f'"{DONT_KNOW}"'},
        {"role": "user", "content": f"It is now {now:%A %B} {now.day}, {_clock(now)}.\nDose log, newest first:\n"
                                    + "\n".join(lines) + f"\n\nQuestion: {question}"}])
    # a refusal is exact: the small model sometimes adds "facts" before it, once a dose that never existed
    return DONT_KNOW if DONT_KNOW.rstrip(".") in text else text


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
        json={"text": text, "model_id": "eleven_multilingual_v2"}, timeout=30)
    r.raise_for_status()
    return r.content
