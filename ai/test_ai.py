"""Offline check: fakes Gemini/ElevenLabs HTTP, tests our parsing. Run: python -m ai.test_ai"""
import json
import os
from unittest import mock

import ai

os.environ.setdefault("GEMINI_API_KEY", "x")
os.environ.setdefault("ELEVENLABS_API_KEY", "x")


def fake(text=None, content=b""):
    r = mock.Mock(content=content)
    r.json.return_value = {"candidates": [{"content": {"parts": [{"text": text}]}}]}
    return r


with mock.patch("ai.requests.post", return_value=fake(json.dumps(
        {"name": "Aspirin", "dose": "1 pill", "times": ["08:00"], "expiration": "2027-01-01", "extra": 1}))) as p:
    assert ai.read_label(b"jpg") == {"name": "Aspirin", "dose": "1 pill", "times": ["08:00"], "expiration": "2027-01-01"}
    assert p.call_args.kwargs["json"]["generationConfig"]["responseMimeType"] == "application/json"

with mock.patch("ai.requests.post", return_value=fake('{"count": 5}')):
    assert ai.count_pills(b"jpg") == 5

with mock.patch("ai.requests.post", return_value=fake(" did I take my aspirin \n")):
    assert ai.transcribe(b"wav") == "did I take my aspirin"

with mock.patch("ai.requests.post", return_value=fake("Yes, at 8 in the morning.")) as p:
    log = [{"medicine": "Aspirin", "due_at": "2026-10-24T08:00", "status": "taken", "taken_at": "2026-10-24T08:03"}]
    assert ai.answer("Did I take my aspirin?", log) == "Yes, at 8 in the morning."
    assert "Aspirin" in p.call_args.kwargs["json"]["contents"][0]["parts"][0]["text"]
    assert ai.answer("  ", log) == ai.DONT_KNOW

with mock.patch("ai.requests.post", return_value=fake(content=b"ID3mp3")) as p:
    assert ai.speak("hi") == b"ID3mp3"
    assert "text-to-speech" in p.call_args.args[0]

for head, mime in [(b"RIFF....", "audio/wav"), (b"\x1aE\xdf\xa3", "audio/webm"), (b"\0\0\0\x18ftypmp42", "audio/mp4"),
                   (b"OggS", "audio/ogg"), (b"ID3", "audio/mp3")]:
    assert ai._audio_mime(head) == mime, head

print("ai ok")
