# TEST ONLY: source-built runtime in a disposable reused private prefix.
# This is NOT the npm registry artifact, a rebuilt desktop or a release.
ARG RUNTIME_BUILD_IMAGE
ARG NATIVE_MODEL_IMAGE
FROM ${RUNTIME_BUILD_IMAGE} AS candidate
USER root
ADD --checksum=sha256:d6fd49fffa38c7231f3dd292502eadb617c38a293d0c6d10af0a9221c4983b65 https://github.com/sleep2agi/agent-network/archive/ded59ce7417ed8b0d22290d9c6fcb6e5c3fb324a.tar.gz /tmp/backend-source.tgz
RUN mkdir /candidate-src /candidate && tar -xzf /tmp/backend-source.tgz -C /candidate-src --strip-components=1 && \
    cmp /candidate-src/agent-node/package-lock.json /agent-node-src/package-lock.json && \
    cp -a /agent-node-src/node_modules /candidate-src/agent-node/node_modules
WORKDIR /candidate-src/agent-node
RUN npm run build && npm pack --ignore-scripts --pack-destination /candidate && \
    mv /candidate/sleep2agi-agent-node-2.5.0-preview.128.tgz /candidate/TEST-ONLY-agent-node-ded59ce7.tgz
COPY tests/linux-native-v1-candidate-runtime/manifest.mjs /candidate/manifest.mjs
RUN node /candidate/manifest.mjs
FROM ${NATIVE_MODEL_IMAGE}
USER root
COPY --from=candidate /candidate/ /fixture/runtime-candidate/
COPY tests/linux-native-v1-candidate-runtime/prepare.py /fixture/runtime-candidate-prepare.py
COPY tests/linux-native-daemon-ui/ui.sh /fixture/daemon-ui.sh
COPY tests/linux-native-v1-model/verify.py /fixture/v1-model-verify.py
RUN bash -n /fixture/daemon-ui.sh && python3 -c 'import ast,pathlib; ast.parse(pathlib.Path("/fixture/runtime-candidate-prepare.py").read_text()); ast.parse(pathlib.Path("/fixture/v1-model-verify.py").read_text())'
ENV TEST_DAEMON_PREFIX_PREPARE=/fixture/runtime-candidate-prepare.py
USER smoke
