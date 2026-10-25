# ESP32-S3 audio unit (CircuitPython). Runs once at power-on, before code.py.
import digitalio
import microcontroller
import storage
import usb_cdc

# A second USB serial port just for the Pi (/dev/ttyACM1), so commands and audio
# never mix with the console's prints.
usb_cdc.enable(console=True, data=True)

# code.py saves the Pi's spoken answers to /say.wav, so it needs to write to the
# drive. While it can, the computer sees CIRCUITPY as read-only.
# To edit files again: hold the BOOT button while pressing RESET.
boot_button = digitalio.DigitalInOut(microcontroller.pin.GPIO0)
boot_button.switch_to_input(pull=digitalio.Pull.UP)
if boot_button.value:  # not held
    storage.remount("/", readonly=False)
boot_button.deinit()
