#!/bin/bash
# TEST ONLY: every model/stop/start/restart mutation is a real native mouse action.
set -euo pipefail
source /fixture/opencode-create-ui.sh
python3 /fixture/opencode-verify-lifecycle.py baseline
click() { xdotool mousemove --window "$window" "$1" "$2" click 1; }
capture() { import -window "$window" "/evidence/lifecycle-$1.png"; }
click 1060 293 # Finish the successful creation wizard.
sleep 3
click 600 104 # Newly-created node, above the local-daemon group.
sleep 2
click 460 213 # Model/runtime section.
sleep 2
capture model-before
click 817 637
xdotool key --clearmodifiers ctrl+a
xdotool type --clearmodifiers --delay 60 'stub/stub-model-next'
sleep 1 # Let native key events reach the controlled input before Apply.
if [ "${TEST_MODEL_MISS_CLICK:-0}" = 1 ]; then
  click 1100 770
else
  click 662 697
fi
python3 /fixture/opencode-verify-lifecycle.py model
sleep 15 # Allow the real page polling cycle to render the acknowledged state.
capture model-applied
click 432 171 # Overview stop action.
sleep 2
click 760 505
sleep 1
capture stop-confirm
python3 /fixture/opencode-verify-lifecycle.py cancel-before stop
if [ "${TEST_CANCEL_SUBMIT:-0}" = 1 ]; then
  click 755 441 # Deliberate wrong-button negative: this must be detected.
else
  click 660 441 # Return, not confirm.
fi
python3 /fixture/opencode-verify-lifecycle.py cancel-after stop
capture stop-cancelled
click 760 505
sleep 1
click 755 441
python3 /fixture/opencode-verify-lifecycle.py stopped
sleep 15
capture stopped
click 451 550 # Danger section exposes start for the stopped node.
sleep 2
click 660 273
sleep 1
capture start-confirm
python3 /fixture/opencode-verify-lifecycle.py cancel-before start
click 660 450
python3 /fixture/opencode-verify-lifecycle.py cancel-after start
capture start-cancelled
click 660 273
sleep 1
click 755 450
python3 /fixture/opencode-verify-lifecycle.py started
sleep 15
capture started
click 660 273 # Same position now holds Restart; Start is hidden while running.
sleep 1
capture restart-confirm
python3 /fixture/opencode-verify-lifecycle.py cancel-before restart
click 660 441
python3 /fixture/opencode-verify-lifecycle.py cancel-after restart
capture restart-cancelled
click 660 273
sleep 1
click 755 441
python3 /fixture/opencode-verify-lifecycle.py restarted
sleep 15
capture restarted
echo 'PASS: native V2 model/stop/start/restart with authoritative state and real model replies; screenshots require review'
