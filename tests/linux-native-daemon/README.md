# Packaged native daemon installer (TEST ONLY, #894)

This suite invokes the real packaged `--smoke-local-daemon-install` path: bundled
Hub, native Secret Service credentials, native Rust installer, npm, CLI and
agent-node. It is not a UI click test or an OpenCode V2 lifecycle test.

Run prerequisite gates in order: `linux-deb-package`, `linux-deb-install`,
`linux-native-workspace` startup/auth, and `local-daemon-packages` policy and
real private-prefix checks. Stop on the first failure. Build the following only
from their accepted images. `SOURCE_COMMIT` is the full **tested merge SHA** and
`DEB_SHA256` the actual tested deb hash, not a floating PR head or release label.

```sh
sg docker -c 'docker build --build-arg NATIVE_IMAGE=anet-native-workspace:test --build-arg PAIR_IMAGE=anet-daemon-prefix:test --build-arg SOURCE_COMMIT=<40-character-tested-source> --build-arg DEB_SHA256=<64-character-deb-sha256> -t anet-native-daemon:test -f tests/linux-native-daemon/Dockerfile .'
sg docker -c 'docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges anet-native-daemon:test'
# Only after the empty-prefix case succeeds:
sg docker -c 'docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges anet-native-daemon:test sh /fixture/keyring.sh bash /fixture/native-daemon.sh exact'
# Only after both positive cases succeed:
sg docker -c 'docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges anet-native-daemon:test sh /fixture/keyring.sh bash /fixture/native-daemon.sh partial'
# Real historical npm packages, after the current-pair gates above:
sg docker -c 'docker build --build-arg NATIVE_IMAGE=anet-native-daemon:test -t anet-native-daemon:legacy -f tests/linux-native-daemon/Dockerfile.legacy .'
sg docker -c 'docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges anet-native-daemon:legacy'
sg docker -c 'docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges anet-native-daemon:legacy sh /fixture/keyring.sh bash /fixture/native-daemon.sh old-node'
# Probe process faults, only after current/historical package checks:
sg docker -c 'docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges anet-native-daemon:test sh /fixture/keyring.sh bash /fixture/native-daemon.sh failed-cli'
sg docker -c 'docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges anet-native-daemon:test sh /fixture/keyring.sh bash /fixture/native-daemon.sh timeout-cli'
```

Both cases run as UID10001 in a fresh container, without host state mounts. Full
Node/npm and a normal npm cache are copied from the already tested exact-pair
image. `npm_config_offline=true` plus `--network none` prevents registry or
production access; loopback remains available to the isolated Hub. Empty case
starts without a private prefix; exact case seeds the reviewed pair and checks
its file contents/modes/symlinks remain unchanged. The seeded prefix is mode0700,
matching product-created private directories (an initial fixture with mode0755
correctly observed the product tightening only the root directory to0700).
Partial case removes only agent-node's entrypoint inside the disposable fixture,
requires the specific pairing refusal and exit1 (not a timeout/arbitrary error),
and asserts no package rewrite, private Hub credentials, daemon profile or start
log. It is a deliberately corrupted package, not proof of real old-version
compatibility. This fingerprint is not proof
of npm tarball provenance or by itself proof that no npm command was invoked.
The additional legacy image installs actual historical CLI `2.3.0-preview.76`
paired with current agent-node, and historical agent-node `2.5.0-preview.58`
paired with current CLI, under separate prefixes. Normal npm install scripts
and real version/help executables run during build; no edited version metadata
or success-printing CLI shim is used. Each runtime case confirms both manifest
versions before/after, exact refusal text and exit1, unchanged prefix fingerprint,
and no private credential/profile/start files. These verify refusal without
replacement, **not** automatic migration or ability to run a V1 session.
Two additional fault-injection cases replace only the fixture's bin symlink with
a forwarding wrapper, leaving the real CLI package entry intact. The wrapper
runs that real entry and requires its successful exact version output before
injecting exit23 or a60-second hang. Other commands still call the real entry.
The verifier requires the recorded real successful probe, exact native failure
reason (nonzero vs timeout), unchanged injected-prefix fingerprint and no
daemon private credential/profile/start files. Timeout must return native exit1
within30–90 seconds, not outer-watchdog exit124; product's30-second limit is not
shortened for tests. These are explicit fault injections, NOT real damaged npm
releases. Container removal is the final cleanup boundary for any probe children.
The native smoke requires supervisor registration and a matching profile/node
ID on rescan, and attempts to stop daemon/Hub afterward. Container removal is
the final process/state cleanup boundary. No user credentials are seeded.

For local diagnosis using an already CI-accepted downloaded TEST ONLY artifact,
`Dockerfile.artifact` can replace the deb in an existing fixture. Its build
context is the artifact directory containing exactly one deb and TEST-ONLY.txt;
provide `FIXTURE_IMAGE`, exact `SOURCE_COMMIT`, and `DEB_SHA256`. It verifies the
artifact source line and hash before `dpkg -i`. This is explicitly an **overlay
diagnostic**, not a clean-install result; retain the original CI clean-install
evidence separately. Never present fixture-only/older packaged code as validation
of a newer installer, and never publish these images or debs as releases.

Authoritative product startup/install code remains `src-tauri/src/local_daemon.rs`
and `local_hub.rs`; fixtures do not alter ports, reverse proxies or production
configuration. All test data and credentials are disposable. No production
backup is included or restored. Changing version means rebuilding from exact
inputs; rollback means discarding this test container, not rewriting user data.
Other malformed-package paths, actual V1 session compatibility and complete V2
create/model/start/stop remain separate outstanding integration cases.
