# TEST ONLY: real V2 runtime prerequisite

This independent Docker suite layers onto the accepted native daemon UI image.
It installs the actual integrity-locked `@opencode/cli@2.0.22` runtime. Only the
loopback model provider is a fixture; there is no vendor credential, production
Hub, global host install, HTTP/Tauri mock, or substituted OpenCode executable.

Prerequisites, in order: native startup/authentication, private exact package
installation, native UI daemon handoff. Then:

```sh
sg docker -c 'docker build --build-arg NATIVE_IMAGE=anet-native-daemon-ui:test --build-arg SOURCE_COMMIT=<40-char-tested-source> --build-arg DEB_SHA256=<64-char-deb-hash> -t anet-native-opencode:test -f tests/linux-native-opencode/Dockerfile .'
sg docker -c 'docker run --name native-opencode-atomic --network none --cap-drop ALL --security-opt no-new-privileges anet-native-opencode:test'
```

`atomic.py` requires runtime health, HTTP401 without authentication, a real
session's assistant reply with a provider-only marker, idle state, and exact
model transport. A second fresh container with `TEST_WRONG_MODEL=1` must fail
specifically with `AssertionError: provider model mismatch`, after the same
prerequisites. A generic process error is not an accepted negative.

CI preserves `/evidence` in the TEST-ONLY artifact, then removes the container.
Do not preserve the temporary runtime HOME or native credential store. The
Python runner stops process groups; container removal is the final cleanup
boundary. Failed prerequisite gates block dependent tests.

The default atomic command **does not prove native UI creation or V1/V2 lifecycle**. For isolated
creation diagnosis only, `prepare.py` seeds a node-scoped provider config before
the native wizard creates `v2-native` in `/home/smoke/v2-native`. It never writes
a node identity/profile. Start the fixture provider on loopback18827, use real
native mouse input to choose OpenCode V2, explicitly accept its unsafe-tools
warning, enter `stub/stub-model`, and submit. No fixture tool calls should be
requested. Keep launch failure distinct from successful daemon registration.
The initial accepted507 package failed here because its daemon profile omitted
the private pair from `daemonExtraPath`; see `docs/tests/report-test894.txt`.

## Native creation follow-up (separate from the atomic prerequisite)

`create-ui.sh` automates that real mouse sequence and delegates read-only launch
observation to `verify-create.py`. It reuses native authentication and private
installer checks before submitting anything. Run only after the exact candidate
package passes those prerequisites and the atomic runtime checks above:

The driver explicitly selects V2 before its separate unsafe-tools consent.
The product defaults to V1/headless; selecting the OpenCode runtime alone is
not a V2 selection. The unchanged observer still requires V2/copresence, explicit
consent, exact model, live launch proof and the actual provider reply. Diagnostic
replay can use a cached descendant image only when its V2 dependency lock matches;
`overlay.Dockerfile` reselects and version-checks that existing V2 executable.
It never treats such package overlay replay as a clean install or release gate.

```sh
sg docker -c 'docker run --name native-opencode-create --network none --cap-drop ALL --security-opt no-new-privileges --shm-size 256m anet-native-opencode:test sh /fixture/keyring.sh xvfb-run -a -s "-screen 0 1280x900x24 -nolisten tcp" bash /fixture/opencode-create-ui.sh'
```

The creation request must come from native UI/IPC. The verifier reads only the
isolated database and authenticated launch-proof API, requires exact persisted
V2/consent/model/node/network, checks live process generations and non-revoked
child credentials, then sends one test task via **REST** and verifies the actual
model response. It does not claim UI task dispatch, model-switch, restart or V1
coverage. `TEST_CREATE_MISS_CLICK=1` is a separate negative requiring no request
or node identity and the precise missing-launch assertion. Screenshot review is
still required. Syntax checks alone do not establish either execution outcome;
consult the exact-source test report before reusing any claimed result.

Copy only `/evidence` before removing the container, including failed runs.
Container removal remains the final cleanup for all daemon/runtime descendants.
No production state may be mounted. After exercising the exact85040c7 package's
positive and missed-submit negative (see the report), CI now runs both after
the atomic runtime gates and preserves their evidence even on failure. The
new CI execution must pass on its own head; the earlier package result is not
inherited as a green result for later test commits.

