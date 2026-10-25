# ESP32-S3 audio unit

The cabinet's speaker (MAX98357A) and mic (INMP441) are on an ESP32-S3 running CircuitPython
(a build with the `audioi2sin` module). The Pi controls it over one USB cable; `pi/main.py`
talks to it when `AUDIO=esp32` is set in `pi/.env`.

## Set up the board (once)

1. Plug the ESP32 into your laptop. It shows up as a `CIRCUITPY` drive.
2. Copy `boot.py` and `code.py` from this folder onto `CIRCUITPY`.
3. Make a `sounds` folder on `CIRCUITPY` with the 4 stored sounds as **16000 Hz, mono, 16-bit WAV**:
   `time_for_pill.wav`, `good_job.wav`, `already_took.wav`, `missed.wav`.
   Convert an MP3 with: `mpg123 -m -r 16000 -e s16 -w good_job.wav good_job.mp3`
4. Press RESET. From now on the `CIRCUITPY` drive is hidden: the S3 has too few USB endpoints
   for the drive plus the Pi's data port, and `code.py` needs to write the spoken answers.
   **To edit files again, hold BOOT while pressing RESET** (the drive comes back, the Pi's port
   is off until the next plain RESET).
5. Optional talk button: wire a push button between a free pin and GND, and set `BUTTON_PIN`
   in `code.py` (e.g. `pin.GPIO4`).

## Connect it to the Pi

Plug it into a **black** USB port. In `pi/.env` set `AUDIO=esp32` and remove `audio` from `MOCK`.
Then check it from the Pi:

```bash
python pi/main.py esp32 ping            # pong
python pi/main.py esp32 play good_job   # stored sound
python pi/main.py esp32 rec 3           # records 3 s, saves /tmp/question.wav
python pi/main.py esp32 ask             # records a question, plays the answer
```

The Pi finds the board's data port by itself: the board's second entry in `/dev/serial/by-id/`
(the first, `-if00`, is the console). Only one entry means `boot.py` hasn't run: press RESET
(copying files or Ctrl+D doesn't run it), and don't hold BOOT. Or set `ESP32_PORT=/dev/ttyACM1`
in `pi/.env`.

Wiring (matches the mic + speaker test): amp BCLK 5, LRC 6, DIN 9; mic SCK 11, WS 12, SD 10.
