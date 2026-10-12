# TEST-ONLY source runtime + existing native desktop integration

The V1 model-selection fix is in the separately installed agent-node package,
not the desktop deb. Rebuilding the desktop alone does not replace the exact
published npm pair. This wrapper tests an unreleased source candidate without
publishing anything or weakening the native installer's version/identity gates.

The Dockerfile downloads the full backend commit
`ded59ce7417ed8b0d22290d9c6fcb6e5c3fb324a` with archive SHA256 verification,
compares its dependency lockfile to the dependency build image, and uses the
repository's real `npm run build` and `npm pack --ignore-scripts`. The resulting
archive is named `TEST-ONLY-agent-node-ded59ce7.tgz`, with a separate manifest
binding backend source, archive SHA256, CLI SHA256 and lock SHA256. The upstream
package version is retained for compatibility testing, NOT represented as new
registry bytes. Nothing is uploaded to npm, Release or the updater.

Only inside the disposable non-root Docker run, after actual native workspace
authentication, the optional driver hook seeds a copy of the known private CLI
pair and replaces package files using that source archive. Dependencies are
reused, not freshly installed. No node identity, model config, Hub credentials
or daemon profile is seeded. The unchanged before/after native registration
guards still run. This is specifically an existing-prefix/candidate integration,
NOT a clean install, registry artifact, new deb or formal release acceptance.

The real mouse/key driver creates a safe headless V1 worker, changes its model,
and dispatches only the proof task through REST. The observer verifies the
actual live worker executes the exact source-candidate CLI path/hash; a same
version string alone is insufficient. `runtime-candidate-source.json` and
`v1-model-proof.json` retain the explicit TEST-ONLY distinction. External model
responses/catalogue remain an isolated TLS fixture; real OpenCode1.18.34 runs.

## Rebuild order

1. Build the dependency image from the exact backend checkout using its
   `tests/test894-v1-runtime/Dockerfile`. No host modules/credentials are mounted.
2. Build/pass the exact desktop package's native startup/authentication and
   V1 registration prerequisites, following the existing suites. Record tested
   app merge SHA, deb SHA256 and image IDs. Historical images may be reused for
   this candidate experiment, but never described as a new clean install.
3. Build the `linux-native-v1-model` image with that bound V1 registration image.
4. Build this wrapper using `RUNTIME_BUILD_IMAGE=<step1-image>` and
   `NATIVE_MODEL_IMAGE=<step3-image>`. Run only offline Docker:

```sh
sg docker -c 'docker build -f tests/linux-native-v1-candidate-runtime/Dockerfile --build-arg RUNTIME_BUILD_IMAGE=<dependencies> --build-arg NATIVE_MODEL_IMAGE=<bound-native-model-image> -t anet-native-v1-candidate:test .'
sg docker -c 'docker run --name v1-candidate-positive --network none --cap-drop ALL --security-opt no-new-privileges --shm-size 256m anet-native-v1-candidate:test'
# Only after positive: actual unavailable-model refusal, then wrong oracle.
sg docker -c 'docker run --name v1-candidate-unavailable --network none --cap-drop ALL --security-opt no-new-privileges --shm-size 256m -e TEST_SELECTED_MODEL=openai/not-in-fixture -e TEST_EXPECT_MODEL_REJECTION=1 anet-native-v1-candidate:test'
sg docker -c 'docker run --name v1-candidate-wrong --network none --cap-drop ALL --security-opt no-new-privileges --shm-size 256m -e TEST_WRONG_MODEL=1 anet-native-v1-candidate:test'
```

The first two require exit0, with exact task/model/refusal evidence. The third
must exit1 at the specific model mismatch AFTER actual response consumption.
Earlier failures are not passing negatives. Inspect screenshots and retain only
redacted `/evidence`, then remove exact stopped containers. Do not export keys.
The reviewed local runs are recorded in
`../../docs/tests/report-test894-v1-source-candidate.txt`. CI wiring is described
in `../linux-native-v1-ci/`; adding that job is not a claim of a successful new
workflow run or a change to GitHub branch protection.

No production service, port mapping, secret source, database, backup or rollback
procedure changes. The source scripts are the recovery authority for this
disposable fixture. Formal delivery still needs reviewed main commits, new
public package versions built from exact main SHAs, updated paired installer
pins, and new package installation/upgrade/rollback evidence. These test archives
must not be substituted for any of those release assets.
