"""Offline check: fakes Gemini/Ollama/ElevenLabs HTTP, tests our parsing. Run: python -m ai.test_ai"""
import base64
import json
import os
from datetime import date, datetime, timedelta
from unittest import mock

import ai

os.environ.setdefault("GEMINI_API_KEY", "x")
os.environ.setdefault("ELEVENLABS_API_KEY", "x")


def fake(text=None, content=b""):
    r = mock.Mock(content=content)
    r.json.return_value = {"candidates": [{"content": {"parts": [{"text": text}]}}]}
    return r


def ollama(text, ok=True):
    r = mock.Mock(ok=ok, status_code=200 if ok else 404, text=text)
    r.json.return_value = {"message": {"content": text}}
    return r


with mock.patch("ai.requests.post", return_value=fake(json.dumps(
        {"name": "Aspirin", "dose": "1 pill", "times": ["08:00"], "expiration": "2027-01-01", "extra": 1}))) as p:
    assert ai.read_label(b"jpg") == {"name": "Aspirin", "dose": "1 pill", "times": ["08:00"], "expiration": "2027-01-01",
                                     "quantity": None}
    assert p.call_args.kwargs["json"]["generationConfig"]["responseMimeType"] == "application/json"

with mock.patch("ai.requests.post", return_value=fake('{"count": 5}')):
    assert ai.count_pills(b"jpg") == 5

wav = b"RIFF\x24\x00\x00\x00WAVEfmt "
with mock.patch("ai.requests.post", return_value=ollama(" did I take my aspirin \n")) as p:
    assert ai.transcribe(wav) == "did I take my aspirin"
    msgs = p.call_args.kwargs["json"]["messages"]
    assert msgs[1]["images"] == [base64.b64encode(wav).decode()] and "Do not answer" in msgs[0]["content"]
try:
    ai.transcribe(b"\x1aE\xdf\xa3webm")
    raise AssertionError("non-WAV audio must be refused")
except ValueError:
    pass

today, yesterday = date.today(), date.today() - timedelta(days=1)
with mock.patch("ai.requests.post", return_value=ollama("Yes, at 8 in the morning.")) as p:
    log = [{"medicine": "Aspirin", "color": "blue", "due_at": f"{today}T08:00:00", "status": "taken",
            "taken_at": f"{today}T08:03:00"},
           {"medicine": "Metformin", "color": "red", "due_at": f"{yesterday}T12:00:00", "status": "missed",
            "taken_at": None}]
    assert ai.answer("Did I take my aspirin?", log) == "Yes, at 8 in the morning."
    user = p.call_args.kwargs["json"]["messages"][1]["content"]
    # days, clock times and colors are worked out here, not guessed by the model
    assert ("- Today, 8 in the morning: Aspirin (blue pill), taken at 8:03 in the morning\n"
            "- Yesterday, 12 in the afternoon: Metformin (red pill), missed") in user, user
    assert ai.answer("  ", log) == ai.DIDNT_HEAR
assert [ai._clock(datetime(2026, 1, 1, h, m)) for h, m in [(0, 30), (4, 0), (12, 0), (20, 59), (21, 1)]] == [
    "12:30 at night", "4 in the morning", "12 in the afternoon", "8:59 in the evening", "9:01 at night"]
with mock.patch("ai.requests.post", return_value=ollama("You took Aspirin at 8 in the afternoon. " + ai.DONT_KNOW)):
    assert ai.answer("Should I take another aspirin?", log) == ai.DONT_KNOW  # nothing extra rides on a refusal

with mock.patch("ai.requests.post", return_value=ollama("model 'gemma4:12b-mlx' not found", ok=False)):
    try:
        ai.answer("Did I take my aspirin?", log)
        raise AssertionError("an Ollama error must raise")
    except RuntimeError as e:
        assert "not found" in str(e)  # the backend log says why

with mock.patch("ai.requests.post", return_value=fake(content=b"ID3mp3")) as p:
    assert ai.speak("hi") == b"ID3mp3"
    assert "text-to-speech" in p.call_args.args[0]

print("ai ok")
