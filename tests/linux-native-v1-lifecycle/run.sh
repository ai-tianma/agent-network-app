#!/bin/bash
# TEST ONLY: native mouse actions; REST only dispatches proof tasks.
set -euo pipefail
test -z "${TEST_V1_MODEL_PHASE:-}"
test "${TEST_EXPECT_MODEL_REJECTION:-0}" = 0
test "${TEST_WRONG_MODEL:-0}" = 0
source /fixture/v1-model-run.sh
verify() { python3 /fixture/v1-lifecycle-verify.py "$@"; }
capture() { import -window "$window" "/evidence/v1-lifecycle-$1.png"; }
verify baseline
click 432 171
sleep 2
capture overview
click 760 505
sleep 1
capture stop-confirm
verify cancel-before stop
if [ "${TEST_V1_CANCEL_SUBMIT:-0}" = 1 ]; then
  click 755 441
else
  click 660 441
fi
verify cancel-after stop
capture stop-cancelled
click 760 505
sleep 1
click 755 441
verify stopped
sleep 15
capture stopped
click 451 550
sleep 2
capture danger-stopped
click 660 273
sleep 1
capture start-confirm
verify cancel-before start
click 660 450
verify cancel-after start
capture start-cancelled
click 660 273
sleep 1
if [ "${TEST_V1_START_MISS_CLICK:-0}" = 1 ]; then
  click 1100 770
else
  click 755 450
fi
verify started
sleep 15
capture started
click 660 273
sleep 1
capture restart-confirm
verify cancel-before restart
click 660 441
verify cancel-after restart
capture restart-cancelled
click 660 273
sleep 1
click 755 441
verify restarted
sleep 15
capture restarted
echo 'PASS: native V1 stop/start/restart, cancellation, exact identity/model and actual safe ACP replies; TEST ONLY candidate'
