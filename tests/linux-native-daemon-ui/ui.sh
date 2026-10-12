#!/bin/bash
set -euo pipefail
test "$(id -u)" = 10001
test ! -e "$ANET_PACKAGED_SMOKE_ROOT"
printf 'TEST ONLY source=%s deb_sha256=%s\n' "$TEST_DEB_SOURCE_COMMIT" "$TEST_DEB_SHA256"
/usr/bin/agent-network-desktop >/evidence/application.log 2>&1 &
app_pid=$!
trap 'import -window "${window:-root}" /evidence/final.png 2>/dev/null || true; kill "$app_pid" 2>/dev/null || true; wait "$app_pid" 2>/dev/null || true' EXIT
window=''
for attempt in $(seq 1 100); do
  kill -0 "$app_pid"
  window=$(xdotool search --onlyvisible --name '^ANet$' 2>/dev/null | head -1 || true)
  test -z "$window" || break
  sleep 0.3
done
test -n "$window"
xdotool getwindowgeometry "$window" >/evidence/geometry.txt
grep -F 'Geometry: 1200x800' /evidence/geometry.txt
sleep 5
import -window "$window" /evidence/welcome.png
# Reviewed945 native welcome.png: local workspace is at422;470 opens remote login.
xdotool mousemove --window "$window" 600 422 click 1
for attempt in $(seq 1 100); do
  kill -0 "$app_pid"
  test ! -s "$ANET_PACKAGED_SMOKE_ROOT/profiles/index.json" || break
  sleep 0.3
done
python3 /fixture/verify-session.py
# Optional TEST-ONLY source-candidate prefix. It may seed software, never Hub
# credentials/profiles; the normal before/after registration guards still run.
if [ -n "${TEST_DAEMON_PREFIX_PREPARE:-}" ]; then
  python3 "$TEST_DAEMON_PREFIX_PREPARE"
fi
sleep 3
import -window "$window" /evidence/agents.png
# Real mouse input into the fixed, reviewed native 1200x800 layout. No DOM,
# Tauri/HTTP replacement or smoke installer invocation drives these actions.
xdotool mousemove --window "$window" 347 26 click 1
sleep 3
import -window "$window" /evidence/picker.png
python3 /fixture/daemon-ui-verify.py before
xdotool mousemove --window "$window" 453 193 click 1
sleep 4
import -window "$window" /evidence/scan.png
python3 /fixture/daemon-ui-verify.py before
if [ "${TEST_DAEMON_UI_MISS_CLICK:-0}" = 1 ]; then
  xdotool mousemove --window "$window" 1000 650 click 1
else
  xdotool mousemove --window "$window" 615 193 click 1
fi
python3 /fixture/daemon-ui-verify.py after
sleep 3
import -window "$window" /evidence/registered.png
echo 'PASS: native UI install registered matching online daemon; screenshots require review'
