# Private daemon package pair gate (#894)

This narrow gate covers the product's version/probe policy. It does not claim
that a native installer, a real daemon or an OpenCode V2 session has passed.

```sh
sg docker -c 'docker build --target policy -t anet-daemon-packages:test -f tests/local-daemon-packages/Dockerfile .'
sg docker -c 'docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges anet-daemon-packages:test'
sg docker -c 'docker build --target private-prefix -t anet-daemon-prefix:test -f tests/local-daemon-packages/Dockerfile .'
sg docker -c 'docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges anet-daemon-prefix:test'
```

The exact product module is compiled with a digest-pinned Rust toolchain and
executed as an unprivileged user. Negative cases include old/newer/unparseable
CLI versions, correct version text from failed/timed-out processes, conflicting
banners, wrong package identity, wrong entrypoint and half-installed agent-node.
Full `cargo check`/`cargo test` in the existing isolated Rust CI validates the
installation call sites; the independent native Linux package gates remain
required. A green policy test alone is insufficient to approve installation.

After policy tests pass, the private-prefix stage installs the real exact pair
as the image's `node` user, with normal npm install scripts, under that user's
private home (not a world-writable `/tmp` ancestor). Offline execution verifies
the product constants against actual package metadata, both bin symlinks,
real CLI version/help processes, and absence of Hub auth/daemon registration.
It does not call the native installer or launch a daemon/OpenCode session.

## Installation and recovery boundary

- The authoritative installation/start implementation is
  `src-tauri/src/local_daemon.rs`; the pair is in `local_daemon_packages.rs`.
  Only an explicit UI install action initiates daemon installation/start.
- New missing components use exact CLI `2.3.0-preview.162` and agent-node
  `2.5.0-preview.128`, matching the backend's `opencode-agent-node-pair.ts`.
  Source observed on main:
  [80c6ab5b883a2056784326e73a6b6ec09ac0ce2c](https://github.com/sleep2agi/agent-network/blob/80c6ab5b883a2056784326e73a6b6ec09ac0ce2c/agent-network/src/opencode-agent-node-pair.ts).
  Top-level version pins do not lock every transitive npm dependency or prove
  complete tarball provenance. Node fallback downloads are unchanged.
- Both existing components are checked before either npm install, Hub credential
  write or daemon start. Old, invalid or partial private components are rejected
  with the required pair and without replacement. This is deliberately not an
  automatic upgrade/migration implementation. Existing running daemons are not
  stopped by this preflight, and existing V1 configuration is not rewritten.
- Private package location remains `~/.anet/app/local-daemon/anet`; daemon
  configuration and its isolated HOME remain under the existing local-daemon
  root. Ports, reverse proxies/tunnels and Hub endpoint selection are unchanged.
- The current local Hub session supplies credentials via the existing native
  credential flow. No credentials are included in this fixture or repository.
- After a failed check, preserve the existing prefix/config/data for diagnosis;
  do not solve the mismatch by deleting the user's directory or installing a
  floating tag. A reviewed backup/staging/rollback upgrade path is still needed.
- Repository software rebuilds do not restore user Hub databases, runtime
  sessions or OS keyring entries. Those remain user/backup-owned state; this
  change does not add a data recovery guarantee or modify production backups.

Follow-up acceptance must exercise the real packaged installer with an empty
prefix, exact pair, old CLI, old agent-node, failed/timed-out CLI and partial
package, asserting no config write/daemon start on failures. Full V2 lifecycle
and release remain separate gates.
