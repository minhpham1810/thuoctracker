"""Cabinet runtime on the Raspberry Pi 5. No AI here (1GB RAM): take photos and
recordings, send them to the backend, play what comes back.

Run:   BACKEND_URL=http://<laptop-ip>:8000 PATIENT_ID=1 python pi/main.py
Mock:  MOCK=1 python pi/main.py                  every part faked (runs on a laptop)
       MOCK=servo,audio python pi/main.py        fake only the parts not wired yet
Audio: AUDIO=esp32 plays and records through the ESP32-S3 audio unit on USB (pi/esp32/)
Bench: python pi/main.py servo 2   |   python pi/main.py snap   |   python pi/main.py esp32 ping
"""
import glob
import os
import shutil
import subprocess
import sys
import tempfile
import time
import wave

import requests

BACKEND = os.environ.get("BACKEND_URL", "http://localhost:8000")
PATIENT_ID = int(os.environ.get("PATIENT_ID", "1"))
TAKE_SECONDS = int(os.environ.get("TAKE_SECONDS", "10"))  # slot stays open this long
AUDIO = os.environ.get("AUDIO", "pi")  # "esp32": speaker and mic are on the ESP32 (pi/esp32/)
ESP32_PORT = os.environ.get("ESP32_PORT", "")  # default: found by its USB id
ASK_SECONDS = 5  # a voice question is recorded for this long
RATE = 16000  # speech audio everywhere: 16 kHz, 16-bit, mono

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
_esp = None


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


class Esp32:
    """The ESP32-S3 audio unit on USB serial. One command at a time; protocol in pi/esp32/code.py."""

    def __init__(self, port: str):
        import serial

        self.link = serial.Serial(port, timeout=0.2)
        self.pressed = False  # its talk button was pressed since button_pressed() last looked

    def _line(self, timeout: float) -> str:
        """The next reply; "btn" and "ready" can arrive at any time and are noted, not returned."""
        end = time.monotonic() + timeout
        buf = b""
        while time.monotonic() < end:
            buf += self.link.readline()  # may be part of a line when the read times out
            if not buf.endswith(b"\n"):
                continue
            line, buf = buf.decode(errors="replace").strip(), b""
            if line == "btn":
                self.pressed = True
            elif line and line != "ready":
                return line
        raise TimeoutError("the ESP32 didn't answer")

    def _call(self, command: str, payload: bytes = b"", timeout: float = 30) -> str:
        self.link.write(command.encode() + b"\n" + payload)
        reply = self._line(timeout)
        if reply.startswith("err"):
            raise RuntimeError(f"ESP32: {reply[4:]}")
        return reply

    def play(self, name: str):
        """One of the sounds stored on the ESP32 (/sounds/NAME.wav)."""
        self._call(f"play {name}")

    def say(self, wav: bytes):
        """Send a 16 kHz mono WAV; the ESP32 saves it and plays it."""
        self._call(f"say {len(wav)}", wav, timeout=30 + len(wav) / RATE)

    def record(self, seconds: float) -> bytes:
        """Raw 16 kHz, 16-bit, mono samples from the INMP441."""
        reply = self._call(f"rec {seconds}", timeout=10)
        if not reply.startswith("pcm "):
            raise RuntimeError(f"ESP32: expected pcm, got {reply!r}")
        size = int(reply[4:])
        self.link.timeout = seconds + 5
        try:
            data = self.link.read(size)
        finally:
            self.link.timeout = 0.2
        if len(data) != size:
            raise TimeoutError(f"ESP32 sent {len(data)} of {size} audio bytes")
        return data

    def button_pressed(self) -> bool:
        while self.link.in_waiting:
            if self.link.readline().strip() == b"btn":
                self.pressed = True
        pressed, self.pressed = self.pressed, False
        return pressed


def _find_esp32() -> str:
    # CircuitPython's data port is USB interface 2 (the console is interface 0)
    ports = sorted(glob.glob("/dev/serial/by-id/*-if02*"))
    if not ports:
        raise RuntimeError("ESP32 not found: plug it into a black USB port, or set ESP32_PORT")
    return ports[0]


def _with_esp32(fn):
    """Run fn(esp32); on any error drop the connection so the next call reconnects (unplugged, reset)."""
    global _esp
    try:
        if _esp is None:
            _esp = Esp32(ESP32_PORT or _find_esp32())
        return fn(_esp)
    except Exception:
        if _esp is not None:
            try:
                _esp.link.close()
            except Exception:
                pass
        _esp = None
        raise


