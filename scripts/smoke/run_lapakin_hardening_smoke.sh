#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -euo pipefail

BASE_URL="${BASE_URL:-https://dev.lapakin.my.id}"
TEST_EMAIL="${TEST_EMAIL:-warungbusari@demo.lapakin.id}"
TEST_PASSWORD="${TEST_PASSWORD:-demo12345}"
STORE_SLUG="${STORE_SLUG:-warung-bu-sari}"
NODE_PATH="${NODE_PATH:-/tmp/lapakin-playwright/node_modules}"

cd /home/ubuntu01/LapakinUMKM/frontend

echo "[lapakin-v2] running existing UI smoke"
NODE_PATH="$NODE_PATH" BASE_URL="$BASE_URL" TEST_EMAIL="$TEST_EMAIL" TEST_PASSWORD="$TEST_PASSWORD" node /tmp/lapakin_ui_smoke_test.js

echo "[lapakin-v2] running existing API/demo flow smoke"
BASE_URL="$BASE_URL" TEST_EMAIL="$TEST_EMAIL" TEST_PASSWORD="$TEST_PASSWORD" STORE_SLUG="$STORE_SLUG" python3 /tmp/test_demo_user_flow.py

echo "[lapakin-v2] running added UI hardening smoke v2"
NODE_PATH="$NODE_PATH" BASE_URL="$BASE_URL" TEST_EMAIL="$TEST_EMAIL" TEST_PASSWORD="$TEST_PASSWORD" STORE_SLUG="$STORE_SLUG" node "$SCRIPT_DIR/lapakin_ui_hardening_smoke_test.js"

echo "[lapakin-v2] running added API hardening smoke v2"
BASE_URL="$BASE_URL" TEST_EMAIL="$TEST_EMAIL" TEST_PASSWORD="$TEST_PASSWORD" STORE_SLUG="$STORE_SLUG" python3 "$SCRIPT_DIR/test_demo_hardening_api_flow.py"
