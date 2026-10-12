#!/bin/bash
# Every node/config mutation is native X11; only proof task dispatch is REST.
set -euo pipefail
python3 /fixture/v1-model-prepare.py
export SSL_CERT_FILE=/tmp/v1-native-model/fixture.crt
export NODE_EXTRA_CA_CERTS=$SSL_CERT_FILE
source /fixture/v1-create-ui.sh
if [ "${TEST_V1_REGISTRATION_ONLY:-0}" = 1 ]; then
  echo 'PASS: native V1 registration only; model/lifecycle not executed'
  exit 0
fi
click() { xdotool mousemove --window "$window" "$1" "$2" click 1; }
click 1060 293
sleep 3
import -window "$window" /evidence/v1-model-node-list.png
# Reviewed native list: local group first, v1 group second (unlike V2).
click 600 210
sleep 2
click 460 213
sleep 2
import -window "$window" /evidence/v1-model-before.png
click 817 637
xdotool key --clearmodifiers ctrl+a
xdotool type --clearmodifiers --delay 60 "${TEST_SELECTED_MODEL:-openai/gpt-4.1-selected}"
sleep 1
click 662 697
python3 /fixture/v1-model-verify.py
sleep 15
import -window "$window" /evidence/v1-model-replied.png
echo 'PASS: native-created V1 selected-model gate completed; see positive/refusal proof, not lifecycle acceptance'
