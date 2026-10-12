# Local Docker regression fixture; dependency lock and image ID are recorded
# in the test report. Not a public build or a release artifact.
ARG DEPENDENCY_IMAGE=anet-people-loading:review2
FROM ${DEPENDENCY_IMAGE}
WORKDIR /app
RUN cp package-lock.json /tmp/dependency-lock.json && rm -rf /app/src /app/tests /app/scripts /app/.github
COPY . .
RUN cmp package-lock.json /tmp/dependency-lock.json
ARG SOURCE_COMMIT
ENV SOURCE_COMMIT=$SOURCE_COMMIT
RUN bun src/opencode-create-options.test.ts && npm run typecheck && npx --no-install expo export --platform web --output-dir /web-v2
ENV WEB_DIR=/web-v2 OUT=/artifacts
ENTRYPOINT ["node", "tests/opencode-v2-create/drive.mjs"]
