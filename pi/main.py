"""Cabinet runtime on the Raspberry Pi 5. No AI here (1GB RAM): take photos and
recordings, send them to the backend, play what comes back.

Run:   BACKEND_URL=http://<laptop-ip>:8000 PATIENT_ID=1 python pi/main.py
Mock:  MOCK=1 python pi/main.py                  every part faked (runs on a laptop)
       MOCK=servo,audio python pi/main.py        fake only the parts not wired yet
Bench: python pi/main.py servo 2   |   python pi/main.py snap
"""
import os
import shutil
import subprocess
import sys
import time

import requests

BACKEND = os.environ.get("BACKEND_URL", "http://localhost:8000")
PATIENT_ID = int(os.environ.get("PATIENT_ID", "1"))
TAKE_SECONDS = int(os.environ.get("TAKE_SECONDS", "10"))  # slot stays open this long

# Parts: servo, camera, audio. MOCK=1 fakes all of them.
_mock = os.environ.get("MOCK", "")
MOCK = {"servo", "camera", "audio"} if _mock in ("1", "all") else set(filter(None, _mock.split(",")))

HERE = os.path.dirname(os.path.abspath(__file__))
SOUNDS = os.path.join(HERE, "sounds")  # time_for_pill.mp3, good_job.mp3, already_took.mp3, missed.mp3
MOCK_PHOTO = os.path.join(HERE, "mock", "slot.jpg")

# Boxes 1-3 top row, 4-6 middle row, 7 the long bottom box. Box n is wired to
# PCA9685 channel n-1. Calibrate angles on the real cabinet.
SLOT_CHANNELS = {n: n - 1 for n in range(1, 8)}
CLOSED_ANGLE = 0
OPEN_ANGLE = 90

# Hardware is opened on first use so this file still imports on a laptop.
_kit = None
_cam = None


def _servos():
    global _kit
    if _kit is None:
        from adafruit_servokit import ServoKit

        _kit = ServoKit(channels=16)
        for ch in SLOT_CHANNELS.values():
            # SG90/MG90S want ~500-2500us; the library default (750-2250) under-travels
            _kit.servo[ch].set_pulse_width_range(500, 2500)
    return _kit


def _move(slot: int, angle: int):
    if slot not in SLOT_CHANNELS:
        raise ValueError(f"slot must be 1-7, got {slot}")
    if "servo" in MOCK:
        print(f"[mock] slot {slot} -> {angle} deg")
        return
    _servos().servo[SLOT_CHANNELS[slot]].angle = angle


def open_slot(slot: int):
    """Move servo `slot` (1-7) via the PCA9685 over I2C."""
    _move(slot, OPEN_ANGLE)


def close_slot(slot: int):
    _move(slot, CLOSED_ANGLE)


def _camera():
    global _cam
    if _cam is None:
        from picamera2 import Picamera2

        _cam = Picamera2()
        # 1296x972 is the OV5647's binned mode: full field of view, small upload
        _cam.configure(_cam.create_still_configuration(main={"size": (1296, 972)}))
        _cam.start()
        time.sleep(2)  # let auto-exposure settle before the first photo
    return _cam


def snap(path: str = "/tmp/slot.jpg") -> str:
    """Camera photo of the slots. Returns file path."""
    if "camera" in MOCK:
        return MOCK_PHOTO
    _camera().capture_file(path)
    return path


def _play(path: str):
    if "audio" in MOCK:
        print(f"[mock] play {os.path.basename(path)}")
        return
    player = shutil.which("mpg123")
    if not player:
        raise RuntimeError("mpg123 not installed (sudo apt install mpg123)")
    subprocess.run([player, "-q", path], check=True, timeout=60)


def play_mp3(path_or_url: str):
    """Play through the MAX98357A speaker."""
    if path_or_url.startswith("http"):
        r = requests.get(path_or_url, timeout=10)
        r.raise_for_status()
        path_or_url = "/tmp/say.mp3"
        with open(path_or_url, "wb") as f:
            f.write(r.content)
    _play(path_or_url)


def record_question(seconds: int = 5) -> str:
    """Record from the INMP441 mic. Returns WAV path."""
    raise NotImplementedError


def play_backup(name: str):
    """Offline fallback: time_for_pill, good_job, already_took, missed."""
    path = os.path.join(SOUNDS, f"{name}.mp3")
    if "audio" not in MOCK and not os.path.exists(path):
        print(f"[audio] no backup sound {path}")
        return
    _play(path)


def say(cmd: dict):
    """Play the backend's MP3; if there is none or it fails, the stored sound."""
    if cmd.get("say_url"):
        try:
            play_mp3(BACKEND + cmd["say_url"])
            return
        except Exception as e:
            print(f"[audio] say_url failed, using backup: {e!r}")
    if cmd.get("sound"):
        play_backup(cmd["sound"])


def send_photo(dose_id: int, phase: str):
    """Snap and POST to the backend, which counts pills and decides 'taken'."""
    with open(snap(), "rb") as f:
        r = requests.post(f"{BACKEND}/cabinet/{PATIENT_ID}/photo",
                          params={"dose_id": dose_id, "phase": phase},
                          files={"photo": ("slot.jpg", f, "image/jpeg")}, timeout=30)
    r.raise_for_status()
    print(f"[photo] dose {dose_id} {phase}: {r.json()}")


def attempt(what: str, fn, *args):
    """Run one hardware step; a broken part must not stop the cabinet (see Fallbacks)."""
    try:
        fn(*args)
    except Exception as e:
        print(f"[{what}] failed: {e!r}")


def handle(cmd: dict):
    print(f"[cmd] {cmd}")
    slot = cmd.get("open_slot")
    if not slot:  # reminder or feedback: audio only
        attempt("audio", say, cmd)
        return
    dose_id = cmd["dose_id"]
    attempt("photo", send_photo, dose_id, "before")
    attempt("servo", open_slot, slot)
    attempt("audio", say, cmd)
    time.sleep(TAKE_SECONDS)
    attempt("servo", close_slot, slot)
    # no 'after' photo -> dose stays pending and the patient taps "I took it"
    attempt("photo", send_photo, dose_id, "after")


def main():
    print(f"[pi] backend {BACKEND}, patient {PATIENT_ID}, mock {sorted(MOCK) or 'none'}")
    while True:
        try:
            cmd = requests.get(f"{BACKEND}/cabinet/{PATIENT_ID}/command", timeout=5).json()
        except requests.RequestException as e:
            print(f"[pi] backend unreachable: {e.__class__.__name__}")
            cmd = {}
        if cmd:
            handle(cmd)
        else:
            time.sleep(2)


def test(args: list[str]):
    """Bench checks without the backend:
    python pi/main.py servo 2     open slot 2 for 3 s, then close
    python pi/main.py snap        save a photo to /tmp/slot.jpg
    """
    if args[0] == "servo":
        slot = int(args[1])
        open_slot(slot)
        time.sleep(3)
        close_slot(slot)
    elif args[0] == "snap":
        print(snap())


if __name__ == "__main__":
    if len(sys.argv) > 1:
        test(sys.argv[1:])
    else:
        main()
