# Scheduler UI Validation

Validated on macOS on 2026-10-21 against the compiled Expo web application.
The preview uses an in-memory fixture Hub, not a production account or service.

## Results

- `npm run typecheck`: passed.
- `npx expo export --platform web`: passed; output in `dist/`.
- `node tests/scheduler-ui/verify.mjs`: 106/106 checks passed, including Space
  and held-Enter activation checks.
- Desktop 1440x1000 and mobile 390x844, each in light and dark themes.
- Checked selection, status counts and filters, summary containment, run results,
  mobile back navigation, switch state and Space activation, revision-checked
  updates, and absence of horizontal document overflow.
- No uncaught application errors or external browser requests during UI checks.
- Inspected desktop light/dark and mobile light screenshots.
- The initial `npm test` run passed 431/432 files with macOS Bash 3.2. The
  unrelated `src/android-publish-source.test.ts` failed its short-SHA and
  mismatched-checkout rejection checks. Release validation uses Bash 5 on PATH,
  matching the workflow's Bash 4+ requirement, without changing or skipping tests.
- With Bash 5 on PATH, the full suite passed 432/432 test files.

## Scope

This verifies the actual shared App frontend, not the earlier standalone HTML
mockup. It does not verify a native iOS/Android build or package/sign a Tauri
desktop installer. No production schedule was executed or modified, and no
GitHub branch was pushed or merged.
