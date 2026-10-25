# ESP32-S3 audio unit for the cabinet (CircuitPython, with the audioi2sin module).
# The Pi is the brain: it talks to this board over USB (the data port boot.py opens),
# one command per line, and waits for the reply before sending the next:
#   ping                  -> pong
#   vol 0.3               speaker volume 0-1                    -> ok
#   play NAME             plays /sounds/NAME.wav                -> ok | err ...
#   audio N  + N bytes    raw audio, kept in RAM and played     -> ok | err ...
#   rec SECONDS           records the mic -> pcm N + N bytes | err ...
# Sent on its own: "ready" after starting, "btn" when the talk button is pressed (if wired).
# All audio is 16000 Hz, mono, 16-bit (raw audio: little-endian samples, no header); the Pi
# converts its MP3s before sending.
import array
import time

import audiobusio
import audiocore
import audioi2sin
import audiomixer
import digitalio
import microcontroller
import usb_cdc

pin = microcontroller.pin
AMP = (pin.GPIO5, pin.GPIO6, pin.GPIO9)    # MAX98357A: BCLK, LRC, DIN
MIC = (pin.GPIO11, pin.GPIO12, pin.GPIO10)  # INMP441: SCK, WS, SD
BUTTON_PIN = None  # e.g. pin.GPIO4: a push button to GND that starts a voice question
RATE = 16000
CHUNK = 512  # samples per mic read (32 ms)

link = usb_cdc.data
if link is None:  # editing mode (BOOT pressed just after RESET): the drive is on, the Pi's port is off
    print("Editing mode: no port for the Pi. Press RESET (and nothing else) to run.")
    while True:
        time.sleep(1)
link.timeout = 0.05
link.write_timeout = 2

mixer = audiomixer.Mixer(voice_count=1, buffer_size=4096, sample_rate=RATE, channel_count=1,
                         bits_per_sample=16, samples_signed=True)
mixer.voice[0].level = 0.3
speaker = audiobusio.I2SOut(*AMP)
speaker.play(mixer)  # the mixer plays silence between sounds

button = None
if BUTTON_PIN:
    button = digitalio.DigitalInOut(BUTTON_PIN)
    button.switch_to_input(pull=digitalio.Pull.UP)


def write_all(data):
    """usb_cdc's write can send only part when the Pi is slow to read: keep going until it's all out."""
    view = memoryview(data)
    deadline = time.monotonic() + 5
    while len(view):
        view = view[link.write(view) or 0:]
        if len(view) and time.monotonic() > deadline:
            raise OSError("the Pi stopped reading")


def send(line):
    write_all((line + "\n").encode())


def play_file(path):
    with open(path, "rb") as f:
        wav = audiocore.WaveFile(f)
        try:
            if (wav.sample_rate, wav.channel_count, wav.bits_per_sample) != (RATE, 1, 16):
                raise ValueError("WAV must be 16000 Hz, mono, 16-bit")
            mixer.voice[0].play(wav)
            while mixer.voice[0].playing:
                time.sleep(0.01)
            time.sleep(0.2)  # let the buffered tail reach the speaker
        finally:
            wav.deinit()


def drain(size):
    """Read and drop `size` bytes, so the next command still lines up after a failure."""
    buf = bytearray(2048)
    deadline = time.monotonic() + 10 + size / 20000
    while size and time.monotonic() < deadline:
        size -= link.readinto(memoryview(buf)[:min(size, len(buf))]) or 0


def play_pcm(size):
    """Receive `size` bytes of raw audio into RAM (the Feather's PSRAM) and play it. RAM, not
    flash: writing an answer to flash was slow enough to time out."""
    if size % 2:
        drain(size)
        raise ValueError("audio must be whole 16-bit samples")
    try:
        samples = array.array("h", bytes(size // 2))  # size // 2 silent samples
    except MemoryError:
        drain(size)
        raise
    link.timeout = 10 + size / 20000  # one read for the whole answer: always whole samples
    try:
        got = link.readinto(samples) or 0
    finally:
        link.timeout = 0.05
    if got != size:
        raise OSError("got %d of %d audio bytes" % (got, size))
    sound = audiocore.RawSample(samples, sample_rate=RATE)
    try:
        mixer.voice[0].play(sound)
        while mixer.voice[0].playing:
            time.sleep(0.01)
        time.sleep(0.2)  # let the buffered tail reach the speaker
    finally:
        sound.deinit()


def record(seconds):
    total = int(seconds * RATE)
    samples = array.array("h", [0] * CHUNK)
    mic = audioi2sin.I2SIn(*MIC, sample_rate=RATE, bit_depth=32, output_bit_depth=16,
                           mono=True, samples_signed=True, left_justified=False)
    try:
        for _ in range(2):  # the first reads are settling noise
            mic.record(samples, CHUNK)
        send("pcm %d" % (total * 2))
        left = total
        try:
            while left:
                n = mic.record(samples, min(CHUNK, left))
                if n:
                    write_all(bytes(memoryview(samples)[:n]))  # raw bytes, 2 per sample
                    left -= n
        except Exception as e:
            # the Pi is waiting for exactly total*2 bytes: fill with silence, report on the console
            print("[mic] failed:", repr(e))
            zeros = bytes(2 * CHUNK)
            while left:
                n = min(CHUNK, left)
                write_all(zeros[:2 * n])
                left -= n
    finally:
        mic.deinit()


def run(line):
    word, _, arg = line.partition(" ")
    if word == "ping":
        send("pong")
    elif word == "vol":
        mixer.voice[0].level = max(0.0, min(1.0, float(arg)))
        send("ok")
    elif word == "play":
        if not arg.replace("_", "").isalpha():
            raise ValueError("bad sound name")
        play_file("/sounds/%s.wav" % arg)
        send("ok")
    elif word == "audio":
        play_pcm(int(arg))
        send("ok")
    elif word == "rec":
        record(float(arg))  # replies with pcm N + the audio
    elif word in ("ready", "btn", "pong", "ok", "err", "pcm"):
        pass  # one of our own lines, echoed back by Linux while the Pi opened the port
    else:
        raise ValueError("unknown command " + word)


send("ready")
pending = b""
pressed_at = -10.0
while True:
    if button and not button.value and time.monotonic() - pressed_at > 1:
        pressed_at = time.monotonic()
        send("btn")
    raw = link.readline()  # may be part of a line when the 50 ms timeout hits
    if not raw:
        continue
    pending += raw
    if not pending.endswith(b"\n"):
        continue
    line, pending = pending.decode().strip(), b""
    if not line:
        continue
    try:
        run(line)
    except Exception as e:
        try:
            send("err %s" % e)
        except Exception:
            pass  # the Pi isn't reading; it reconnects and starts over
