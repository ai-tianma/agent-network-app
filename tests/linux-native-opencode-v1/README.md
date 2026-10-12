# Native V1 startup slice (TEST ONLY)

**Scope: strict copresence diagnostic, not a V1 headless acceptance gate.**
The historical candidate in `../../docs/tests/report-test894-native-v1.txt`
omitted `opencodeMode`, retaining legacy headless behavior while its wizard
incorrectly labeled it TUI copresence. This observer deliberately rejects that
mode mismatch. The newer wizard explicitly labels V1 as compatible headless;
that label correction does not add copresence or make this diagnostic pass.
Use the separate `../linux-native-v1-registration/` gate to verify legacy
registration, and bind its results to the actual package being tested. Neither
the green registration screen nor the corrected label proves model delivery
or full lifecycle compatibility. This suite is not a required CI gate.

This suite is intentionally separate from `linux-native-opencode` (V2). It
drives the installed ANet window with mouse/keyboard, uses the real private
daemon installer, and leaves V1's default unsafe-tools consent **off**. It does
not seed a node, submit a create request by REST, dispatch a model task, or
claim full V1 acceptance. The observer uses only read-only Hub/session calls.

The real V1 readiness monitor checks external `opencode.ai` reachability even
before the wizard enables creation. With `--network none` that check correctly
disables V1. The positive startup fixture therefore supplies a loopback
CONNECT-status responder using the product-supported HTTPS_PROXY setting. It
accepts only `CONNECT opencode.ai:443 HTTP/1.1`, rejects all other targets, and
does not tunnel TLS or implement a model provider. Its successful response is
only an external dependency fixture, NOT proof of real vendor connectivity.
Hub, credentials, installer, daemon, runtime executable and native UI are real.

V1 does not publish the V2 launch-health file. After the mode gate, its observer is designed to bind the
native-created request/network/token/config to the recorded TUI session and
start ticks, then finds exactly one live serve child of the bridge using that
exact config. It checks actual runtime 401 rejection and authenticated session
readback. These post-mode checks have not been reached by the native candidate.
It never exports runtime credentials, complete process environments,
or credential-bearing argv. Screenshots still require human/agent review.

## Rebuild inputs and ordering

1. Build the native fixture as documented in `../linux-native-daemon-ui/` and
   `../linux-native-opencode/`, using the exact candidate source/deb hash. For
   diagnostic replay, use `../linux-native-opencode/overlay.Dockerfile` with a
   downloaded, unexpired TEST-ONLY artifact. This is **not** clean-install proof.
   The source label, deb SHA256 and installed linkage must all pass first.
2. Build the V1 package stage from `sleep2agi/agent-network` exact commit
   `93202f7530471b89b4db977a4c562d869620a8d3`, Dockerfile
   `tests/test894-v1-runtime/Dockerfile`. That stage installs the actual
   `opencode-ai@1.18.34` and validates its version. This suite copies the entire
   package tree, not a replacement executable. Preserve its package-bin path.
3. Build this Dockerfile with `V1_IMAGE`, `NATIVE_IMAGE`, `SOURCE_COMMIT` (40
   characters), `DEB_SHA256` (64 characters). Source/hash must equal the native
   base's bindings. Record both input image IDs and final image ID in evidence.
4. Run `atomic.py` first. Only an exit-zero version/health/401/session gate
   permits native UI execution. A failed prerequisite is not a UI failure.

Example after building the two explicitly bound input images:

```sh
sg docker -c 'docker build --build-arg V1_IMAGE=anet-v1:bound --build-arg NATIVE_IMAGE=anet-native:bound --build-arg SOURCE_COMMIT=<40-char-tested-merge> --build-arg DEB_SHA256=<64-char-deb-sha> -t anet-native-v1:test -f tests/linux-native-opencode-v1/Dockerfile .'
sg docker -c 'docker run --name native-v1-atomic --network none --cap-drop ALL --security-opt no-new-privileges anet-native-v1:test'
# ONLY after the preceding atomic gate passes:
sg docker -c 'docker run --name native-v1-create --network none --cap-drop ALL --security-opt no-new-privileges --shm-size 256m anet-native-v1:test sh /fixture/keyring.sh xvfb-run -a -s "-screen 0 1280x900x24 -nolisten tcp" bash /fixture/v1-create-ui.sh'
```

For the missed-submit negative, use a fresh container with
`-e TEST_CREATE_MISS_CLICK=1`. Require all prerequisite PASS lines, the
`missed submit preserved absent V1 request and identity` line, and exit 1 with
the exact `native V1 create did not produce verified live startup` assertion.
An unrelated startup/install failure is not a passing negative control.

Copy each named container's `/evidence` before removing that exact container.
No host HOME, keychain, tokens, runtime sockets or source directory are mounted;
all identities and persistent state are disposable container data. No production
services, tunnels, backups or public channels are changed. Rebuild rather than
upgrade these throwaway test images; rollback means returning to the recorded
input image/package, never altering a production installation.

## Remaining boundary

The selected `opencode/mimo-v2.6-flash-free` is only configuration input. No vendor call occurs
under `--network none`, and no provider credentials are supplied. V1 safe mode
strips custom provider/baseURL configuration; the older unsafe-tools loopback
runtime test therefore cannot establish native safe-default model delivery.
That requires a separate, explicit fixture design and acceptance. This suite
also does not establish full tool isolation, lifecycle operations, multi-user
behavior, main-branch package provenance or formal release readiness.
