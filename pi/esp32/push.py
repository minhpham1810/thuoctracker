"""Copy files to the ESP32 over its console port: no buttons, no drive.

    .venv/bin/python pi/esp32/push.py                 # code.py
    .venv/bin/python pi/esp32/push.py boot.py code.py

Uses CircuitPython's raw REPL. boot.py makes the board's files writable from code, which is what
lets this work. After the copy it restarts the board (a full reset if boot.py changed).
"""
import glob
import os
import sys
import time

import serial

HERE = os.path.dirname(os.path.abspath(__file__))


def console_port() -> str:
    if os.environ.get("ESP32_CONSOLE"):
        return os.environ["ESP32_CONSOLE"]
    ports = sorted(glob.glob("/dev/serial/by-id/*-if00"))
    if any("JTAG" in p for p in ports):
        sys.exit("The ESP32 is in its USB bootloader (BOOT was held during RESET). Press RESET alone.")
    if not ports:
        sys.exit("ESP32 not found: is it plugged in?")
    return ports[0]


def raw_repl(link: serial.Serial):
    """Stop code.py, step past "Press any key to enter the REPL", enter the raw REPL. A few tries:
    the board may still be starting up (boot.py waits 2 s for the BOOT button)."""
    seen = b""
    for _ in range(3):
        link.write(b"\r\x03")
        time.sleep(0.5)
        link.write(b"\x03")  # a second one, in case the first landed while code.py was busy
        time.sleep(1)
        link.write(b"\r")
        time.sleep(1)
        seen = link.read(link.in_waiting)
        link.write(b"\x01")
        got = link.read_until(b"CTRL-B to exit\r\n>")
        if got.endswith(b">"):
            return
        seen += got
    sys.exit("No REPL on the ESP32's console. It said:\n"
             + seen.decode(errors="replace")[-600:]
             + "\n(Nothing at all: press RESET, wait 5 s, try again.)")


def main(names: list[str]):
    link = serial.Serial(console_port(), 115200, timeout=4)
    raw_repl(link)

    def run(code: str):
        link.write(code.encode() + b"\x04")
        reply = link.read_until(b"\x04>")  # OK, output, \x04, error, \x04>
        if not reply.startswith(b"OK") or not reply.endswith(b"\x04>"):
            sys.exit(f"The ESP32 didn't answer: {reply[:200]!r}")
        out, _, err = reply[2:-2].partition(b"\x04")
        if err.strip():
            sys.exit(f"ESP32 error: {err.decode(errors='replace').strip()}")
        return out

    for name in names:
        with open(os.path.join(HERE, name), "rb") as f:
            data = f.read()
        run(f"f = open('/{name}', 'wb')")
        for i in range(0, len(data), 256):
            run(f"f.write({data[i:i + 256]!r})")
        run("f.close()")
        size = int(run(f"import os; print(os.stat('/{name}')[6])").strip())
        if size != len(data):
            sys.exit(f"{name}: wrote {size} of {len(data)} bytes")
        print(f"copied {name} ({size} bytes)")

    if "boot.py" in names:
        link.write(b"import microcontroller; microcontroller.reset()\x04")  # boot.py runs only at reset
        print("resetting the ESP32 (boot.py changed)")
    else:
        link.write(b"\x02\x04")  # back to the normal REPL, then reload: code.py starts again
        print("restarting code.py")
    link.close()


if __name__ == "__main__":
    main(sys.argv[1:] or ["code.py"])
