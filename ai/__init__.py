"""AI functions. Pure in/out so each works alone; the backend wraps them in routes.

Gemini = vision, speech-to-text and answers. ElevenLabs = voice (text -> MP3).
Keys come from .env: GEMINI_API_KEY, ELEVENLABS_API_KEY.
"""
import base64
import json
import os

import requests
from dotenv import load_dotenv

load_dotenv()

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent"  # 2.5 is closed to new keys; 3.8 timed out
VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")  # "Rachel", a calm default voice
DONT_KNOW = "I don't know, please ask your doctor."


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


def read_label(image: bytes) -> dict:
    """Label photo -> {name, dose, times, expiration, quantity}. A draft: a person checks it before saving."""
    out = json.loads(_gemini(
        "This is a prescription bottle label. Return JSON with exactly these keys: "
        '"name" (medicine name, e.g. "Aspirin"), "dose" (amount per dose, e.g. "1 pill"), '
        '"times" (list of 24h "HH:MM" times per day from the directions; once daily = ["08:00"], '
        'twice = ["08:00","20:00"], three times = ["08:00","14:00","20:00"]), '
        '"expiration" ("YYYY-MM-DD", or null if not printed), '
        '"quantity" (number of pills in the bottle, e.g. QTY 30 -> 30, or null). Use null for anything unreadable.',
        image, "image/jpeg", as_json=True))
    return {k: out.get(k) for k in ("name", "dose", "times", "expiration", "quantity")}


def count_pills(image: bytes) -> int:
    """Slot photo -> number of pills visible."""
    out = json.loads(_gemini(
        'Count the pills (small candies/tablets) in this photo of a pill slot. '
        'Count each one separately, including ones touching or partly hidden. '
        'Return JSON: {"count": <integer>}. If the slot is empty, count is 0.',
        image, "image/jpeg", as_json=True))
    return int(out["count"])


def _audio_mime(audio: bytes) -> str:
    """Guess the format from the first bytes: Pi sends WAV, Chrome WebM, Safari MP4."""
    if audio[:4] == b"RIFF": return "audio/wav"
    if audio[:4] == b"\x1aE\xdf\xa3": return "audio/webm"
    if audio[:4] == b"OggS": return "audio/ogg"
    if audio[4:8] == b"ftyp": return "audio/mp4"
    if audio[:3] == b"ID3" or audio[:1] == b"\xff": return "audio/mp3"
    return "audio/wav"


def transcribe(audio: bytes, mime: str = None) -> str:
    """Question audio (WAV, WebM, MP4, OGG or MP3) -> text."""
    return _gemini("Transcribe this spoken question word for word. Return only the text.",
                   audio, mime or _audio_mime(audio))


def answer(question: str, dose_log: list[dict]) -> str:
    """Answer ONLY from the real dose log. Never advise or change a dose.

    dose_log items: {"medicine", "due_at", "status", "taken_at"} (see TEAM.md).
    """
    if not question.strip():
        return DONT_KNOW
    return _gemini(
        "You are the voice of a pill cabinet talking to an elderly patient. "
        "Answer in one or two short, kind sentences, using ONLY the dose log below. "
        "Times are in the patient's local time; say them like '8 in the morning'. "
        "Never tell them to take, skip, double, or change any dose, and never give medical advice. "
        f'If the log does not answer the question, or it asks for advice, reply exactly: "{DONT_KNOW}"\n\n'
        f"Dose log (JSON): {json.dumps(dose_log, default=str)}\n\nQuestion: {question}")


def speak(text: str) -> bytes:
    """Text -> MP3 bytes. ElevenLabs."""
    r = requests.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}",
        headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"], "accept": "audio/mpeg"},
        json={"text": text, "model_id": "eleven_multilingual_v2"}, timeout=30)
    r.raise_for_status()
    return r.content