## Native V2 model and lifecycle follow-up

`lifecycle-ui.sh` first runs the accepted native creation prerequisites in a fresh
container, then uses the real node details UI to change to `stub/stub-model-next`,
stop, start and restart. `verify-lifecycle.py` observes the authenticated Hub and
read-only SQLite plus the exact runtime process identities. Every transition
requires the same node/network identity, the requested persisted model, a new
live generation after start/restart, disappearance of the previous live process
identities, and an actual response using the expected provider model. Stop must
retain the configuration and active child token. The observer sends proof tasks
via REST; it never invokes a config/lifecycle mutation API.

```sh
sg docker -c 'docker run --name native-opencode-lifecycle --network none --cap-drop ALL --security-opt no-new-privileges --shm-size 256m anet-native-opencode:test sh /fixture/keyring.sh xvfb-run -a -s "-screen 0 1280x900x24 -nolisten tcp" bash /fixture/opencode-lifecycle-ui.sh'
```

The companion fresh-container negative sets `TEST_MODEL_MISS_CLICK=1`. It must
fail with `native model switch did not apply` after proving zero config updates
and unchanged model/revision/generation/process identities. A generic startup
failure does not count. The real node page polls every ten seconds, so the
driver allows fifteen seconds before screenshots and subsequent UI actions.
Hub acknowledgment can precede runtime health-file creation; missing startup
files remain pending within the bounded wait, never an accepted success.
This suite does not prove V1 compatibility, native UI task dispatch or release.
Before each stop/start/restart confirmation, the driver now clicks Return and
observes fifteen seconds of unchanged request history, lifecycle state, full
configuration hash, revision, active credential and exact live process generation
(or continued absence of the stopped processes). It then reopens the dialog and
performs the original positive confirmation. Cancellation observation is read-only;
no mutation API substitutes for the native mouse input. The isolated
`TEST_CANCEL_SUBMIT=1` negative deliberately clicks Confirm instead of Return for
Stop and must be caught as a lifecycle mutation, not counted as cancellation.
This is separate from the missed-model-submit negative. A new driver tested with
an older package only establishes behavior for that older package; #895 still
requires screenshots/behavior from its own exact fixed native package.
For local replay, prefer the image's copied scripts or copy scripts into a
stopped disposable container before starting it. Do not edit a live bind-mounted
shell script: the interpreter can resume at stale byte offsets. Such a run is
invalidated, not a product failure or acceptance result. CI copies the scripts
into the fixture image and never bind-mounts a mutable working tree.
The cancellation-specific accepted runs, rejected exploratory attempts and
exact old-package boundary are in `docs/tests/report-test895-native-cancel.txt`.
After the fresh packaged positive/negative recorded in report-test894 passed,
CI enables this follow-up after the creation gates, with separate always-run
evidence preservation and cleanup. Do not inherit the earlier package's result
as acceptance of a later CI candidate.

For local diagnostic reuse of a CI artifact, `overlay.Dockerfile` accepts
`--build-context candidate=<downloaded-artifact-directory>` plus explicit
`FIXTURE_IMAGE`, `DEB_FILE`, `SOURCE_COMMIT` and `DEB_SHA256` arguments. Use an
already validated runtime fixture image, inspect the workflow/run/head and
artifact identity, and pass the **tested merge SHA** from `TEST-ONLY.txt`, not
the PR head. The build binds that source record and the deb checksum before
installing. This overlay is never a clean-machine-install claim, never a public
release, and must not replace the original CI clean-install prerequisite.

The Docker build downloads dependencies; executions are network-isolated. The
lockfile comes from backend `tests/test883-v2-portable-client/tools` at
`2d964c3533e81c2e8005f6525b69be80b754722e`, retaining only OpenCode and its optional
platform packages. `stub-model.py` provenance is recorded in its source. The
workflow builds new packages from its tested SHA; old diagnostic artifacts must
never be described as post-fix package acceptance or public releases.
