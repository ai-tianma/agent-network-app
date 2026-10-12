#!/bin/sh
set -eu
probe=/probe/target/release/anet-linux-credential-store
# No session bus: fail closed instead of a successful mock write.
DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/anet-no-session-bus "$probe" unavailable
# Wait for the explicitly unlocked service to own its bus name before probing.
# Reuse the native CI helper so D-Bus cannot race a second daemon into startup.
ANET_ISOLATED_KEYRING_TEST=1 sh /probe/with-linux-test-keyring.sh sh -eu -c '
  /probe/target/release/anet-linux-credential-store missing
  /probe/target/release/anet-linux-credential-store write
  /probe/target/release/anet-linux-credential-store read
'
# Restart both the session bus and service; keep only the fixture user's disk data.
ANET_ISOLATED_KEYRING_TEST=1 sh /probe/with-linux-test-keyring.sh sh -eu -c '
  /probe/target/release/anet-linux-credential-store read
  dbus-send --session --print-reply --dest=org.freedesktop.secrets \
    /org/freedesktop/secrets org.freedesktop.Secret.Service.Lock \
    array:objpath:/org/freedesktop/secrets/collection/login
  timeout 20 /probe/target/release/anet-linux-credential-store unavailable
'
# A fresh, explicitly unlocked session must recover the unchanged stored item.
# --unlock on an already-running locked daemon is not a portable unlock UI.
ANET_ISOLATED_KEYRING_TEST=1 sh /probe/with-linux-test-keyring.sh sh -eu -c '
  /probe/target/release/anet-linux-credential-store read
  /probe/target/release/anet-linux-credential-store delete
  /probe/target/release/anet-linux-credential-store missing
'
echo 'PASS real Secret Service cross-Entry / cross-process / session restart / delete / missing-bus / locked-store'
