# ESP32-S3 audio unit (CircuitPython). Runs once at power-on or RESET, before code.py.
import digitalio
import microcontroller
import storage
import usb_cdc
import usb_hid
import usb_midi

# Hold BOOT while pressing RESET to get the CIRCUITPY drive back for editing files.
boot_button = digitalio.DigitalInOut(microcontroller.pin.GPIO0)
boot_button.switch_to_input(pull=digitalio.Pull.UP)
editing = not boot_button.value
boot_button.deinit()

# The S3 has only 5 USB IN endpoints (the control one included): too few for the drive and
# two serial ports at once, so it would fall back to safe mode. Normal run: the console plus
# a data port for the Pi (/dev/ttyACM1), no drive, and code.py may write files (it saves the
# Pi's spoken answers). Editing: the drive as usual, no data port.
usb_hid.disable()
usb_midi.disable()
if not editing:
    storage.disable_usb_drive()
    storage.remount("/", readonly=False)
    usb_cdc.enable(console=True, data=True)
