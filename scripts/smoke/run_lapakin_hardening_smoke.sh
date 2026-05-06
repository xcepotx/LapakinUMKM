#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -euo pipefail

BASE_URL="${BASE_URL:-https://dev.lapakin.my.id}"
TEST_EMAIL="${TEST_EMAIL:-warungbusari@demo.lapakin.id}"
TEST_PASSWORD="${TEST_PASSWORD:-demo12345}"
STORE_SLUG="${STORE_SLUG:-warung-bu-sari}"
NODE_PATH="${NODE_PATH:-/tmp/lapakin-playwright/node_modules}"

cd $REPO_ROOT/frontend

echo "[lapakin-v2] running existing UI smoke"
NODE_PATH="$NODE_PATH" BASE_URL="$BASE_URL" TEST_EMAIL="$TEST_EMAIL" TEST_PASSWORD="$TEST_PASSWORD" node /tmp/lapakin_ui_smoke_test.js

echo "[lapakin-v2] running existing API/demo flow smoke"
BASE_URL="$BASE_URL" TEST_EMAIL="$TEST_EMAIL" TEST_PASSWORD="$TEST_PASSWORD" STORE_SLUG="$STORE_SLUG" python3 /tmp/test_demo_user_flow.py

echo "[lapakin-v2] running added UI hardening smoke v2"
NODE_PATH="$NODE_PATH" BASE_URL="$BASE_URL" TEST_EMAIL="$TEST_EMAIL" TEST_PASSWORD="$TEST_PASSWORD" STORE_SLUG="$STORE_SLUG" node "$SCRIPT_DIR/lapakin_ui_hardening_smoke_test.js"

echo "[lapakin-v2] running added API hardening smoke v2"
BASE_URL="$BASE_URL" TEST_EMAIL="$TEST_EMAIL" TEST_PASSWORD="$TEST_PASSWORD" STORE_SLUG="$STORE_SLUG" python3 "$SCRIPT_DIR/test_demo_hardening_api_flow.py"


echo "[lapakin-v2] running optional admin smoke"
if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  NODE_PATH=/tmp/lapakin-playwright/node_modules \
  BASE_URL="${BASE_URL:-https://dev.lapakin.my.id}" \
  ADMIN_EMAIL="${ADMIN_EMAIL}" \
  ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
  node "$SCRIPT_DIR/lapakin_admin_smoke_test.js"
elif [ "${REQUIRE_ADMIN_SMOKE:-0}" = "1" ]; then
  echo "[lapakin-v2][ERROR] REQUIRE_ADMIN_SMOKE=1 but ADMIN_EMAIL/ADMIN_PASSWORD not set" >&2
  exit 1
else
  echo "[lapakin-v2][SKIP] ADMIN_EMAIL/ADMIN_PASSWORD not set; admin smoke skipped"
fi
