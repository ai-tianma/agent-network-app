FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4
WORKDIR /qa
COPY tests/task-list-performance/package.json tests/task-list-performance/bun.lock ./
RUN bun install --frozen-lockfile
COPY src ./src
COPY tests/task-execution/notice.test.tsx ./notice.test.tsx
CMD ["sh", "-c", "bun test notice.test.tsx && bun src/task-execution.test.ts && bun src/api-network-scope.test.ts && bun src/node-tasks.test.ts && bun src/node-task-view.test.ts"]
