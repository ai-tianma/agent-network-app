# Native V1 model slice (TEST ONLY)

This is a separate extension of `../linux-native-v1-registration/`, not a
replacement for its registration gate or the strict copresence diagnostic.
Build and pass that exact candidate's V1 version/health/401/session prerequisite
before running this slice. Consult `docs/tests/report-test894-*` for results;
the existence of these scripts does not imply that native model delivery passed.

The installed desktop, native credential store, Hub, private daemon, headless
worker and OpenCode 1.18.34 are real. Only external availability/catalog/model
responses are a closed loopback fixture. The provider implementation is fetched
from backend commit `ded59ce7417ed8b0d22290d9c6fcb6e5c3fb324a` with a SHA256
check in the Dockerfile and again at runtime. The adapter removes only its final
server-binding AST statement and reuses its authenticated TLS handlers unchanged.
It binds container loopback18829, adding an availability-only CONNECT response
for opencode.ai; the two pinned TLS authorities never forward to external hosts.

`prepare.py` creates an ephemeral test certificate, synthetic node-local
provider authentication and a mode0600 node-local `secrets.env` containing only
fixture HTTP/HTTPS proxy, localhost bypass and SSL certificate path. The daemon's
minimal child environment deliberately does not inherit ambient proxy/CA settings.
This uses the existing node-local configuration path, without changing product
isolation or injecting reserved NODE_* keys. It does not create a node identity, write its config,
seed a model setting, inject ambient vendor keys or enable unsafe tools. The
provider must pass a verified-TLS unauthenticated401 check **before** the desktop
workload begins. The inherited real X11 driver then creates V1 in safe/default
headless mode, after native authentication and daemon install prerequisites.
This extension enables the driver's optional `TEST_V1_READINESS_GATE`: a
read-only observer binds the just-installed daemon identity and waits for its
actual runtime readiness report. Online registration alone is insufficient:
the legacy unmeasured UI has different row heights. After the gate, the driver
allows the real picker's 10-second poll to consume the report before selecting
the daemon. It never injects a capability report or changes product fallback
behavior. The historical registration driver does not enable this hook by default.
The model driver uses real mouse/key input to set `openai/gpt-4.1-selected`; no REST
configuration mutation is used. Only the subsequent proof task uses REST.
The observer checks exact node/network/model/revision and response, provider
authentication/route/main-task model (separate from title generation), and the
actual ACP child's PURE/wildcard-deny env. The catalogue includes the separate
default `gpt-4.1`; a silent default fallback must fail the selected-model oracle.
It does not prove general tool-denial behavior or full V1 lifecycle acceptance.

## Rebuild and run

Use the exact native registration image from the preceding suite, recording its
image ID and tested app merge SHA/deb hash. It must contain the candidate package,
not simply share its version string. Build-only downloads install the container's
OpenSSL dependency and the content-locked fixture; runtime remains offline.

```sh
sg docker -c 'docker build --build-arg V1_NATIVE_IMAGE=<bound-registration-image> --build-arg SOURCE_COMMIT=<40-char-tested-merge> --build-arg DEB_SHA256=<64-char-deb-sha> -t anet-v1-native-model:test -f tests/linux-native-v1-model/Dockerfile .'
sg docker -c 'docker run --name v1-native-model-positive --network none --cap-drop ALL --security-opt no-new-privileges --shm-size 256m anet-v1-native-model:test'
# Only after the positive passes, run an independent precise oracle negative:
sg docker -c 'docker run --name v1-native-model-wrong --network none --cap-drop ALL --security-opt no-new-privileges --shm-size 256m -e TEST_WRONG_MODEL=1 anet-v1-native-model:test'
```

The negative must first produce the exact model response with a safe ACP child,
then exit1 specifically with `native V1 provider model mismatch`. Earlier
environment/TLS/auth/registration/configuration failures do not count as passing
negatives. Do not proceed to lifecycle tests after a failed model prerequisite.
Inspect native screenshots; a terminal response alone is not a visual review.

`TEST_SELECTED_MODEL` optionally changes the actual native UI selection and
all observer assertions together. A value absent from the closed catalogue,
such as `openai/not-in-fixture`, is a diagnostic for silent fallback: it must
not be reported accepted if the provider instead receives gpt-4.1. With
`TEST_EXPECT_MODEL_REJECTION=1`, the gate requires a terminal failed Hub task
with the exact upstream model-not-found error, no authenticated generation,
and no surviving observed ACP child. This is
different from `TEST_WRONG_MODEL`, which only tests the evidence oracle after
a successful default positive. An absent-model diagnostic is not a passing
product test unless that explicit refusal gate passes, and never authorizes
seeding runtime model configuration. Historical single-model results remain
bound to their old images/probes; this stricter two-model suite is new evidence.

For a source-candidate agent-node not yet published, use the separate
`../linux-native-v1-candidate-runtime/` wrapper and preserve its TEST-ONLY
manifest in evidence. Its result is not proof that the registry-installed
runtime or a newly shipped desktop contains the fix.

Copy only `/evidence` and redacted diagnostic logs before removing the exact
named stopped containers. Never export the node credential store or ephemeral
private key. The image's entrypoint/traps own disposable services; removing the
container is the final descendant cleanup. No host home, credential, socket or
production data is mounted. No production secrets/backups are needed; rollback
means rebuilding the recorded test inputs, not changing a production node.
This suite is not wired into required CI until its own exact positive/negative
gates pass. No branch artifact is a release or updater input.
