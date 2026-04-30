#!/bin/bash
#
# update-lapakin.sh — Smart deployment update for Lapakin VPS
#
# Cek perubahan terbaru dari git, rebuild bagian yang perlu saja,
# jalankan migration kalau ada, restart backend + reload nginx, health-check.
# Idempotent: aman dijalankan berkali-kali walau gak ada perubahan.
#
# Pasang sekali di VPS:
#   chmod +x ~/update-lapakin.sh
#   atau symlink ke /usr/local/bin/update-lapakin
#
# Jalankan: ./update-lapakin.sh
# Dengan opsi:
#   --force-frontend   : rebuild frontend walau gak ada perubahan
#   --force-backend    : reinstall backend deps walau requirements.txt sama
#   --no-pull          : skip git pull (deploy local changes only)
#   --seed             : jalankan seed_demo_shops setelah update
#   --skip-health      : skip health-check di akhir
#

set -euo pipefail

APP_DIR="${APP_DIR:-/home/lapakin/LapakinUMKM}"
DOMAIN="${DOMAIN:-lapakin.my.id}"
PM2_NAME="${PM2_NAME:-lapakin-backend}"
HEALTH_URL="${HEALTH_URL:-https://$DOMAIN/api/}"

# ---------- Flags ----------
FORCE_FRONTEND=0
FORCE_BACKEND=0
NO_PULL=0
RUN_SEED=0
SKIP_HEALTH=0
for arg in "$@"; do
  case "$arg" in
    --force-frontend) FORCE_FRONTEND=1 ;;
    --force-backend)  FORCE_BACKEND=1 ;;
    --no-pull)        NO_PULL=1 ;;
    --seed)           RUN_SEED=1 ;;
    --skip-health)    SKIP_HEALTH=1 ;;
    -h|--help)
      grep '^#' "$0" | head -25 | sed 's/^# \{0,1\}//'
      exit 0
      ;;
  esac
done

# ---------- Colors ----------
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${B}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${G}✅ $*${NC}"; }
warn() { echo -e "${Y}⚠️  $*${NC}"; }
err()  { echo -e "${R}❌ $*${NC}"; }

# ---------- Pre-checks ----------
if [[ ! -d "$APP_DIR" ]]; then
  err "Folder $APP_DIR tidak ada"
  exit 1
fi
cd "$APP_DIR"

if [[ ! -d ".git" ]]; then
  err "Bukan git repo"
  exit 1
fi

OLD_COMMIT=$(git rev-parse HEAD)
log "Commit saat ini: ${OLD_COMMIT:0:8}"

# ---------- 1. Git pull ----------
if [[ $NO_PULL -eq 1 ]]; then
  warn "Skip git pull (--no-pull)"
else
  log "Git fetch..."
  git fetch origin --quiet

  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
  REMOTE_COMMIT=$(git rev-parse "origin/$CURRENT_BRANCH")

  if [[ "$OLD_COMMIT" == "$REMOTE_COMMIT" ]]; then
    log "Sudah up-to-date dengan origin/$CURRENT_BRANCH"
  else
    log "Update ${OLD_COMMIT:0:8} → ${REMOTE_COMMIT:0:8}"
    git reset --hard "origin/$CURRENT_BRANCH" --quiet
    ok "Git updated"
  fi
fi

NEW_COMMIT=$(git rev-parse HEAD)

# ---------- 2. Detect what changed ----------
if [[ "$OLD_COMMIT" == "$NEW_COMMIT" ]]; then
  CHANGED_FILES=""
else
  CHANGED_FILES=$(git diff --name-only "$OLD_COMMIT" "$NEW_COMMIT")
fi

backend_changed=0
frontend_changed=0
requirements_changed=0
package_changed=0

if [[ $FORCE_BACKEND -eq 1 ]]; then
  backend_changed=1
  requirements_changed=1
fi
if [[ $FORCE_FRONTEND -eq 1 ]]; then
  frontend_changed=1
  package_changed=1
fi

if [[ -n "$CHANGED_FILES" ]]; then
  echo "$CHANGED_FILES" | grep -q "^backend/" && backend_changed=1 || true
  echo "$CHANGED_FILES" | grep -q "^frontend/" && frontend_changed=1 || true
  echo "$CHANGED_FILES" | grep -q "^backend/requirements.txt$" && requirements_changed=1 || true
  echo "$CHANGED_FILES" | grep -q "^frontend/package.json$" && package_changed=1 || true
  echo "$CHANGED_FILES" | grep -q "^frontend/yarn.lock$" && package_changed=1 || true
fi

[[ $backend_changed -eq 1 ]] && log "🐍 Backend changed"
[[ $frontend_changed -eq 1 ]] && log "⚛️  Frontend changed"

