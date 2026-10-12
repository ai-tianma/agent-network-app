# Linux bundled Hub migration (#894, TEST ONLY)

Run after the exact package's clean-install and native startup/auth gates pass.
This reuses production native migration smoke functions, not an HTTP/UI shim.
The seed uses Hub .66 with its original transitive lock from immutable main
commit a48e697c92bf8a647a62f48890f2b59da7da9590; downloaded inputs are SHA256 checked.
Each scenario gets its own disposable container, loopback Hub and private DBus
keyring. No host credentials, volumes, ports or production services are used.

```sh
sg docker -c 'docker build --build-arg NATIVE_IMAGE=anet-native-workspace:test --build-arg SOURCE_COMMIT=<40-character-source-sha> --build-arg DEB_SHA256=<deb-sha256> -t anet-hub-migration:test -f tests/linux-hub-migration/Dockerfile .'
sg docker -c 'docker run --rm --network none anet-hub-migration:test'
sg docker -c 'docker run --rm --network none anet-hub-migration:test sh /fixture/keyring.sh bash /fixture/migration.sh rollback'
```

Positive: old identity, node and task survive, .120 metadata persists and a
.66-to-.120 snapshot exists. Failure injection: a deliberately wrong native
credential must fail startup, restore byte-identical old DB and compatibility
metadata, remove the supervisor lock and retain the snapshot. The wrapper
also rejects the old executable's same-version shortcut. Neither scenario
accepts V2 node creation or any public release.

Rebuild uses repository package/install/native-workspace Dockerfiles plus this
fixture. Startup is CMD, no reverse proxy/tunnel needed. Credentials are generated
only inside the container and not exported. Version/hash inputs must match the
tested package. Rollback of test infrastructure is removing its own containers;
production data and keyrings need separate encrypted backups, not a Git clone.
Do not archive the seeded DB, keyring or password file as CI artifacts.
