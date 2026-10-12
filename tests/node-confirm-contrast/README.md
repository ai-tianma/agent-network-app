# Node lifecycle confirmation contrast (#895)

This independent Docker suite builds the real web export and renders it in
Chromium against a page-local Hub/IPC fixture. It is **not native package or
real-Hub acceptance**. Both base images are digest-pinned, dependencies come
from the repository lockfile, and runtime tests use no network:

```sh
sg docker -c 'docker build -t anet-confirm:test -f tests/node-confirm-contrast/Dockerfile .'
sg docker -c 'docker run --name anet-confirm-test --network none anet-confirm:test'
sg docker -c 'docker cp anet-confirm-test:/artifacts/. /tmp/anet-confirm-evidence/'
sg docker -c 'docker rm anet-confirm-test'
```

The drive checks all four lifecycle confirmation dialogs in light and dark
themes. Enabled text/background contrast must be at least 4.5:1. Delete retains
its destructive outline/text and exact-alias confirmation. Cancel must submit
nothing; confirmation must make exactly one call with the correct action,
node/network identity and safety flags (no implicit force/delete-config).
The old product should fail specifically with a 1.00 contrast ratio, not a
navigation timeout. Screenshots are saved even for the failing contrast case.

`tests/drives.json` registers the drive in the ordinary PR stub shards. The
native Linux workflow also watches the modified screen and this suite: a new
product SHA must build its own TEST-ONLY package and run the existing native
lifecycle gates. Review its actual confirmation screenshots before accepting
the native fix. Never substitute a browser screenshot or old package result.

This change affects only dialog foreground/background styling. It adds no
service, secret, port, schema or production state. Start/install/version-check/
rollback and backup boundaries remain in the existing local-workspace docs;
reverting the source commit and rebuilding restores the prior styling.
