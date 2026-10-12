#!/bin/bash
# TEST ONLY: real native window/IPC; no synthetic create-node API request.
set -euo pipefail
python3 /fixture/opencode-prepare.py
python3 /fixture/stub-model.py 18827 /evidence/provider-create.jsonl ANSWER_NATIVE_ >/evidence/provider-create-process.log 2>&1 &
provider_pid=$!
cleanup() {
  import -window "${window:-root}" /evidence/create-final.png 2>/dev/null || true
  python3 /fixture/opencode-verify-create.py evidence || true
  kill "$provider_pid" "${app_pid:-$provider_pid}" 2>/dev/null || true
  wait "$provider_pid" 2>/dev/null || true
}
trap cleanup EXIT
# Reuse actual scan/install/auth prerequisites. This script installs its own
# EXIT trap, so restore the combined cleanup immediately after sourcing it.
source /fixture/daemon-ui.sh
trap cleanup EXIT
python3 /fixture/opencode-verify-create.py before
xdotool mousemove --window "$window" 785 766 click 1
sleep 1
xdotool type --clearmodifiers --delay 80 'v2-native'
sleep 1 # Finish native input delivery before advancing the wizard.
xdotool mousemove --window "$window" 1060 441 click 1
sleep 1
xdotool mousemove --window "$window" 1050 685 click --repeat 9 --delay 100 5
sleep 1
import -window "$window" /evidence/create-runtime.png
xdotool mousemove --window "$window" 650 670 click 1
xdotool mousemove --window "$window" 1080 650 click --repeat 9 --delay 100 5
sleep 1
# The compatibility default is V1/headless. Select V2 explicitly before
# granting its separate unsafe-tools consent; do not rely on the old default.
xdotool mousemove --window "$window" 650 645 click 1
sleep 1
xdotool mousemove --window "$window" 1080 650 click --repeat 9 --delay 100 5
sleep 1
import -window "$window" /evidence/create-consent.png
# Explicit V2 unsafe-tools consent for this disposable fixture only.
# Reviewed exact945 create-consent.png: the current Provider catalog note moves
# consent to594. Keep the old package coordinates for historical replay.
consent_y=668
if [ "${TEST_CURRENT_V2_UI:-0}" = 1 ]; then consent_y=594; fi
xdotool mousemove --window "$window" 472 "$consent_y" click 1
sleep 1
import -window "$window" /evidence/create-consent-accepted.png
xdotool mousemove --window "$window" 1059 741 click 1
sleep 1
import -window "$window" /evidence/create-model.png
model_y=416
model_next_y=510
if [ "${TEST_CURRENT_V2_UI:-0}" = 1 ]; then
  # Exact945 create-model.png: Provider note adds height before the text input.
  model_y=497
  model_next_y=590
fi
xdotool mousemove --window "$window" 700 "$model_y" click 1 key ctrl+a
xdotool type --clearmodifiers --delay 80 'stub/stub-model'
sleep 1
xdotool mousemove --window "$window" 1060 "$model_next_y" click 1
sleep 1
import -window "$window" /evidence/create-confirm.png
if [ "${TEST_CREATE_MISS_CLICK:-0}" = 1 ]; then
  xdotool mousemove --window "$window" 1150 750 click 1
else
  xdotool mousemove --window "$window" 1060 674 click 1
fi
python3 /fixture/opencode-verify-create.py after
sleep 2
import -window "$window" /evidence/create-complete.png
echo 'PASS: real native V2 creation and actual runtime task; screenshots require review'
