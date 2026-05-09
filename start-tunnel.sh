#!/usr/bin/env bash
# Start backend + Expo through Cloudflare quick tunnels. Use when the
# phone and the Mac are on different networks (or the Wi-Fi has client
# isolation enabled). Slightly slower than LAN mode but works anywhere.
#
# Requires `cloudflared` (brew install cloudflared).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PATH="/opt/homebrew/bin:$PATH"
export PATH

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "❌  cloudflared not found. Install it: brew install cloudflared" >&2
  exit 1
fi

echo "🛑  Stopping anything still running…"
pkill -f "node_modules/.bin/expo|expo/bin/cli|metro|cloudflared|node src/index.js|ngrok" 2>/dev/null || true
lsof -nP -iTCP:8082,4001 -sTCP:LISTEN -t 2>/dev/null | xargs -r kill -9 2>/dev/null || true
sleep 3

echo "🟢  Starting backend on :4001"
cd "$ROOT/server"
rm -f /tmp/iq-server.log
nohup node src/index.js > /tmp/iq-server.log 2>&1 &
disown
sleep 1.5

if ! curl -sf -m 3 http://localhost:4001/health > /dev/null; then
  echo "❌  Server failed to start. See /tmp/iq-server.log" >&2
  tail -20 /tmp/iq-server.log >&2 || true
  exit 1
fi

# ── Cloudflare tunnel for API (port 4001) ───────────────────────────
echo "☁️   Starting Cloudflare tunnel for API…"
rm -f /tmp/cf-api.log
nohup cloudflared tunnel --url http://localhost:4001 > /tmp/cf-api.log 2>&1 &
disown

# wait for the tunnel to register
for i in {1..30}; do
  if grep -q "Registered tunnel connection" /tmp/cf-api.log 2>/dev/null; then break; fi
  sleep 1
done
sleep 4
API_URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/cf-api.log | head -1 || true)"
if [[ -z "${API_URL:-}" ]]; then
  echo "❌  API tunnel didn't come up." >&2
  tail -30 /tmp/cf-api.log >&2 || true
  exit 1
fi

# ── Cloudflare tunnel for Metro (port 8082) ─────────────────────────
echo "☁️   Starting Cloudflare tunnel for Metro…"
rm -f /tmp/cf-metro.log
nohup cloudflared tunnel --url http://localhost:8082 > /tmp/cf-metro.log 2>&1 &
disown

for i in {1..30}; do
  if grep -q "Registered tunnel connection" /tmp/cf-metro.log 2>/dev/null; then break; fi
  sleep 1
done
sleep 4
METRO_URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/cf-metro.log | head -1 || true)"
if [[ -z "${METRO_URL:-}" ]]; then
  echo "❌  Metro tunnel didn't come up." >&2
  tail -30 /tmp/cf-metro.log >&2 || true
  exit 1
fi
METRO_HOST="${METRO_URL#https://}"

echo "📝  Pointing mobile config at $API_URL"
python3 - <<PY
import json
p='$ROOT/mobile/app.json'
d=json.load(open(p))
d['expo']['extra']['apiBaseUrl']='$API_URL'
json.dump(d,open(p,'w'),indent=2)
PY

echo "🚀  Starting Expo (advertising Cloudflare hostname)"
cd "$ROOT/mobile"
rm -f /tmp/expo.log
EXPO_PACKAGER_PROXY_URL="$METRO_URL" \
EXPO_MANIFEST_PROXY_URL="$METRO_URL" \
REACT_NATIVE_PACKAGER_HOSTNAME="$METRO_HOST" \
nohup node_modules/.bin/expo start --lan --port 8082 > /tmp/expo.log 2>&1 &
disown

for i in {1..40}; do
  if curl -sf -m 2 http://localhost:8082/status 2>/dev/null | grep -q running; then break; fi
  sleep 1
done

echo
echo "════════════════════════════════════════════════════════════════════════"
echo "  📱  Mobile (Expo Go): exp://$METRO_HOST"
echo "  🌐  API:              $API_URL"
echo "════════════════════════════════════════════════════════════════════════"
echo
echo "👉  Works from any network — phone just needs internet."
echo "👉  Open Expo Go → Enter URL manually → paste the exp:// URL above."
echo "👉  Logs:   tail -f /tmp/expo.log /tmp/cf-api.log /tmp/cf-metro.log"
echo "👉  Stop:   pkill -f \"node src/index.js|node_modules/.bin/expo|cloudflared\""
