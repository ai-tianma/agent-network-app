# #894 deterministic pre-exec reproduction (TEST ONLY)

This suite imports the unmodified attach-record renderer and health guard from
backend `edc68a4ca87bbb7ca4944093e8ff113a17078624`. A real shell publishes its PID
and start ticks then waits at a barrier before exec. Its real launcher exits 0.
The original guard rejects the pre-exec argv and accepts the same PID/session
after exec. Foreign generation, reused start ticks, wrong config and nonzero
launcher guards remain intact. The health module SHA256 is asserted.

```sh
sg docker -c 'docker build -t anet-launch-window:894 -f tests/opencode-launch-window/Dockerfile .'
sg docker -c 'docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges anet-launch-window:894'
```

The barrier deliberately widens a real ordering window. This establishes that
the failure is possible, not that the prior native failure's missing /proc argv
has been recovered. TUI and serve are process fixtures, not actual OpenCode:
this is an atomic timing regression reproduction, not native package acceptance.
The Bun-only scripts are excluded from app type checking and run in their own
Docker CI job. No app code or installed runtime is changed.

Recovery: source commit and Bun digest are in Dockerfile, entry is probe.ts.
No ports, tunnels, credentials, host mounts or production data are needed.
Rebuild from this repository; processes use container-local temporary paths and
are terminated before --rm removes the container. No persistent service, version
switch or production rollback is involved. Production data/keyrings require
their separate backup sources and are outside this probe.
