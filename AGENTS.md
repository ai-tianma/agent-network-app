# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

## Development checks

Match `.github/workflows/unit-tests.yml`:

- Node 22 and Bun 1.3.14. `npm test` runs each `src/**/*.test.ts` with `bun`.
- `npm ci`, then `npm run typecheck` (`tsc --noEmit -p tsconfig.build.json`). Bare `tsc --noEmit` is not the CI check.
- Web dev server: `npx expo start --web --localhost --port 8081`. Open `http://localhost:8081`. Metro binds IPv6 localhost, so `127.0.0.1:8081` refuses the connection. Do not set `CI=1`; that disables Metro watch mode.
