# Historical V1 candidate CI wiring contract (TEST ONLY)

Current registration acceptance is in `linux-native-current-v1` and
`linux-native-current-v2`; their exact public-pair core results are recorded in
report-test894-current-main-alignment.txt. Do not repeat them for report-only edits.
The added old120/162/128 migration/model/lifecycle extension runs only on explicit
manual full/v1-registration dispatch, not automatically on ready PRs. Its frozen
source/installer inputs require a compatible historical app input before replay;
it is not current-main acceptance. Main's existing package/native-auth baseline
and all historical assertions/negative oracles remain present.

The Linux package workflow now builds the V1 source candidate after the V2
package gates, using backend commit
`ded59ce7417ed8b0d22290d9c6fcb6e5c3fb324a`. The existing candidate Dockerfile
checks the source archive checksum and dependency lockfile; its manifest
records separate source/package/CLI hashes. The desktop is built by the same
workflow and each native base checks its tested merge and deb SHA256.

Execution is sequential: environment/auth/session, actual selected-model
response, unavailable-model refusal, wrong-model oracle, full lifecycle,
wrong cancellation and missed start. Every native run is offline, unprivileged
and isolated. All seven named containers retain redacted evidence and terminal
state before explicit removal, even after a prior gate fails. Evidence-copy
failure does not skip cleanup and still fails the job. No public release or
updater write occurs. The overall timeout is 90 minutes to accommodate the new
native runs; this is a limit, not a promised completion time.

The small prerequisite job checks workflow ordering, precise negative exits
and assertions, source binding, path triggers and cleanup. It then deliberately
breaks eight properties and requires the corresponding exact guard to fail.
All workflow shell blocks are syntax-checked inside the container.

```sh
sg docker -c 'docker build -t anet-v1-ci-contract:test -f tests/linux-native-v1-ci/Dockerfile .'
sg docker -c 'docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges anet-v1-ci-contract:test'
```

This contract does not execute Docker-in-Docker or native UI. A green contract
is not evidence that the full new workflow passed. Existing local native
results are recorded separately in `docs/tests/report-test894-v1-*.txt`.
GitHub branch-protection configuration is not changed by adding a job.

This is source-candidate compatibility in a reused private prefix, NOT clean
installation of a newly published runtime. The source candidate retains its
old version string but is explicitly not registry bytes. New main-only runtime
publication, exact CLI/desktop pairing, daemon-prefix upgrade/rollback and
formal Linux release remain separate acceptance gaps in the original #894.

Recovery authority is the checked-in workflow and Dockerfiles. Rebuild those
fixtures using their exact source/hash inputs; inherited apt dependencies are
not fully snapshot-locked. Loopback ports and synthetic credentials live only
inside disposable containers. No production launcher, proxy, tunnel, secret
source, user database, backup or installed daemon changes. Removing disposable
test containers is cleanup, not a claimed production rollback procedure.
