#!/bin/bash
#
# setup-lapakin-vps.sh
#
# Automated setup for a FRESH Ubuntu 22.04 VPS running Lapakin.
# Run this as user `lapakin` (not root). Assumes initial hardening done
# (user created, SSH key login, ufw + fail2ban active).
#
# Usage (sebagai user lapakin):
#   wget https://raw.githubusercontent.com/YOUR/LapakinUMKM/main/deploy/setup-lapakin-vps.sh
#   chmod +x setup-lapakin-vps.sh
#   ./setup-lapakin-vps.sh
#

set -euo pipefail

# ---------- Colors ----------
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${B}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${G}✅ $*${NC}"; }
warn() { echo -e "${Y}⚠️  $*${NC}"; }
err()  { echo -e "${R}❌ $*${NC}"; }

# ---------- Pre-checks ----------
if [[ "$(id -u)" -eq 0 ]]; then
  err "Jangan jalankan sebagai root. Pakai user non-root dengan sudo, misal 'lapakin'."
  exit 1
fi

if ! command -v sudo >/dev/null; then
  err "sudo tidak terpasang."
  exit 1
fi

DOMAIN="${DOMAIN:-lapakin.my.id}"
APP_DIR="${APP_DIR:-/home/$USER/LapakinUMKM}"
REPO_URL="${REPO_URL:-}"

log "Domain: $DOMAIN"
log "App dir: $APP_DIR"

# ---------- 1. System packages ----------
log "Installing system packages..."
sudo apt-get update
sudo apt-get install -y \
  curl wget git build-essential \
  nginx certbot python3-certbot-nginx \
  software-properties-common
ok "System packages installed"

# ---------- 2. Node.js 20 + yarn + pm2 ----------
if ! command -v node >/dev/null; then
  log "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
  sudo npm install -g yarn pm2
  ok "Node.js $(node -v), yarn $(yarn -v), pm2 $(pm2 -v)"
else
  ok "Node.js already installed: $(node -v)"
fi

# ---------- 3. Python 3.11 ----------
if ! command -v python3.11 >/dev/null; then
  log "Installing Python 3.11..."
  sudo add-apt-repository -y ppa:deadsnakes/ppa
  sudo apt-get update
  sudo apt-get install -y python3.11 python3.11-venv python3.11-dev
  ok "Python 3.11 installed: $(python3.11 --version)"
else
  ok "Python 3.11 already installed"
fi

# ---------- 4. MongoDB 7.0 ----------
if ! command -v mongod >/dev/null; then
  log "Installing MongoDB 7.0..."
  curl -fsSL https://pgp.mongodb.com/server-7.0.asc | \
    sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
  echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] \
https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | \
    sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list > /dev/null
  sudo apt-get update
  sudo apt-get install -y mongodb-org
  
  # CRITICAL security: bind localhost only
  sudo sed -i 's/^\(\s*bindIp:\).*/\1 127.0.0.1/' /etc/mongod.conf
  
  sudo systemctl enable mongod
  sudo systemctl start mongod
  sleep 2
  ok "MongoDB installed, bound to 127.0.0.1 only"
else
  ok "MongoDB already installed"
fi

# Security check: make sure MongoDB is not exposed
if sudo ss -tlnp 2>/dev/null | grep -q "0.0.0.0:27017"; then
  err "MongoDB sedang listen di 0.0.0.0:27017! CRITICAL security issue."
  err "Edit /etc/mongod.conf → set bindIp: 127.0.0.1 → restart mongod"
  exit 1
fi
ok "MongoDB listen di localhost saja (aman)"

# ---------- 5. Clone repo ----------
if [[ ! -d "$APP_DIR" ]]; then
  if [[ -z "$REPO_URL" ]]; then
    err "Set REPO_URL env var atau clone manual ke $APP_DIR terlebih dahulu"
    err "Contoh: REPO_URL=https://github.com/USER/LapakinUMKM.git ./setup-lapakin-vps.sh"
    exit 1
  fi
  log "Cloning repo..."
  git clone "$REPO_URL" "$APP_DIR"
fi
ok "Repo di $APP_DIR"

# ---------- 6. Backend setup ----------
log "Setting up backend..."
cd "$APP_DIR/backend"

if [[ ! -d ".venv" ]]; then
  python3.11 -m venv .venv
fi

source .venv/bin/activate
pip install --upgrade pip > /dev/null
pip install -r requirements.txt
pip install "emergentintegrations" --extra-index-url https://d33sy5i8bnduwe.cloudfront.net/simple/ || warn "emergentintegrations install failed, continuing"
ok "Backend Python deps installed"

if [[ ! -f ".env" ]]; then
  warn "backend/.env tidak ada. Membuat template baru."
  JWT_SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(64))")
  ADMIN_PW=$(python3 -c "import secrets; print(secrets.token_urlsafe(16))")
  cat > .env << EOF
