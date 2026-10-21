# Scheduler Visual Verification

Runs the actual existing `client-app/dist` full App, entering the scheduler through its normal navigation. No standalone screen render or production entry changes. The server injects only a browser bootstrap before the original dist scripts; it never changes dist files.

## Run

From `client-app`, with Node on PATH:

```sh
node tests/scheduler-ui/verify.mjs
node tests/scheduler-ui/server.mjs
```

Preview: http://127.0.0.1:9327/?scheduler=1 and http://127.0.0.1:9327/?scheduler=1&theme=dark. The shortcut clicks the normal App scheduler navigation once it mounts. Without `scheduler=1`, click `定时任务` in the rail or phone tabs yourself. The server binds loopback only. `PORT` overrides the preview port.

Uses installed Playwright (project resolution, then existing Codex cache or sibling chat-ui) and installed macOS Chrome. For other environments set `PLAYWRIGHT_MODULE` to an absolute Playwright module path and optionally `CHROME_PATH`. No dependency installation or lockfile edits. Tests use a separate ephemeral server and fresh isolated browser contexts, never your Chrome profile.

## Safety And Fixtures

- Only dummy credentials and names. No HOME profile, native IPC, production Hub, database, or external service is read or written.
- Same-origin in-memory Hub, no upstream proxy. CSP and bootstrap block external networking; verification also aborts non-local requests. WebSockets are inert.
- Only schedule active/paused PATCH mutations are implemented, validated by revision and allowed fields. All other API writes return 405 and are recorded. Restart or `POST /__fixture/reset` resets fixture state.
- Five schedules cover all four states, two nodes, daily and weekly plans. Each schedule has completed, failed, and skipped runs; completed results are expandable.
- Fixed wall clock (2026-10-21 12:00 Asia/Shanghai), locale, timezone, viewport, scale, and color scheme make verification repeatable. Preview dates use the viewer's timezone; test dates use Asia/Shanghai.

## Evidence

`artifacts/report.json` records every assertion, runtime error, blocked request, browser/module paths, and screenshot paths. Per-viewport request logs include the dist index SHA-256. PNGs cover desktop light/dark at 1440x1000 and Android-UA mobile light/dark at 390x844: list, detail, expanded result, and all-status/toggled views. Failures retain screenshots and body text. Generated artifacts are gitignored.

Checks cover normal App navigation, status filtering/counts, desktop selection and selected semantics, phone list/detail/back, summary card visibility, run statuses/result, named focusable checked switch, keyboard activation, one local PATCH, unexpected writes, runtime errors, and horizontal overflow. This is behavioral/visual evidence, not pixel-baseline comparison or a complete accessibility audit.

The scheduler exposes explicit web selection and checked states and handles keyboard switch activation. The harness reports missing semantics or failed Space activation with a nonzero exit. A mouse-click fallback continues the remaining checks without hiding a keyboard failure.
