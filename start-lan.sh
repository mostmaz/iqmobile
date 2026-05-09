#!/usr/bin/env bash
# Start backend + Expo in LAN mode. Use when the phone and the Mac are on
# the same Wi-Fi network (no client isolation). Faster than tunnel mode
# because the phone hits the Mac directly over the LAN.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PATH="/opt/homebrew/bin:$PATH"
export PATH

echo "🛑  Stopping anything still running…"
pkill -f "node_modules/.bin/expo|expo/bin/cli|metro|cloudflared|node src/index.js" 2>/dev/null || true
lsof -nP -iTCP:8082,4001 -sTCP:LISTEN -t 2>/dev/null | xargs -r kill -9 2>/dev/null || true
sleep 2

# Pick the first non-loopback IPv4 address from en0 (Wi-Fi on Mac) or en1.
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
if [[ -z "${IP:-}" ]]; then
  echo "❌  No Wi-Fi address on en0/en1. Connect to Wi-Fi and retry." >&2
  exit 1
fi
echo "📡  LAN IP: $IP"

echo "🟢  Starting backend on :4001"
cd "$ROOT/server"
rm -f /tmp/iq-server.log
nohup node src/index.js > /tmp/iq-server.log 2>&1 &
disown
sleep 1.5

# Quick health check
if ! curl -sf -m 3 http://localhost:4001/health > /dev/null; then
  echo "❌  Server failed to start. See /tmp/iq-server.log" >&2
  tail -20 /tmp/iq-server.log >&2 || true
  exit 1
fi

echo "📝  Pointing mobile config at http://$IP:4001"
python3 - <<PY
import json
p='$ROOT/mobile/app.json'
d=json.load(open(p))
d['expo']['extra']['apiBaseUrl']=f'http://$IP:4001'
json.dump(d,open(p,'w'),indent=2)
PY

echo "🚀  Starting Expo (LAN mode)"
cd "$ROOT/mobile"
rm -f /tmp/expo.log
REACT_NATIVE_PACKAGER_HOSTNAME="$IP" nohup node_modules/.bin/expo start --lan --port 8082 > /tmp/expo.log 2>&1 &
disown

# Wait for Metro to come up
for i in {1..40}; do
  if curl -sf -m 2 http://localhost:8082/status 2>/dev/null | grep -q running; then break; fi
  sleep 1
done

echo
echo "════════════════════════════════════════"
echo "  📱  Mobile (Expo Go): exp://$IP:8082"
echo "  🌐  API:              http://$IP:4001"
echo "════════════════════════════════════════"
echo
echo "👉  Make sure your phone is on the SAME Wi-Fi (subnet ${IP%.*}.x)."
echo "👉  Logs:   tail -f /tmp/expo.log /tmp/iq-server.log"
echo "👉  Stop:   pkill -f \"node src/index.js|node_modules/.bin/expo\""
