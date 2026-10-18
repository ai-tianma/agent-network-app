#!/bin/sh
# CI/test-only: use in an isolated Docker user session, never a live desktop.
set -eu
if [ "${ANET_ISOLATED_KEYRING_TEST:-}" != "1" ]; then
  echo 'Refusing to unlock a keyring outside an explicitly isolated test session' >&2
  exit 2
fi
exec dbus-run-session -- sh -eu -c '
  export GNOME_KEYRING_CONTROL="$(mktemp -d)"
  # Keep the one test daemon in the foreground. A daemonizing --unlock may
  # return before D-Bus ownership, allowing auto-activation to race its writes.
  printf "%s" "dummy-keyring-password" | gnome-keyring-daemon --foreground --unlock --components=secrets --control-directory "$GNOME_KEYRING_CONTROL" &
  keyring_pid=$!
  trap "kill $keyring_pid 2>/dev/null || true" EXIT
  attempt=0
  while ! dbus-send --session --print-reply --reply-timeout=1000 --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.NameHasOwner string:org.freedesktop.secrets | grep -q "boolean true"; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 100 ] || ! kill -0 "$keyring_pid" 2>/dev/null; then
      echo "FAIL: isolated Secret Service did not acquire D-Bus name" >&2
      exit 1
    fi
    sleep 0.1
  done
  # Ownership alone does not prove the login collection is unlocked. Require
  # one real write/read/delete before any application test starts; no mock.
  printf "%s" "fixture-ready" | timeout 10 secret-tool store --label=anet-test-readiness service anet-test-readiness
  test "$(timeout 10 secret-tool lookup service anet-test-readiness)" = "fixture-ready"
  timeout 10 secret-tool clear service anet-test-readiness
  echo "PASS: isolated Secret Service ready (write/read/delete)"
  "$@"
' sh "$@"