def _to_wav(mp3_path: str) -> bytes:
    """MP3 -> the ESP32's format (16 kHz, 16-bit, mono WAV)."""
    out = os.path.join(tempfile.gettempdir(), "say.wav")
    subprocess.run([_mpg123(), "-q", "-m", "-r", str(RATE), "-e", "s16", "-w", out, mp3_path],
                   check=True, timeout=60)
    with open(out, "rb") as f:
        return f.read()


def _mpg123() -> str:
    player = shutil.which("mpg123")
    if not player:
        raise RuntimeError("mpg123 not installed (sudo apt install mpg123)")
    return player


def _play(path: str):
    if "audio" in MOCK:
        print(f"[mock] play {os.path.basename(path)}")
        return
    if AUDIO == "esp32":
        wav = _to_wav(path)
        _with_esp32(lambda esp: esp.say(wav))
        return
    subprocess.run([_mpg123(), "-q", path], check=True, timeout=60)


def play_mp3(path_or_url: str):
    """Play through the MAX98357A speaker (on the ESP32 when AUDIO=esp32)."""
    if path_or_url.startswith("http"):
        r = requests.get(path_or_url, timeout=10)
        r.raise_for_status()
        path_or_url = "/tmp/say.mp3"
        with open(path_or_url, "wb") as f:
            f.write(r.content)
    _play(path_or_url)


def record_question(seconds: int = ASK_SECONDS) -> str:
    """Record from the INMP441 mic on the ESP32. Returns WAV path."""
    if "audio" in MOCK:
        print(f"[mock] record {seconds} s")
        pcm = bytes(2 * RATE * seconds)  # silence
    elif AUDIO == "esp32":
        pcm = _with_esp32(lambda esp: esp.record(seconds))
    else:
        raise NotImplementedError("the mic is on the ESP32: set AUDIO=esp32")
    path = os.path.join(tempfile.gettempdir(), "question.wav")  # /tmp on the Pi
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm)
    return path


def ask_question():
    """Talk button: record a question, the backend answers it from the dose log, play the answer."""
    with open(record_question(), "rb") as f:
        r = requests.post(f"{BACKEND}/ai/ask", params={"patient_id": PATIENT_ID},
                          files={"audio": ("question.wav", f, "audio/wav")}, timeout=60)
    r.raise_for_status()
    answer = r.json()
    print(f"[ask] {answer['text']}")
    if answer.get("audio_url"):
        play_mp3(BACKEND + answer["audio_url"])


def talk_button_pressed() -> bool:
    if AUDIO != "esp32" or "audio" in MOCK:
        return False
    try:
        return _with_esp32(lambda esp: esp.button_pressed())
    except Exception:
        return False  # not plugged in: the next sound command reports it


def play_backup(name: str):
    """Offline fallback: time_for_pill, good_job, already_took, missed."""
    if AUDIO == "esp32" and "audio" not in MOCK:
        _with_esp32(lambda esp: esp.play(name))  # stored on the ESP32 as /sounds/NAME.wav
        return
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


def idle(seconds: float):
    """Wait between backend polls; the ESP32's talk button starts a voice question."""
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if talk_button_pressed():
            attempt("ask", ask_question)
            return
        time.sleep(0.1)


def main():
    print(f"[pi] backend {BACKEND}, patient {PATIENT_ID}, audio {AUDIO}, mock {sorted(MOCK) or 'none'}")
    while True:
        try:
            cmd = requests.get(f"{BACKEND}/cabinet/{PATIENT_ID}/command", timeout=5).json()
        except requests.RequestException as e:
            print(f"[pi] backend unreachable: {e.__class__.__name__}")
            cmd = {}
        if cmd:
            handle(cmd)
        else:
            idle(2)


def test(args: list[str]):
    """Bench checks without the backend:
    python pi/main.py servo 2     open slot 2 for 3 s, then close
    python pi/main.py snap        save a photo to /tmp/slot.jpg
    python pi/main.py esp32 ping | play good_job | say file.mp3 | rec 3 | ask
    """
    if args[0] == "servo":
        slot = int(args[1])
        open_slot(slot)
        time.sleep(3)
        close_slot(slot)
    elif args[0] == "snap":
        print(snap())
    elif args[0] == "esp32":
        what = args[1]
        if what == "ping":
            print(_with_esp32(lambda esp: esp._call("ping")))
        elif what == "play":
            play_backup(args[2])
        elif what == "say":
            play_mp3(args[2])
        elif what == "rec":
            print("saved", record_question(int(args[2])))
        elif what == "ask":
            ask_question()


if __name__ == "__main__":
    if len(sys.argv) > 1:
        test(sys.argv[1:])
    else:
        main()
