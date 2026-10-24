"""Cabinet runtime on the Raspberry Pi 5. No AI here (1GB RAM): take photos and
recordings, send them to the backend, play what comes back.

Run: BACKEND_URL=http://<laptop-ip>:8000 PATIENT_ID=1 python pi/main.py
"""
import os
import time

import requests

BACKEND = os.environ.get("BACKEND_URL", "http://localhost:8000")
PATIENT_ID = int(os.environ.get("PATIENT_ID", "1"))


def open_slot(slot: int):
    """Move servo `slot` (1-3) via the PCA9685 over I2C."""
    raise NotImplementedError


def snap(path: str = "/tmp/slot.jpg") -> str:
    """Camera photo of the slots. Returns file path."""
    raise NotImplementedError


def play_mp3(path_or_url: str):
    """Play through the MAX98357A speaker."""
    raise NotImplementedError


def record_question(seconds: int = 5) -> str:
    """Record from the INMP441 mic. Returns WAV path."""
    raise NotImplementedError


def play_backup(name: str):
    """Offline fallback: time_for_pill, good_job, already_took, missed."""
    raise NotImplementedError


def main():
    while True:
        try:
            cmd = requests.get(f"{BACKEND}/cabinet/{PATIENT_ID}/command", timeout=5).json()
        except requests.RequestException:
            cmd = {}
        if "open_slot" in cmd:
            open_slot(cmd["open_slot"])
            # TODO: snap before/after, POST to /ai/count, POST /doses
        time.sleep(2)


if __name__ == "__main__":
    main()
