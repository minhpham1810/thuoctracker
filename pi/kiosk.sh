#!/bin/sh
# Cabinet touchscreen: wait for the web app on the laptop, then show it full-screen.
# Started at desktop login by ~/.config/autostart/cabinet-kiosk.desktop (pi/setup.sh).
cd "$(dirname "$0")"
[ -f .env ] && . ./.env
# hw = the patient this Pi's boxes serve: the screen asks once for that patient's sign-in and remembers it
SCREEN_URL=${SCREEN_URL:-http://192.168.137.1:3000/cabinet?hw=${PATIENT_ID:-1}}
ORIGIN=$(echo "$SCREEN_URL" | cut -d/ -f1-3)  # e.g. http://192.168.137.1:3000
BROWSER=$(command -v chromium || command -v chromium-browser)
PLATFORM=x11
[ -n "$WAYLAND_DISPLAY" ] && PLATFORM=wayland  # Pi 5 desktop (labwc) is Wayland

until curl -s -o /dev/null -m 3 "$SCREEN_URL"; do sleep 3; done
# keep the cabinet on the touchscreen: with a DSI panel up, switch other outputs off
# (otherwise a plugged-in HDMI cable grabs the kiosk window)
if command -v wlr-randr >/dev/null && wlr-randr | grep -q '^DSI'; then
  for out in $(wlr-randr | grep -o '^[A-Z][^ ]*' | grep -v '^DSI'); do
    wlr-randr --output "$out" --off
  done
fi
# relaunch if Chromium crashes or someone closes it.
# No --incognito: the cabinet's sign-in and screen settings are kept in Chromium's profile.
while true; do
  # the "Ask a question" button needs the mic: Chromium only allows it on https,
  # so mark the laptop as secure and auto-accept the permission prompt
  "$BROWSER" --kiosk --noerrdialogs --disable-infobars --no-first-run \
    --password-store=basic --disable-session-crashed-bubble --hide-crash-restore-bubble --ozone-platform="$PLATFORM" \
    --unsafely-treat-insecure-origin-as-secure="$ORIGIN" --use-fake-ui-for-media-stream \
    "$SCREEN_URL"
  sleep 2
done