MONGO_URL=mongodb://localhost:27017
DB_NAME=lapakin_db
CORS_ORIGINS=https://$DOMAIN
JWT_SECRET=$JWT_SECRET
ADMIN_EMAIL=admin@lapakin.id
ADMIN_PASSWORD=$ADMIN_PW
EMERGENT_LLM_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=
RESEND_API_KEY=
SENDER_EMAIL=noreply@$DOMAIN
SENDER_NAME=Lapakin
PUBLIC_APP_URL=https://$DOMAIN
MIDTRANS_SERVER_KEY=
MIDTRANS_CLIENT_KEY=
MIDTRANS_IS_PRODUCTION=false
CUSTOM_DOMAIN_TARGET=$DOMAIN
EOF
  chmod 600 .env
  warn "PENTING: Edit backend/.env dan isi EMERGENT_LLM_KEY, RESEND_API_KEY, MIDTRANS_*"
  warn "Admin password baru: $ADMIN_PW"
  echo "$ADMIN_PW" > ~/lapakin-admin-password.txt
  chmod 600 ~/lapakin-admin-password.txt
  ok "Admin password disimpan di ~/lapakin-admin-password.txt"
else
  chmod 600 .env
  ok "backend/.env sudah ada"
fi

deactivate

# ---------- 7. Frontend build ----------
log "Building frontend..."
cd "$APP_DIR/frontend"

if [[ ! -f ".env" ]]; then
  echo "REACT_APP_BACKEND_URL=https://$DOMAIN" > .env
fi

yarn install --frozen-lockfile > /dev/null 2>&1 || yarn install
yarn build
ok "Frontend build di $APP_DIR/frontend/build"

# ---------- 8. PM2 ----------
log "Setting up PM2..."
cd "$APP_DIR/backend"

if ! pm2 describe lapakin-backend > /dev/null 2>&1; then
  pm2 start ".venv/bin/uvicorn server:app --host 127.0.0.1 --port 8001" \
    --name lapakin-backend \
    --cwd "$APP_DIR/backend" \
    --max-memory-restart 800M
else
  pm2 restart lapakin-backend
fi

pm2 save
# pm2 startup — print command user harus jalankan
STARTUP_CMD=$(pm2 startup systemd -u $USER --hp /home/$USER | tail -1)
warn "Jalankan command ini (sekali saja) untuk enable pm2 auto-start on reboot:"
echo "  $STARTUP_CMD"
ok "PM2 backend running"

# ---------- 9. Nginx config ----------
log "Configuring nginx..."
NGINX_CONF=/etc/nginx/sites-available/lapakin

sudo tee $NGINX_CONF > /dev/null << EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    # Certbot akan inject redirect ke 443 di sini setelah SSL terpasang
    root $APP_DIR/frontend/build;
    index index.html;

    client_max_body_size 20M;

    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }

    location ~* ^/toko/([^/]+)\$ {
        set \$is_bot 0;
        if (\$http_user_agent ~* "facebookexternalhit|Twitterbot|LinkedInBot|WhatsApp|TelegramBot|Slackbot|Discordbot") {
            set \$is_bot 1;
        }
        if (\$is_bot = 1) {
            proxy_pass http://127.0.0.1:8001/api/og/shop/\$1;
            proxy_set_header Host \$host;
            proxy_set_header X-Forwarded-Host \$host;
            proxy_set_header X-Forwarded-Proto https;
            break;
        }
        try_files \$uri /index.html;
    }

    location / {
        try_files \$uri /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|svg|woff2?)\$ {
        expires 7d;
        add_header Cache-Control "public, max-age=604800";
        try_files \$uri /index.html;
    }
}
EOF

sudo ln -sf $NGINX_CONF /etc/nginx/sites-enabled/lapakin
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
ok "Nginx configured (HTTP only — jalankan certbot setelah ini)"

# ---------- 10. Final instructions ----------
echo ""
echo "═════════════════════════════════════════════════════════"
ok "SETUP SELESAI"
echo "═════════════════════════════════════════════════════════"
echo ""
echo "📋 LANGKAH SELANJUTNYA:"
echo ""
echo "1. Point DNS A-record $DOMAIN → IP VPS ini (cek: dig $DOMAIN)"
echo ""
echo "2. Install SSL certificate:"
echo "   sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN --redirect"
echo ""
echo "3. Edit backend/.env, isi:"
echo "   - EMERGENT_LLM_KEY"
echo "   - RESEND_API_KEY"
echo "   - MIDTRANS_SERVER_KEY + MIDTRANS_CLIENT_KEY"
echo ""
echo "4. Restart backend:"
echo "   pm2 restart lapakin-backend"
echo ""
echo "5. Test:"
echo "   curl https://$DOMAIN/api/"
echo ""
echo "6. Admin login:"
echo "   Email: admin@lapakin.id"
echo "   Password: (cat ~/lapakin-admin-password.txt)"
echo ""
echo "═════════════════════════════════════════════════════════"
