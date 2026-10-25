# ESP32-S3 audio unit for the cabinet (CircuitPython, with the audioi2sin module).
# The Pi is the brain: it talks to this board over USB (the data port boot.py opens),
# one command per line, and waits for the reply before sending the next:
#   ping                  -> pong
#   vol 0.3               speaker volume 0-1                    -> ok
#   play NAME             plays /sounds/NAME.wav                -> ok | err ...
#   audio N  + N bytes    raw audio, kept in RAM and played     -> ok | err ...  (what the Pi sends)
#   say N  + N bytes      a WAV file: saved to /say.wav, played -> ok | err ...  (older Pi code)
#   rec SECONDS           records the mic -> pcm N + N bytes (16 kHz, 16-bit, mono) | err ...
#   hall                  -> hall closed | hall open | hall disabled
#   status                -> one JSON line (Hall state/counters, volume, mute)
# Hall/knob changes NEVER send unsolicited lines on the data port.
# Sent on its own: "ready" after starting, "btn" when the talk button is pressed (if wired).
# All audio is 16000 Hz, mono, 16-bit (raw audio: little-endian samples, no header); the Pi
# converts its MP3s before sending.
import array
import json
import time

import audiobusio
import audiocore
import audioi2sin
import audiomixer
import digitalio
import microcontroller
import rotaryio
import usb_cdc

pin = microcontroller.pin
AMP = (pin.GPIO5, pin.GPIO6, pin.GPIO9)    # MAX98357A: BCLK, LRC, DIN
MIC = (pin.GPIO11, pin.GPIO12, pin.GPIO10)  # INMP441: SCK, WS, SD
BUTTON_PIN = None  # e.g. pin.GPIO4: a push button to GND that starts a voice question
HALL_ENABLED = False  # demo: unreliable physical sensor omitted; no GPIO reads/state guesses
HALL_PIN = pin.GPIO14  # Feather A4: DRV5032FALPG OUT; VCC=3V, GND=GND
ENCODER_PINS = (pin.GPIO17, pin.GPIO16)  # Feather A1=CLK, A2=DT
ENCODER_SW_PIN = pin.GPIO15  # Feather A3=SW; encoder +=3V, GND=GND
ENCODER_DIRECTION = -1  # set to +1 instead if clockwise lowers volume on your encoder
VOLUME_START = 0.2
VOLUME_STEP = 0.025
VOLUME_MAX = 1.0  # full DIGITAL range; not a safe-wattage limiter for the 0.5 W speaker!
RATE = 16000
CHUNK = 512  # samples per mic read (32 ms)

link = usb_cdc.data
if link is None:  # knob SW was held at reset: editing, no Pi data port
    print("Editing mode. Press RESET without holding the knob to run.")
    while True:
        time.sleep(1)
link.timeout = 0  # never wait for a serial console/command before servicing the controls
link.write_timeout = 0

mixer = audiomixer.Mixer(voice_count=1, buffer_size=4096, sample_rate=RATE, channel_count=1,
                         bits_per_sample=16, samples_signed=True)
mixer.voice[0].level = VOLUME_START
speaker = audiobusio.I2SOut(*AMP)
speaker.play(mixer)  # the mixer plays silence between sounds


class StableInput:
    """Accept a level only after it has stayed unchanged for the debounce interval."""

    def __init__(self, value, now, delay):
        self.value = value
        self.candidate = value
        self.since = now
        self.delay = delay

    def update(self, value, now):
        if value != self.candidate:
            self.candidate = value
            self.since = now
        if value != self.value and now - self.since >= self.delay:
            self.value = value
            return True
        return False


