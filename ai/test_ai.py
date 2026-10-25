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


def tags(*names):
    r = mock.Mock()
    r.json.return_value = {"models": [{"name": n} for n in names]}
    return r


# labels: no Ollama on this laptop -> Gemini
with mock.patch("ai.requests.get", side_effect=ai.requests.ConnectionError("no ollama")),         mock.patch("ai.requests.post", return_value=fake(json.dumps(
            {"name": "Aspirin", "dose": "1 pill", "times": ["08:00"], "expiration": "2027-01-01", "extra": 1}))) as p:
    assert ai.read_label(b"jpg") == {"name": "Aspirin", "dose": "1 pill", "times": ["08:00"], "expiration": "2027-01-01",
                                     "quantity": None}
    assert p.call_args.kwargs["json"]["generationConfig"]["responseMimeType"] == "application/json"

# labels: Ollama vision model, picked from what's installed (qwen2.5vl before gemma4), loose output cleaned up
loose = {"name": " Metformin ", "dose": "1 tablet", "times": ["8:00", "20:00", "noon"], "expiration": "1/31/2027",
         "quantity": "60 tablets"}
with mock.patch("ai.requests.get", return_value=tags("gemma4:e4b-mlx", "qwen2.5vl:7b")),         mock.patch("ai.requests.post", return_value=ollama(json.dumps(loose))) as p:
    assert ai.read_label(b"jpg") == {"name": "Metformin", "dose": "1 tablet", "times": ["08:00", "20:00"],
                                     "expiration": None, "quantity": 60}
    body = p.call_args.kwargs["json"]
    assert body["model"] == "qwen2.5vl:7b" and body["format"]["required"] == list(ai.LABEL_KEYS)
    assert body["messages"][0]["images"] == [base64.b64encode(b"jpg").decode()]
with mock.patch.dict(os.environ, {"OLLAMA_VISION_MODEL": "llava:13b"}),         mock.patch("ai.requests.post", return_value=ollama("{}")) as p:
    assert ai.read_label(b"jpg") == dict.fromkeys(ai.LABEL_KEYS)  # nothing readable: all null, nothing made up
    assert p.call_args.kwargs["json"]["model"] == "llava:13b"
# Ollama up but no vision model, and no Gemini key: the error reaches the backend (which tells the user)
with mock.patch("ai.requests.get", return_value=tags("gemma3:1b")), mock.patch.dict(os.environ, {"GEMINI_API_KEY": ""}):
    try:
        ai.read_label(b"jpg")
        raise AssertionError("no vision model and no Gemini must raise")
    except RuntimeError as e:
        assert "ollama pull" in str(e)

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
