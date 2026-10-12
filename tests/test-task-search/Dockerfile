# TEST-ONLY exported UI with synthetic Hub fixture; not native/production acceptance.
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS bun
FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e AS core
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
CMD ["sh","-c","bun src/task-list-pagination.test.ts && npm run typecheck"]
FROM core AS web
ENV CI=1 EXPO_NO_TELEMETRY=1
RUN npx --no-install expo export -p web --output-dir /web
FROM mcr.microsoft.com/playwright:v1.58.2-noble@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d AS browser
WORKDIR /app
RUN npm install --prefix /qa-tools --no-save --no-audit --no-fund playwright@1.58.2
COPY --from=web /web /web
COPY tests/test-task-search/drive.mjs /app/tests/test-task-search/drive.mjs
COPY tests/test-layout-sweep/harness.mjs /app/tests/test-layout-sweep/harness.mjs
ENV WEB_DIR=/web PLAYWRIGHT_MODULE=/qa-tools/node_modules/playwright/index.mjs OUT=/output
CMD ["node","tests/test-task-search/drive.mjs"]
