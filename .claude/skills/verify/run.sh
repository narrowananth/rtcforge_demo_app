#!/usr/bin/env bash
# End-to-end verification of ForgeChat's real-time features. See SKILL.md.
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SKILL_DIR/../../.." && pwd)"
PORT="${PORT:-3001}"
BASE="http://localhost:$PORT"

echo "=== [1/3] Node signaling driver (self-contained server) ==="
node "$SKILL_DIR/verify-live.cjs"

echo ""
echo "=== [2/3] Boot the built app for browser drives ==="
if [ ! -f "$REPO/frontend/dist/index.html" ]; then
    echo "frontend not built — building…"
    (cd "$REPO" && pnpm -C frontend build)
fi

DATA_DIR="$(mktemp -d)"
TOKEN_SECRET=verify PORT="$PORT" SFU_LISTEN_IP=127.0.0.1 DATA_DIR="$DATA_DIR" \
    node "$REPO/backend/src/index.js" >"$SKILL_DIR/server.log" 2>&1 &
SRV=$!
cleanup() { kill "$SRV" 2>/dev/null || true; rm -rf "$DATA_DIR"; }
trap cleanup EXIT

for _ in $(seq 1 40); do
    if curl -sf "$BASE/healthz" >/dev/null 2>&1; then break; fi
    sleep 0.5
done
curl -sf "$BASE/healthz" >/dev/null || { echo "server failed to start; see server.log"; exit 1; }
echo "app serving on $BASE"

echo ""
echo "=== [3/3] Browser drives (headless Chromium, fake media) ==="
cd "$SKILL_DIR/browser"
[ -d node_modules/playwright ] || npm install >/dev/null 2>&1
npx playwright install chromium >/dev/null 2>&1 || true

BASE="$BASE" node drive-broadcast.mjs
BASE="$BASE" node drive-call.mjs
BASE="$BASE" node drive-filetransfer.mjs

echo ""
echo "ALL VERIFY DRIVES PASSED — screenshots in $SKILL_DIR/browser/shots/"