class Panel:
    """Local controls, independent of USB/REPL. No serial output, even during PCM audio."""

    def __init__(self, encoder, switch, hall, voice, now):
        self.encoder = encoder
        self.switch = switch
        self.hall = hall
        self.voice = voice
        self.position = encoder.position
        self.volume = VOLUME_START
        self.muted = False
        self.hall_input = StableInput(hall.value, now, 0.10) if hall is not None else None
        self.switch_input = StableInput(switch.value, now, 0.04)
        self.opens = 0
        self.closes = 0
        self.last_rotation = now - 10
        self.press_started = None
        self.press_rotated = False
        self.last_audio_error = None
        self.apply_volume()

    def apply_volume(self):
        self.voice.level = 0.0 if self.muted else self.volume

    def set_volume(self, value):
        # Reject NaN/inf, which can otherwise make mixer.level fail after changing state.
        if not -1e10 < value < 1e10:
            raise ValueError("volume must be finite")
        self.volume = round(max(0.0, min(VOLUME_MAX, value)), 4)
        self.apply_volume()

    def update(self, now):
        position = self.encoder.position
        delta = position - self.position
        self.position = position  # always consume counts, including at either volume limit
        if delta:
            self.last_rotation = now
            self.press_rotated = True
            self.set_volume(self.volume + delta * ENCODER_DIRECTION * VOLUME_STEP)

        # A clean press/release toggles mute. Rotation cancels a press, preventing the
        # encoder's noisy SW contact from creating false presses while spinning fast.
        if self.switch_input.update(self.switch.value, now):
            if not self.switch_input.value:
                self.press_started = now
                self.press_rotated = now - self.last_rotation < 0.15
            else:
                if (self.press_started is not None and not self.press_rotated
                        and 0.08 <= now - self.press_started <= 2.0
                        and now - self.last_rotation >= 0.15):
                    self.muted = not self.muted
                    self.apply_volume()
                self.press_started = None

        if self.hall_input is not None and self.hall_input.update(self.hall.value, now):
            if self.hall_input.value:
                self.opens += 1
            else:
                self.closes += 1

    def status(self):
        enabled = self.hall_input is not None
        return {"hall_enabled": enabled,
                "hall_closed": not self.hall_input.value if enabled else None,
                "hall_opens": self.opens if enabled else None,
                "hall_closes": self.closes if enabled else None,
                "volume": self.volume, "muted": self.muted,
                "output_level": self.voice.level, "last_audio_error": self.last_audio_error}


# rotaryio tracks quadrature transitions in native/background code, rather than
# sampling two pins in a Python loop that pauses for USB or microphone reads.
encoder = rotaryio.IncrementalEncoder(*ENCODER_PINS, divisor=4)
encoder_switch = digitalio.DigitalInOut(ENCODER_SW_PIN)
encoder_switch.switch_to_input(pull=digitalio.Pull.UP)
hall = None
if HALL_ENABLED:
    hall = digitalio.DigitalInOut(HALL_PIN)
    hall.switch_to_input(pull=digitalio.Pull.UP)  # not a disconnected-sensor detector
panel = Panel(encoder, encoder_switch, hall, mixer.voice[0], time.monotonic())


def service_controls():
    panel.update(time.monotonic())


def wait_controls(seconds):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        service_controls()
        time.sleep(0.002)


button = None
if BUTTON_PIN:
    button = digitalio.DigitalInOut(BUTTON_PIN)
    button.switch_to_input(pull=digitalio.Pull.UP)


def write_all(data):
    """usb_cdc's write can send only part when the Pi is slow to read: keep going until it's all out."""
    view = memoryview(data)
    deadline = time.monotonic() + 5
    while len(view):
        service_controls()
        if not link.connected:
            raise OSError("Pi data port disconnected")
        view = view[link.write(view) or 0:]
        if len(view) and time.monotonic() > deadline:
            raise OSError("the Pi stopped reading")
        if len(view):
            time.sleep(0.001)


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
                wait_controls(0.01)
            wait_controls(0.2)  # let the buffered tail reach the speaker
        finally:
            wav.deinit()


def drain(size):
    """Read and drop size bytes, so the next command still lines up after a failure."""
    buf = bytearray(2048)
    deadline = time.monotonic() + 10 + size / 20000
    while size and time.monotonic() < deadline:
        service_controls()
        got = link.readinto(memoryview(buf)[:min(size, len(buf))]) or 0
        size -= got
        if not got:
            time.sleep(0.001)


