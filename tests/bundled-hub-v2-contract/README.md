# Bundled Hub V2 candidate contract (#894)

TEST ONLY, isolated Docker; no production changes or registry publication.

This Bun-only probe imports a container-absolute candidate path and is excluded
from the Expo app's TypeScript build. It remains executed by its own Docker CI
gate; app type checking and the probe assertions must both pass independently.

```sh
sg docker -c 'docker build -t anet-bundled-hub-contract:test -f tests/bundled-hub-v2-contract/Dockerfile .'
sg docker -c 'docker run --rm --network none anet-bundled-hub-contract:test'
```

The Dockerfile pins Bun by digest, downloads exact Hub preview.127 and verifies
its tarball SHA256 before extraction; the probe also checks npm SHA512 against
the product lock. The non-root offline probe checks
V1 argv, precise missing-consent refusal, exact V2 argv (unsafe opt-in is a
**valueless** CLI switch), and the necessary launch-proof source contract.
Four source files match main ancestor31b0dbdae3192f471c8812574c118795658120f0;
their SHA256 values are asserted. npm metadata did not expose gitHead: do not
represent this limited file comparison as full release provenance verification.
The separate `tests/bundled-hub-provenance` suite compares every shipped file;
neither suite claims publisher attestation or substitutes for runtime acceptance.

This gate is necessary, not sufficient: it does not execute migration, HTTP
acknowledgments, a daemon, or native UI. The package pin and Rust expected Hub
version must agree. New package builds, fresh bootstrap, migration from the old
preview.66 database, rollback, and exact daemon/runtime selection remain required
before accepting the whole upgrade or native V2 lifecycle.

Recovery inputs live here and in the repository sidecar lock/build recipe.
Startup is the Docker CMD; no listener, host mount, tunnel or published port is
used. No credentials or production data are needed. Rebuild from an exact Git
commit; changing the dependency requires a new integrity/source review. Containers
use --rm, so cleanup/rollback only removes disposable test state; production
databases/keyrings require their separate backups and are not reproduced here.
