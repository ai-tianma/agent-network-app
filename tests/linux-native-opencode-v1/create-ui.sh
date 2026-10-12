#!/bin/bash
# TEST ONLY: safe-default V1 native creation; no API writes or model dispatch.
set -euo pipefail
observer=${TEST_V1_OBSERVER:-/fixture/v1-verify.py}
python3 /fixture/v1-reachability.py >/evidence/v1-reachability-process.log 2>&1 &
reachability_pid=$!
cleanup() {
  import -window "${window:-root}" /evidence/v1-final.png 2>/dev/null || true
  python3 "$observer" evidence || true
  if [ -n "${app_pid:-}" ]; then
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
  kill "$reachability_pid" 2>/dev/null || true
  wait "$reachability_pid" 2>/dev/null || true
}
trap cleanup EXIT
for attempt in $(seq 1 30); do
  kill -0 "$reachability_pid"
  test ! -e /evidence/v1-reachability-ready || break
  sleep 0.1
done
test -e /evidence/v1-reachability-ready
# Simulate ONLY the external availability CONNECT response, not Hub/runtime/UI.
# Product readiness accepts CONNECT 2xx; this fixture cannot carry model calls.
export HTTPS_PROXY=http://127.0.0.1:18829 NO_PROXY=127.0.0.1,localhost
source /fixture/daemon-ui.sh
trap cleanup EXIT
# Optional extension prerequisite; default historical registration is unchanged.
if [ -n "${TEST_V1_READINESS_GATE:-}" ]; then
  python3 "$TEST_V1_READINESS_GATE"
  # Picker reloads every 10s. Wait for its real GET to consume the measured
  # daemon snapshot before selecting it; no API/config mutation or DOM injection.
  sleep 11
  import -window "$window" /evidence/v1-readiness-picker.png
fi
python3 "$observer" before
xdotool mousemove --window "$window" 785 766 click 1
sleep 1
xdotool type --clearmodifiers --delay 80 'v1-native'
sleep 1
xdotool mousemove --window "$window" 1060 441 click 1
sleep 1
xdotool mousemove --window "$window" 1050 685 click --repeat 9 --delay 100 5
sleep 1
import -window "$window" /evidence/v1-runtime.png
# OpenCode is the only usable runtime. Explicitly choose its V1 radio.
xdotool mousemove --window "$window" 650 619 click 1
xdotool mousemove --window "$window" 1080 650 click --repeat 9 --delay 100 5
sleep 1
import -window "$window" /evidence/v1-generation.png
# V1 has no unsafe-tools checkbox. Layout is reviewed before accepting proof.
xdotool mousemove --window "$window" 1059 741 click 1
sleep 1
# V1 offers only the built-in model choices, unlike V2's custom input.
# Keep the reviewed default; no model request is dispatched in this slice.
xdotool mousemove --window "$window" 1060 415 click 1
sleep 1
import -window "$window" /evidence/v1-confirm.png
if [ "${TEST_CREATE_MISS_CLICK:-0}" = 1 ]; then
  xdotool mousemove --window "$window" 1150 750 click 1
else
  xdotool mousemove --window "$window" 1060 632 click 1
fi
python3 "$observer" after
import -window "$window" /evidence/v1-complete.png
echo 'PASS: V1 native creation observer completed; see explicit observer scope; model reply NOT tested'
