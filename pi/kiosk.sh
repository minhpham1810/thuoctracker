#!/bin/sh
# Cabinet touchscreen: wait for the web app on the laptop, then show it full-screen.
# Started at desktop login by ~/.config/autostart/cabinet-kiosk.desktop (pi/setup.sh).
cd "$(dirname "$0")"
[ -f .env ] && . ./.env
SCREEN_URL=${SCREEN_URL:-http://192.168.137.1:3000/cabinet?patient=${PATIENT_ID:-1}}
BROWSER=$(command -v chromium || command -v chromium-browser)

until curl -s -o /dev/null -m 3 "$SCREEN_URL"; do sleep 3; done
# relaunch if Chromium crashes or someone closes it
while true; do
  "$BROWSER" --kiosk --incognito --noerrdialogs --disable-infobars --no-first-run \
    --password-store=basic --disable-session-crashed-bubble "$SCREEN_URL"
  sleep 2
done
