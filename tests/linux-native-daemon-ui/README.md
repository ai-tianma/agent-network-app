# Native desktop → daemon UI handoff (TEST ONLY)

This is a narrow prerequisite for the V1/V2 creation lifecycle, not its acceptance.
Run only after the exact package's installation, native startup/authentication and
native daemon installer gates pass. In a fresh non-root offline container, the
installed desktop receives real X11 clicks: local workspace → new node → scan →
install. No web export, mocked Hub, replaced Tauri IPC, or command-line smoke
installer drives the UI. Normal npm uses the accepted image's offline cache.

The verifier reads the native credential only in memory. It first requires that
navigation and scan created neither private credentials nor a daemon profile and
that the authenticated, network-scoped supervisor list is empty. After clicking
install it requires the persisted daemon node/network identity to match a live,
create-capable supervisor in that same Hub. Screenshot review also checks that
the picker stops showing installation progress and presents the online daemon.
Capability to create a node does **not** prove an OpenCode binary is ready.

```sh
sg docker -c 'docker build --build-arg NATIVE_IMAGE=anet-native-daemon:test --build-arg SOURCE_COMMIT=<tested-40-character-SHA> --build-arg DEB_SHA256=<actual-64-character-deb-hash> -t anet-native-daemon-ui:test -f tests/linux-native-daemon-ui/Dockerfile .'
sg docker -c 'docker run --name native-daemon-ui-proof --network none --cap-drop ALL --security-opt no-new-privileges --shm-size 256m anet-native-daemon-ui:test'
# Copy /evidence from this stopped container, review screenshots, then remove it.
# Only after the positive case passes: this MUST exit nonzero with the precise
# "UI install click did not register matching online daemon" assertion.
sg docker -c 'docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges --shm-size 256m -e TEST_DAEMON_UI_MISS_CLICK=1 anet-native-daemon-ui:test'
```

The missed-click case clicks inert background after the same scan and runs the
same acceptance (20-second observation instead of 150-second installation wait).
Unexpected setup errors are not accepted as a negative-control pass. The fixed
1200×800 window geometry and reviewed screenshot targets are intentional; layout
changes require updating and reviewing these targets, never skipping assertions.
Before/after screenshots and source/hash-bound registration evidence go to
`/evidence`. Do not copy credential/config databases into public artifacts.

Rebuild from repository Dockerfiles and a source/hash-bound TEST ONLY package;
no remembered host files, production secrets, persistent service, proxy, tunnel,
external port or backup is required. Loopback Hub and Secret Service are private
to the container. App process cleanup is trapped; container removal is the final
boundary for child daemon/Hub processes and temporary credentials. There is no
production upgrade or rollback action: discard the fixture to reset. Evidence
retention is not a production data backup. Full V1/V2 launch proof, model changes,
stop/restart and formal main-SHA release remain separate gates.
