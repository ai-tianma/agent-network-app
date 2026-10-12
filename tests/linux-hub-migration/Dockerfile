# TEST ONLY. Requires a package whose startup/authentication atomic gate passed.
ARG NATIVE_IMAGE
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS bun
FROM node:22-bookworm@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS seed
WORKDIR /previous
# Immutable main commit before the Hub pin upgrade; keep the old transitive lock.
ADD https://raw.githubusercontent.com/sleep2agi/agent-network-app/a48e697c92bf8a647a62f48890f2b59da7da9590/local-hub-sidecar/package.json ./package.json
ADD https://raw.githubusercontent.com/sleep2agi/agent-network-app/a48e697c92bf8a647a62f48890f2b59da7da9590/local-hub-sidecar/package-lock.json ./package-lock.json
RUN echo '608a3156ce8a955717645d19a903dc734ec201e7ebbec270c67e225af4a0d149  package.json' | sha256sum -c - && \
    echo '8c83d15f740b9d6b2231026f5393e5243deee734dbbede7020d47056e58c23ac  package-lock.json' | sha256sum -c - && \
    npm ci --ignore-scripts --no-audit --no-fund
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY scripts/seed-previous-local-hub.mjs /fixture/seed.mjs
ENV ANET_SMOKE_PREVIOUS_HUB_VERSION=0.9.0-preview.66
USER node
CMD ["node", "/fixture/seed.mjs", "/tmp/previous-seed", "/previous/node_modules/@sleep2agi/commhub-server", "/tmp/previous-password"]

FROM ${NATIVE_IMAGE} AS migration
USER root
ARG SOURCE_COMMIT
ARG DEB_SHA256
RUN test "$TEST_DEB_SOURCE_COMMIT" = "$SOURCE_COMMIT" && test "$TEST_DEB_SHA256" = "$DEB_SHA256"
COPY --from=seed /usr/local/bin/node /usr/local/bin/node
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=seed /previous /previous
COPY scripts/seed-previous-local-hub.mjs /fixture/seed.mjs
COPY tests/linux-hub-migration/run.sh /fixture/migration.sh
USER smoke
ENV ANET_SMOKE_PREVIOUS_HUB_VERSION=0.9.0-preview.66
ENV ANET_PACKAGED_SMOKE_ROOT=/home/smoke/migration-test
CMD ["sh", "/fixture/keyring.sh", "bash", "/fixture/migration.sh", "upgrade"]
