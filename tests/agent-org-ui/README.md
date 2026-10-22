# Agent Organization UI Harness

Runs the unchanged, currently exported `dist` through the complete App. No build,
production source changes, credentials, proxy, or external service is required.

## Run

```sh
/Users/vansin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node tests/agent-org-ui/verify.mjs
```

Override `PLAYWRIGHT_MODULE` if necessary. Uses installed Google Chrome when
available. Screenshots, per-case mutation logs, bundle SHA-256 fingerprints, and
the machine-readable report are written to the ignored `artifacts/` directory.
The verifier exits nonzero when any assertion fails, including known defects.

Preview:

```sh
/Users/vansin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node tests/agent-org-ui/server.mjs
```

Open `http://127.0.0.1:9339/`, then Settings > Agent organization. Direct full-App
Settings preview: `http://127.0.0.1:9339/?settings=1&category=agentTeams`.
Append `&theme=dark` for dark mode. Narrow the viewport to 390px for mobile.

## Fixture

- 329 original329 agents, initially unassigned, with an empty TMAI root.
- Nested TMAI > TMWork > Stations > Station Alpha / Station Beta, plus 45 stations
  to exercise scrollable department pickers.
- Directory uses the exact production endpoint and two pages (200 + 1 people).
  The final person's 200 agents deliberately test second-page loading; the other
  129 agents have no owner. Human department TMWork must not assign Agent location.
- `POST /__fixture/reset?populated=1` seeds three Alpha agents, 326 unassigned.
- `POST /__fixture/deny` rejects moves with 403; `?value=0` permits moves.
- The exact Agent department PUT and department POST/PATCH contracts mutate fixture data. State,
  attempted writes, status codes, and request logs are at `/__fixture/state`.
- Reuses the scheduler Tauri/profile bootstrap without modifying it. The local
  extension implements window enumeration and maps the App's requested Settings
  webview URL into this browser tab. The verifier first clicks the actual App
  Settings navigation, then its actual organization category. No component mount.
- CSP, fetch guard, WebSocket stub, and Playwright routing prevent external
  traffic. Server binds loopback only. All data is disposable process memory.

## Validation: 2026-10-22

**128 / 128 checks passed** against the final compiled dist.
Four cases: desktop 1440x1100 light/dark and mobile 390x844 light/dark.
28 screenshots captured (seven per case). No uncaught App errors or attempted
external browser requests. No unexpected mutations.

Covered initial unassigned/populated selection, empty department, visual
highlight, member alias/ID/owner search, no results, mobile child navigation and
back, collapsed adjustment, bounded/scrolling searchable pickers, Escape close,
incomplete apply, no writes while picking, exactly one successful PUT on apply,
persisted data after reload, ancestor counts, denied-save rollback, and rollback
preserving a previous successful in-memory override.

### Regression Evidence

The initial export passed 126/128 checks and exposed missing web selected-state
semantics on department buttons. Production now emits explicit `aria-selected`;
both desktop-theme regression assertions pass. Organization selectors reuse
`DialogFrame` and its keyboard-avoidance/safe-area implementation. Typecheck,
Expo production export, and the full 432-file regression suite also pass.

Representative screenshots:

- `artifacts/desktop-light-workspace.png`
- `artifacts/desktop-dark-workspace.png`
- `artifacts/mobile-light-workspace.png`
- `artifacts/mobile-dark-workspace.png`
- `artifacts/desktop-dark-agent-picker.png`
- `artifacts/mobile-light-department-picker.png`
- `artifacts/desktop-light-populated-seed.png`
- `artifacts/mobile-dark-denied-rollback.png`

Screenshots are visual evidence reviewed manually, not pixel-baseline assertions.
This is a browser/Web export test with mocked Tauri IPC, not native OS window or
mobile keyboard testing.

## Department Editor Regression

```sh
/Users/vansin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node tests/agent-org-ui/departments.mjs
```

Runs full App Settings navigation in desktop/mobile light/dark against the existing
export, without building. Latest result: **94/94 checks, 24 screenshots** in
`artifacts/departments/`. The original `verify.mjs` remains unchanged and passes
**128/128 checks, 28 screenshots** with the extended server.

Covers blank-name validation, root/child POST responses shaped as `{ department }`,
rename and reparent PATCH payloads, exclusion of self/descendants, parent search,
shared human/Agent tree warning, persisted reload, server failure, revoked
permission (403), `viewer_can.manage/create_child` denial without writes,
post-write refresh failure and retry without duplicate POST, bounded dialogs,
and document overflow. Mobile uses Android browser emulation and simulated
32px/24px safe areas, not an actual native device.

`POST /__fixture/mode?fail=1` makes department writes fail; `?refreshFail=1`
makes department reads fail; `?restricted=1` supplies a viewer identity and
false department permission flags. An empty query clears all three switches.
Root creation has no permission field in the department wire contract; its
button is not hidden by these per-department flags. The fixture still rejects
unauthorized writes. Tests do not fabricate a root-permission response field.

Each run records bundle hashes, request bodies/statuses, errors and screenshot
paths in its report. Screenshots are evidence, not pixel-baseline comparisons.
