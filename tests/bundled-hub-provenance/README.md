# Published Hub package byte provenance (#894)

TEST ONLY. This offline, non-root Docker suite compares all 320 shipped files in
the SHA512-pinned Hub preview.120 npm tarball against the exact GitHub server tree
at `edc68a4ca87bbb7ca4944093e8ff113a17078624`. No filename exclusions or normalized
content: every shipped byte must match. Modified, missing, extra, same-count
substituted files and symlinks have separate precise-rejection controls.

```sh
sg docker -c 'docker build -t anet-hub-provenance:894 -f tests/bundled-hub-provenance/Dockerfile .'
sg docker -c 'docker run --rm --network none anet-hub-provenance:894'
```

This establishes shipped-source equality for this pinned archive, not publisher
identity, registry attestation, reproducibility of compiled binaries, or a runtime
compatibility test. It does not require all repository files to be shipped. npm
metadata did not expose gitHead; do not invent it. The source SHA was checked as
a main ancestor on 2026-10-10; any future release must repeat that check against
current main and pass the separate exact-main-SHA release gate.

Recovery: Dockerfile contains pinned runtime, archive integrity and exact source
inputs; CMD runs the verifier. No credentials, ports, tunnels, mounted profiles or
production databases are used. Rebuild from the repository, run offline, remove
the disposable container with --rm. There is no persistent service or production
rollback. This test does not recover production data or keyrings.
