# TEST ONLY native V1 model slice, layered on a bound registration fixture.
ARG V1_NATIVE_IMAGE
FROM ${V1_NATIVE_IMAGE}
USER root
ARG SOURCE_COMMIT
ARG DEB_SHA256
RUN test "${#SOURCE_COMMIT}" = 40 && test "${#DEB_SHA256}" = 64 && \
    test "$TEST_DEB_SOURCE_COMMIT" = "$SOURCE_COMMIT" && \
    test "$TEST_DEB_SHA256" = "$DEB_SHA256"
RUN apt-get update && apt-get install -y --no-install-recommends openssl && \
    rm -rf /var/lib/apt/lists/*
ADD --checksum=sha256:fa6a889fc12be5a8aeb83209876af2c1ca052a84dd878d9c8b76e32d22b444ac https://raw.githubusercontent.com/sleep2agi/agent-network/ded59ce7417ed8b0d22290d9c6fcb6e5c3fb324a/tests/test894-v1-acp-session/provider-proxy.py /fixture/pinned-v1-provider.py
RUN chmod 0644 /fixture/pinned-v1-provider.py
COPY tests/linux-native-v1-model/prepare.py /fixture/v1-model-prepare.py
COPY tests/linux-native-v1-model/provider.py /fixture/v1-reachability.py
COPY tests/linux-native-v1-model/verify.py /fixture/v1-model-verify.py
COPY tests/linux-native-v1-model/run.sh /fixture/v1-model-run.sh
COPY tests/linux-native-v1-model/readiness.py /fixture/v1-model-readiness.py
COPY tests/linux-native-opencode-v1/create-ui.sh /fixture/v1-create-ui.sh
RUN bash -n /fixture/v1-model-run.sh && python3 -c 'import ast,pathlib; [ast.parse(p.read_text()) for p in pathlib.Path("/fixture").glob("v1-*.py")]'
ENV TEST_V1_READINESS_GATE=/fixture/v1-model-readiness.py
USER smoke
CMD ["sh", "/fixture/keyring.sh", "xvfb-run", "-a", "-s", "-screen 0 1280x900x24 -nolisten tcp", "bash", "/fixture/v1-model-run.sh"]
