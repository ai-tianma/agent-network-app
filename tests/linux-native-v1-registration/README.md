# Native V1 legacy registration (TEST ONLY)

This is a **separate, narrower gate**, not a relaxed replacement for
`../linux-native-opencode-v1/verify.py`. That copresence diagnostic remains
unchanged. V1's compatible create payload defaults to headless; its model
process is opened on task dispatch, not on registration. This gate does not
claim ACP initialization, model delivery, tool isolation, TUI readiness,
lifecycle acceptance or a V2 launch proof.

The actual installed desktop is driven through X11. Native Secret Service,
local Hub, private daemon installation, node creation and its headless worker
are real. The observer only uses read-only SQLite, Hub GETs and `/proc`. It
never creates a request/node by API or grants unsafe tools. The existing
loopback CONNECT-status fixture simulates only vendor availability (no TLS
or model traffic), as explained in the V1 runtime suite README.

## Bound inputs and order

Build the exact native package and V1 runtime fixture using
`../linux-native-opencode-v1/README.md`. Its version/health/401/session atomic
gate must pass first; reuse an already recorded result only for the identical
input image/source/package. The desktop's profile/auth/401 and daemon
scan/install gates run freshly before each registration case.

The original suite defaults to its strict copresence observer. This Dockerfile
explicitly selects `/fixture/v1-registration.py` using `TEST_V1_OBSERVER`;
no original assertion is deleted or reinterpreted as passed.

```sh
sg docker -c 'docker build --network none --build-arg V1_NATIVE_IMAGE=anet-native-v1:bound --build-arg SOURCE_COMMIT=<40-char-tested-source> --build-arg DEB_SHA256=<64-char-deb-sha> -t anet-v1-registration:test -f tests/linux-native-v1-registration/Dockerfile .'
sg docker -c 'docker run --name v1-registration-positive --network none --cap-drop ALL --security-opt no-new-privileges --shm-size 256m anet-v1-registration:test'
# Only after the positive gate passes:
sg docker -c 'docker run --name v1-registration-missed --network none --cap-drop ALL --security-opt no-new-privileges --shm-size 256m -e TEST_CREATE_MISS_CLICK=1 anet-v1-registration:test'
```

Positive requires exact request/config/token/roster identity, a single live
worker using the exact config, unchanged PID/start ticks after two seconds,
legacy safe-default flags, owner-only profile and no invented V2 launch proof
or TUI attach. Evidence contains IDs and start ticks, never tokens or argv.
Missed-submit must reach the authenticated before-submit gate, preserve absent
request/config/worker/roster and then exit exactly 1 with
`native V1 registration did not bind a live headless worker`.
An earlier environment/authentication/install error is NOT a passing negative.

Copy `/evidence` and container logs before removing only the exact named
containers. No host credentials, sockets or data are mounted. All services,
loopback ports and ephemeral credentials live inside disposable containers;
the inherited Dockerfiles/scripts are the startup authority. No external
secret or production backup is needed. Roll back by rebuilding the recorded
input package/image, never upgrading a running production installation.

Historical package results must not be transferred to newer app commits.
This suite is not yet a required CI gate; native V1 full acceptance stays open.
