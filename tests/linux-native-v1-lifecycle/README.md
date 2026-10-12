# Native V1 headless lifecycle — TEST ONLY source candidate

This suite extends `../linux-native-v1-candidate-runtime/`, after that exact
candidate's selected-model positive, unavailable-model rejection and wrong
oracle have passed. It does not change product code, upgrade a registry package
or replace the independently accepted V2 native package evidence.

The base is explicitly an existing native deb plus a source-built agent-node
candidate in a disposable private prefix. It is NOT a new desktop, fresh npm
installation, clean-install acceptance or release. Preserve both the tested app
merge/deb SHA and the separate backend source/candidate CLI SHA in every report.
The inherited test manifest must say `test_only=true, registry_artifact=false`.
All source/base recipes are in the preceding suites; no host installation is an
authoritative runtime dependency.

## Order and assertions

1. Inherited environment, Secret Service/authentication/401, native daemon
   install, measured readiness, real X11 V1 creation and model change must pass.
2. Actual non-default selected-model ACP response must pass; observer verifies
   the live worker's candidate CLI hash and safe ACP child environment.
3. Read-only lifecycle observer binds original node/network/token, exact worker
   PID plus start ticks and current descendants, model and config revision.
   V1 uses headless worker identity, never fabricated V2 launch-health or TUI
   attach files. Only proof-task dispatch uses REST; lifecycle mutations use
   real native mouse actions, not API/DB/config writes.
4. Stop/start/restart cancellation observes a full 15-second interval and
   requires unchanged requests, lifecycle, revision, config hash, token and
   process identities. Stop requires every recorded live process to disappear
   or become non-live; config/model and original token remain.
5. Start and restart require a new live worker with the same node identity and
   model; restart additionally requires an applied restart-only revision. Each
   then executes a new uniquely marked task through actual safe ACP. The model
   observer saves phase-specific proof/ACP evidence, so an earlier reply cannot
   stand in for a post-start/restart reply. New ACP descendants are recorded for
   the next cleanup check. Screenshots still need human/agent visual review.

## Build and run

Inspect the intended base image ID before building. Bind it to the exact inputs
recorded by the candidate suite; a matching tag/version alone is insufficient.
Build syntax/AST checks run inside Docker, with no network or host dependencies.

```sh
sg docker -c 'docker build --network none --build-arg V1_CANDIDATE_IMAGE=<bound-candidate-image> -t anet-v1-lifecycle:test -f tests/linux-native-v1-lifecycle/Dockerfile .'
sg docker -c 'docker run --name v1-lifecycle-positive --network none --cap-drop ALL --security-opt no-new-privileges --shm-size 256m anet-v1-lifecycle:test'
# Only after complete positive success:
sg docker -c 'docker run --name v1-lifecycle-cancel-wrong --network none --cap-drop ALL --security-opt no-new-privileges --shm-size 256m -e TEST_V1_CANCEL_SUBMIT=1 anet-v1-lifecycle:test'
sg docker -c 'docker run --name v1-lifecycle-start-missed --network none --cap-drop ALL --security-opt no-new-privileges --shm-size 256m -e TEST_V1_START_MISS_CLICK=1 anet-v1-lifecycle:test'
```

Positive requires exit0 through restart and its actual reply. Wrong-cancel must
first pass all model prerequisites, then exit1 specifically at
`native V1 cancellation mutated lifecycle state`. Missed-start must pass the
real stop plus both cancellations, prove unchanged stopped state/requests over
15 seconds, then exit1 specifically at `native V1 start confirmation did not
apply`. An unrelated infrastructure/model/UI error is not a passing negative.
Do not run downstream negatives after an incomplete/failed positive.

## Evidence, cleanup and delivery

Copy only redacted `/evidence`; never copy native credentials, full argv/env or
the ephemeral TLS private key. Record exact terminal exit codes/times and
inspect screenshots before removing only these exact stopped containers. The
inherited EXIT trap owns the desktop/loopback fixture; removing the disposable
container is final descendant cleanup. Images/evidence can be retained for
diagnosis, but repository scripts and exact referenced source are authority.

No production service launcher, proxy/tunnel/port map, secret source, database
or backup changes. Fixture ports and ephemeral synthetic credentials are scoped
to the offline container. Rebuild/rollback this test by the recorded source and
image recipes, not by altering a live node. There is no production data to
restore. Apt/package inputs inherited from base recipes are not all snapshot
locked: do not claim bit-reproducibility or disaster-recovery acceptance.

Model provider/catalogue responses are loopback fixtures, not an external
provider reliability/model-quality test. Safety assertions observe PURE and
wildcard deny, not arbitrary tool-execution isolation. Full candidate success
still does not close main-only runtime publication, exact installer pairing or
clean-install/upgrade/rollback gates. The reviewed local positive and exact
negative runs are recorded in `../../docs/tests/report-test894-v1-native-lifecycle.txt`.
The Linux package workflow now invokes this fixture after its prerequisites;
see `../linux-native-v1-ci/`. New CI success and branch-protection requirements
must be established separately, not inferred from local success or wiring.
