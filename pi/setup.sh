#!/bin/sh
# One-time Pi setup, from the repo root on the Pi: sh pi/setup.sh
# Then reboot: the cabinet loop and the full-screen cabinet page start on their own.
set -e
[ -f pi/.env ] || cp pi/.env.example pi/.env
chmod +x pi/kiosk.sh

sudo cp pi/cabinet.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable cabinet

mkdir -p ~/.config/autostart
cat > ~/.config/autostart/cabinet-kiosk.desktop <<EOF
[Desktop Entry]
Type=Application
Name=Cabinet kiosk
Exec=$PWD/pi/kiosk.sh
EOF

sudo raspi-config nonint do_boot_behaviour B4  # boot to desktop, logged in
sudo raspi-config nonint do_blanking 1         # screen never goes dark
echo "Done. Reboot to start: sudo reboot"
