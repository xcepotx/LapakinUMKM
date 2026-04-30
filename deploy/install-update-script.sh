#!/bin/bash
#
# install-update-script.sh — Pasang update-lapakin.sh sebagai global command
#
# Run sekali di VPS:
#   cd ~/LapakinUMKM
#   bash deploy/install-update-script.sh
#
# Setelah ini kamu bisa jalanin: `update-lapakin` dari mana aja.

set -e

APP_DIR="${APP_DIR:-/home/lapakin/LapakinUMKM}"
SCRIPT="$APP_DIR/deploy/update-lapakin.sh"

if [[ ! -f "$SCRIPT" ]]; then
  echo "❌ Script tidak ditemukan: $SCRIPT"
  exit 1
fi

chmod +x "$SCRIPT"
sudo ln -sf "$SCRIPT" /usr/local/bin/update-lapakin

echo "✅ update-lapakin terpasang sebagai global command"
echo ""
echo "Coba: update-lapakin --help"
echo ""
echo "═══ OPSIONAL: Auto-update via cron ═══"
echo ""
echo "Mau auto-pull tiap 5 menit dari git? Tambah ini ke crontab:"
echo ""
echo "    crontab -e"
echo ""
echo "Tambahkan baris:"
echo ""
echo "    */5 * * * * /usr/local/bin/update-lapakin --skip-health >> /home/lapakin/update.log 2>&1"
echo ""
echo "Atau sekali sehari jam 3 pagi:"
echo ""
echo "    0 3 * * * /usr/local/bin/update-lapakin --skip-health >> /home/lapakin/update.log 2>&1"
