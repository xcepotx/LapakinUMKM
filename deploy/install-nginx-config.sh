#!/bin/bash
#
# install-nginx-config.sh — Pasang nginx config Lapakin ke VPS
#
# Run di VPS:
#   cd ~/LapakinUMKM
#   git pull
#   bash deploy/install-nginx-config.sh
#

set -e

CONFIG_SRC="/home/lapakin/LapakinUMKM/deploy/nginx-lapakin.conf"
CONFIG_DEST="/etc/nginx/sites-available/lapakin"

if [[ ! -f "$CONFIG_SRC" ]]; then
  echo "❌ Config not found: $CONFIG_SRC"
  exit 1
fi

# Backup config lama
if [[ -f "$CONFIG_DEST" ]]; then
  sudo cp "$CONFIG_DEST" "${CONFIG_DEST}.bak.$(date +%Y%m%d-%H%M%S)"
  echo "✅ Backup config lama"
fi

# Copy config baru
sudo cp "$CONFIG_SRC" "$CONFIG_DEST"
echo "✅ Config baru terpasang: $CONFIG_DEST"

# Symlink ke sites-enabled
sudo ln -sf "$CONFIG_DEST" /etc/nginx/sites-enabled/lapakin
sudo rm -f /etc/nginx/sites-enabled/default
echo "✅ Symlinked ke sites-enabled"

# Test
echo ""
echo "Testing nginx config..."
if sudo nginx -t; then
    echo ""
    echo "✅ Config valid. Reloading nginx..."
    sudo systemctl reload nginx
    echo "✅ Nginx reloaded"
    echo ""
    echo "Test OG dari command line:"
    echo "  curl -A 'facebookexternalhit/1.1' https://lapakin.my.id/toko/warung-bu-sari"
    echo ""
    echo "Test gambar OG:"
    echo "  curl -I https://lapakin.my.id/api/og/shop/warung-bu-sari.png"
else
    echo "❌ Config invalid. Restoring backup..."
    if [[ -f "${CONFIG_DEST}.bak."* ]]; then
        LATEST_BAK=$(ls -t "${CONFIG_DEST}.bak."* | head -1)
        sudo cp "$LATEST_BAK" "$CONFIG_DEST"
        sudo nginx -t
    fi
    exit 1
fi
