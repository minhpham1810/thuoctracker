# ESP32-S3 audio unit (CircuitPython). Runs once at power-on or RESET, before code.py.
# To update files, use pi/esp32/push.py from the Pi (no buttons needed).
import digitalio
import microcontroller
import storage
import usb_cdc
import usb_hid
import usb_midi

# Editing mode (the CIRCUITPY drive comes back): hold the volume knob pressed in while pressing
# RESET. (Not the BOOT button: holding BOOT through a reset starts the chip's own USB bootloader.)
knob = digitalio.DigitalInOut(microcontroller.pin.GPIO15)  # encoder SW, Feather A3
knob.switch_to_input(pull=digitalio.Pull.UP)
editing = not knob.value
knob.deinit()

# The S3 has only 5 USB IN endpoints (the control one included): too few for the drive and
# two serial ports at once, so it would fall back to safe mode. Normal run: the console plus
# a data port for the Pi (/dev/ttyACM1), no drive, and files writable from code (push.py
# uses that). Editing: the drive as usual, no data port.
usb_hid.disable()
usb_midi.disable()
if not editing:
    storage.disable_usb_drive()
    storage.remount("/", readonly=False)
    usb_cdc.enable(console=True, data=True)
