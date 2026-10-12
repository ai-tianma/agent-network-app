# TEST ONLY: diagnose the exact source-candidate package boundary, not native UI.
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS bun
FROM node:22-bookworm@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
USER root
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
ADD --checksum=sha256:d6fd49fffa38c7231f3dd292502eadb617c38a293d0c6d10af0a9221c4983b65 https://github.com/sleep2agi/agent-network/archive/ded59ce7417ed8b0d22290d9c6fcb6e5c3fb324a.tar.gz /tmp/backend-source.tgz
RUN mkdir /source /candidate && tar -xzf /tmp/backend-source.tgz -C /source --strip-components=1
WORKDIR /source/agent-node
RUN npm ci --ignore-scripts --no-audit --no-fund && npm run build && npm pack --ignore-scripts --pack-destination /candidate && \
    mv /candidate/sleep2agi-agent-node-2.5.0-preview.128.tgz /candidate/TEST-ONLY-agent-node-ded59ce7.tgz
COPY tests/linux-native-v1-candidate-runtime/manifest.mjs /candidate/manifest.mjs
RUN node /candidate/manifest.mjs && \
    npm install -g --prefix /fixture/exact-prefix --ignore-scripts --no-audit --no-fund \
      @sleep2agi/agent-network@2.3.0-preview.162 @sleep2agi/agent-node@2.5.0-preview.128 && \
    npm install -g --no-audit --no-fund opencode-ai@1.18.34 && test "$(opencode --version)" = 1.18.34
COPY tests/linux-native-v1-candidate-runtime/prepare.py /fixture/prepare.py
COPY tests/linux-v1-package-bootstrap/probe.mjs /fixture/probe.mjs
COPY tests/linux-v1-package-bootstrap/launch.py /fixture/launch.py
RUN cp -a /candidate /fixture/runtime-candidate && \
    useradd --uid 10001 --create-home smoke && mkdir /evidence && \
    install -d -m 0755 /run/user && install -d -m 0700 -o smoke -g smoke /run/user/10001 && \
    chown -R smoke:smoke /fixture/exact-prefix /evidence && chmod 0700 /fixture/exact-prefix /evidence
ENV ANET_PACKAGED_SMOKE_ROOT=/home/smoke/app
ARG APP_SOURCE_COMMIT
ENV APP_SOURCE_COMMIT=${APP_SOURCE_COMMIT}
USER smoke
CMD ["bun", "/fixture/probe.mjs"]