def play_pcm(size):
    """Receive size bytes of raw audio into RAM (the Feather's PSRAM) and play it. RAM, not
    flash: saving an answer to flash first (say) was slow enough to time out."""
    if size <= 0 or size % 2:
        drain(max(size, 0))
        raise ValueError("audio must be whole 16-bit samples")
    try:
        samples = array.array("h", bytes(size // 2))  # size // 2 silent samples
    except MemoryError:
        drain(size)
        raise
    service_controls()
    # One read for the whole answer keeps the samples aligned (a short read could split one).
    # USB moves ~100 KB in well under a second; the knob's turns are still counted meanwhile
    # (rotaryio counts in the background) and applied right after.
    link.timeout = 10 + size / 20000
    try:
        got = link.readinto(samples) or 0
    finally:
        link.timeout = 0
    service_controls()
    if got != size:
        raise OSError("got %d of %d audio bytes" % (got, size))
    sound = audiocore.RawSample(samples, sample_rate=RATE)
    try:
        mixer.voice[0].play(sound)
        while mixer.voice[0].playing:
            wait_controls(0.01)
        wait_controls(0.2)  # let the buffered tail reach the speaker
    finally:
        sound.deinit()


def receive(path, size):
    """Read exactly size bytes from the Pi into path. Always reads them all, even if
    the file can't be written, so the next command still lines up."""
    buf = bytearray(2048)
    left = size
    deadline = time.monotonic() + 10 + size / 20000
    try:
        f = open(path, "wb")
    except OSError:
        f = None  # read-only: boot.py didn't remount for normal operation
    try:
        while left:
            service_controls()
            if not link.connected:
                raise OSError("Pi disconnected while sending audio")
            if time.monotonic() > deadline:
                raise OSError("timed out receiving audio")
            got = link.readinto(memoryview(buf)[:min(left, len(buf))])
            if got:
                if f:
                    f.write(memoryview(buf)[:got])
                left -= got
            else:
                time.sleep(0.001)
    finally:
        if f:
            f.close()
    if not f:
        raise OSError("drive is read-only, can't save the answer")


def record(seconds):
    total = int(seconds * RATE)
    samples = array.array("h", [0] * CHUNK)
    mic = audioi2sin.I2SIn(*MIC, sample_rate=RATE, bit_depth=32, output_bit_depth=16,
                           mono=True, samples_signed=True, left_justified=False)
    try:
        for _ in range(2):  # the first reads are settling noise
            mic.record(samples, CHUNK)
            service_controls()
        send("pcm %d" % (total * 2))
        left = total
        try:
            while left:
                n = mic.record(samples, min(CHUNK, left))
                service_controls()
                if n:
                    write_all(bytes(memoryview(samples)[:n]))  # raw bytes, 2 per sample
                    left -= n
        except Exception as e:
            # The Pi expects exactly total*2 bytes. No diagnostic text may enter that payload.
            panel.last_audio_error = repr(e)
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
        panel.set_volume(float(arg))
        send("ok")
    elif word == "hall":
        service_controls()
        if panel.hall_input is None:
            send("hall disabled")
        else:
            send("hall closed" if panel.status()["hall_closed"] else "hall open")
    elif word == "status":
        service_controls()
        send(json.dumps(panel.status()))
    elif word == "play":
        if not arg.replace("_", "").isalpha():
            raise ValueError("bad sound name")
        play_file("/sounds/%s.wav" % arg)
        send("ok")
    elif word == "audio":
        play_pcm(int(arg))
        send("ok")
    elif word == "say":
        receive("/say.wav", int(arg))
        play_file("/say.wav")
        send("ok")
    elif word == "rec":
        record(float(arg))  # replies with pcm N + the audio
    elif word in ("ready", "btn", "pong", "ok", "err", "pcm"):
        pass  # one of our own lines, echoed back by Linux while the Pi opened the port
    else:
        raise ValueError("unknown command " + word)


def main():
    pending = b""
    connected_before = False
    talk = StableInput(button.value, time.monotonic(), 0.05) if button else None
    while True:
        service_controls()  # always, even with no host application/console open
        connected = link.connected
        if not connected:
            pending = b""
            connected_before = False
            if talk:
                talk.update(button.value, time.monotonic())
            time.sleep(0.002)
            continue
        try:
            if not connected_before:
                connected_before = True
                send("ready")
            if talk and talk.update(button.value, time.monotonic()) and not talk.value:
                send("btn")  # legacy optional TALK button, not the knob's mute switch
            # Read at most one line, leaving any following audio/say binary payload in USB.
            raw = link.readline(128)
            if not raw:
                time.sleep(0.002)
                continue
            pending += raw
            if len(pending) > 256:
                # Do not interpret the tail of an overlong command as a fresh command.
                if pending.endswith(b"\n"):
                    pending = b""
                    send("err command too long")
                else:
                    pending = b"!" * 257
                continue
            if not pending.endswith(b"\n"):
                continue
            try:
                line = pending.decode().strip()
            except UnicodeError:
                line = ""  # not text (audio meant for a command we don't know): skip it quietly
            pending = b""
            if line:
                run(line)
        except Exception as e:
            pending = b""
            try:
                send("err %s" % e)
            except Exception:
                pass  # disconnected/not reading: local controls must keep running


if __name__ == "__main__":
    main()