# ---------- 3. Backend update ----------
if [[ $backend_changed -eq 1 ]]; then
  cd "$APP_DIR/backend"

  if [[ ! -d ".venv" ]]; then
    log "Creating .venv..."
    python3.11 -m venv .venv
    requirements_changed=1
  fi

  # shellcheck source=/dev/null
  source .venv/bin/activate

  if [[ $requirements_changed -eq 1 ]]; then
    log "Installing backend deps..."
    pip install --upgrade pip --quiet
    pip install -r requirements.txt --quiet
    pip install emergentintegrations \
      --extra-index-url https://d33sy5i8bnduwe.cloudfront.net/simple/ \
      --quiet || warn "emergentintegrations install gagal, lanjut tanpa"
    ok "Backend deps updated"
  else
    log "requirements.txt tidak berubah, skip pip install"
  fi

  deactivate
fi

# ---------- 4. Frontend update ----------
if [[ $frontend_changed -eq 1 ]]; then
  cd "$APP_DIR/frontend"

  if [[ ! -f ".env" ]]; then
    log "Creating frontend/.env..."
    echo "REACT_APP_BACKEND_URL=https://$DOMAIN" > .env
  fi

  if [[ $package_changed -eq 1 ]] || [[ ! -d "node_modules" ]]; then
    log "Installing frontend deps (yarn install)..."
    yarn install --silent
  else
    log "package.json/yarn.lock tidak berubah, skip yarn install"
  fi

  log "Building frontend (yarn build)..."
  yarn build > /tmp/yarn-build.log 2>&1 || {
    err "yarn build gagal. Last 30 lines:"
    tail -30 /tmp/yarn-build.log
    exit 1
  }
  ok "Frontend built"

  log "Fixing permissions..."
  sudo chmod -R o+rX "$APP_DIR/frontend/build"
  ok "Permissions OK"
fi

# ---------- 5. Optional seed ----------
if [[ $RUN_SEED -eq 1 ]]; then
  cd "$APP_DIR/backend"
  log "Running seed_demo_shops..."
  source .venv/bin/activate
  python -m scripts.seed_demo_shops || warn "Seed gagal, lanjut deploy"
  deactivate
fi

# ---------- 6. Restart services ----------
if [[ $backend_changed -eq 1 ]]; then
  log "Restarting backend (pm2)..."
  pm2 restart "$PM2_NAME" --update-env > /dev/null
  pm2 save --silent > /dev/null
  ok "Backend restarted"
fi

if [[ $frontend_changed -eq 1 ]]; then
  log "Reloading nginx..."
  sudo nginx -t > /dev/null 2>&1 || {
    err "Nginx config error"
    sudo nginx -t
    exit 1
  }
  sudo systemctl reload nginx
  ok "Nginx reloaded"
fi

# ---------- 7. Health check ----------
if [[ $SKIP_HEALTH -eq 0 ]]; then
  log "Health check..."
  sleep 2

  if command -v curl >/dev/null 2>&1; then
    HTTP_CODE=$(curl -s -o /tmp/health.txt -w "%{http_code}" "$HEALTH_URL" || echo "000")
  elif command -v wget >/dev/null 2>&1; then
    if wget -qO /tmp/health.txt "$HEALTH_URL"; then
      HTTP_CODE=200
    else
      HTTP_CODE=000
    fi
  else
    warn "curl/wget tidak ada, skip health-check"
    HTTP_CODE=200
  fi

  if [[ "$HTTP_CODE" == "200" ]]; then
    ok "Backend healthy: $HEALTH_URL → 200"
    if [[ -f /tmp/health.txt ]]; then
      RESPONSE=$(cat /tmp/health.txt)
      log "Response: $RESPONSE"
    fi
  else
    err "Backend tidak respons (HTTP $HTTP_CODE)"
    err "Cek log: pm2 logs $PM2_NAME --lines 30"
    exit 1
  fi
fi

# ---------- 8. Summary ----------
echo ""
echo "═════════════════════════════════════════════════════════"
ok "DEPLOY SELESAI"
echo "═════════════════════════════════════════════════════════"

if [[ "$OLD_COMMIT" != "$NEW_COMMIT" ]]; then
  echo ""
  log "Changelog (${OLD_COMMIT:0:8} → ${NEW_COMMIT:0:8}):"
  git log --oneline "$OLD_COMMIT".."$NEW_COMMIT" | head -10 | sed 's/^/  /'
fi

echo ""
log "Status:"
pm2 list | grep -E "name|$PM2_NAME" || true
echo ""
echo "URL: https://$DOMAIN"
echo ""
