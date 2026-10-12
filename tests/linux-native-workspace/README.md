# Native Linux local workspace gate — TEST ONLY (#893)

Run only after `tests/linux-deb-package` and `tests/linux-deb-install` pass.
Those repository recipes rebuild the upstream image from an exact Git SHA and
verify the deb hash. This fixture additionally checks both expected values
against the installed-image metadata. Local image names are build handles, not
authoritative product versions; record the resolved image ID as well.

```sh
sg docker -c 'docker build --build-arg INSTALL_IMAGE=anet-linux-install:test --build-arg SOURCE_COMMIT=FULL_PRODUCT_SHA --build-arg DEB_SHA256=VERIFIED_DEB_HASH -t anet-native-workspace:test -f tests/linux-native-workspace/Dockerfile .'
sg docker -c 'docker run --rm --network none anet-native-workspace:test'
sg docker -c 'docker run --name native-workspace-proof --network none anet-native-workspace:test sh /fixture/keyring.sh xvfb-run -a -s "-screen 0 1280x900x24 -nolisten tcp" bash /fixture/ui.sh'
sg docker -c 'docker cp native-workspace-proof:/evidence ./native-workspace-evidence'
```

The first run invokes the existing packaged native smoke: authenticated APIs,
node report/task dispatch, restart, credential and database preservation. If it
fails, stop; do not run the dependent UI test. The UI run uses a **fresh**
container and empty profile; X11 clicks the real 1200x800 welcome window, which
invokes production Tauri commands. No Web IPC adapter, external Hub or browser
stub is installed. Python reads the persisted native credential in memory via
Secret Service, authenticates `/api/auth/me` and `/api/status`, and requires 401
for a deliberately invalid token. It prints no credentials or response bodies.

Before starting the application, the isolated keyring helper keeps one foreground
daemon, waits for D-Bus name ownership, and verifies real write/read/delete in
the unlocked collection. This avoids racing D-Bus auto-activation against a
daemonizing unlock. It requires `libsecret-tools` as well as `gnome-keyring`.
CI also shadows the daemon with `/bin/false` in a disposable container: startup
must fail with `FAIL: isolated Secret Service did not acquire D-Bus name` and
must never reach the workload marker. No production credential path is changed.

Review both screenshots: before must show the local-workspace button at the
pinned click target; after must show the authenticated Agent list, not a spinner
or error. Automation alone does not validate the visual result. Repeat in a new
container with `-e TEST_UI_MISS_CLICK=1`: it must exit nonzero specifically with
`FAIL: UI did not persist a local profile after click`. An unrelated timeout or
Docker error is not a passing negative. This prevents automatic startup from
being mistaken for successful interaction. Layout changes require screenshot
review and intentional target updates, never skipping assertions.

The login-before-update layout places the local-workspace button at `(600,422)`
in the pinned1200x800 window. CI run38156879755's before/after screenshots
show the old `(600,470)` hitting remote login instead. Keep the negative target
on background `(30,30)` and retain profile/API/native-credential assertions.

## Recovery and scope

- Startup authority: this Dockerfile, atomic.sh, ui.sh, and the repository's
  `scripts/with-linux-test-keyring.sh`; CI wiring is in linux-deb-package.yml.
- No ports published, proxies or tunnels; `--network none` retains only private
  loopback. UID 10001, private DBus/Xvfb, no host home/display/keyring mounts,
  no privileged mode or sandbox bypass.
- Keyring password is a public dummy fixture input, never a production secret.
  Native credentials and database are generated in the disposable container.
  Do not export the profile or keyring as CI artifacts; only `/evidence`.
- To change versions, rebuild from the exact source and verify the new deb hash,
  then rerun all dependent gates. Apt packages are not snapshot-pinned; byte
  reproducibility is not claimed.
- Cleanup/rollback: preserve screenshots/logs, remove only named test containers;
  no production state is changed. Existing production accounts and Hub contents
  would need their separately documented encrypted backups, not this fixture.
- This proves the local workspace bootstrap slice only. Runtime creation,
  model selection, stop/start, LAN, other distros/ARM64, upgrade and formal
  release require separate gates. All resulting packages remain TEST ONLY.
