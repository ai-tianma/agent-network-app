FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4
WORKDIR /qa
COPY tests/task-list-performance/package.json tests/task-list-performance/bun.lock ./
RUN bun install --frozen-lockfile
COPY src ./src
COPY tests/task-list-performance/table.test.tsx ./table.test.tsx
CMD ["sh", "-c", "bun test table.test.tsx && bun src/task-list-edit-model.test.ts && bun src/task-list-widths.test.ts && bun src/task-list-tablet.test.ts"]
