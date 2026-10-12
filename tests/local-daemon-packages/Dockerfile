FROM rust:1.85.1-slim-bookworm@sha256:9f841bbe9e7d8e37ceb96ed907265a3a0df7f44e3737d0b100e7907a679acb36 AS policy
WORKDIR /suite
COPY src-tauri/src/local_daemon_packages.rs ./policy.rs
# Compile the actual dependency-free product policy, not a rewritten mock.
RUN rustc --edition 2021 --test policy.rs -o policy-test
USER 65534:65534
CMD ["/suite/policy-test", "--nocapture"]

FROM node:22-bookworm@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS private-prefix
WORKDIR /fixture
COPY src-tauri/src/local_daemon_packages.rs ./policy.rs
COPY tests/local-daemon-packages/probe.mjs ./probe.mjs
USER node
RUN mkdir -p /home/node/.anet/app/local-daemon/anet && \
    npm install -g --prefix /home/node/.anet/app/local-daemon/anet --no-audit --no-fund \
      @sleep2agi/agent-network@2.3.0-preview.162 @sleep2agi/agent-node@2.5.0-preview.128
ENV PATH=/home/node/.anet/app/local-daemon/anet/bin:$PATH
CMD ["node", "/fixture/probe.mjs"]

# Current published pair. Historical162/128 targets above stay independently
# available, but are not used as current installer/registration acceptance.
FROM node:22-bookworm@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS current-prefix
USER root
ADD --checksum=sha256:4a3572b5caa60bee7ff3e5c178783f88bdff32703e3b2c3c648b8ab3e3e54be6 https://github.com/sleep2agi/agent-network/releases/download/cli-v2.3.0-preview.171/sleep2agi-agent-network-2.3.0-preview.171.tgz /tmp/cli.tgz
ADD --checksum=sha256:20bf0919c5adf8de2cf9e271ec1ad445e32fc5ecbf3271632e5d789ec3c385a9 https://registry.npmjs.org/@sleep2agi/agent-node/-/agent-node-2.5.0-preview.137.tgz /tmp/runtime.tgz
RUN chmod 0644 /tmp/cli.tgz /tmp/runtime.tgz && \
    npm install -g --no-audit --no-fund opencode-ai@1.18.34 && test "$(opencode --version)" = 1.18.34
COPY tests/linux-native-current-v1/manifest.json /fixture/public-pair.json
COPY tests/linux-native-current-v1/pair.mjs /fixture/current-pair.mjs
USER node
RUN mkdir -p /home/node/.anet/app/local-daemon/anet && \
    npm install -g --prefix /home/node/.anet/app/local-daemon/anet --ignore-scripts --no-audit --no-fund /tmp/cli.tgz /tmp/runtime.tgz
CMD ["node", "/fixture/current-pair.mjs"]
