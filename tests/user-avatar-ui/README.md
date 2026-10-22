# Full App Avatar Upload Fixture

Run `node tests/user-avatar-ui/verify.mjs` from `client-app` after the normal full App web export exists in `dist`. This test does not build or alter application source.

Reuses the agent-org/user-management full App harness, installed Playwright and Chrome, dummy auth and Tauri bootstrap. All traffic is local; external requests and real WebSockets are blocked. Avatar endpoints are intercepted with the dedicated atomic multipart POST and authenticated PNG GET contracts. No ordinary attachment endpoint is provided.

Four contexts cover desktop/mobile and light/dark. PNG fixtures are generated in memory with the installed pngjs. The real Expo DocumentPicker browser input is exercised via Playwright's filechooser and setFiles (setInputFiles). Cancellation dispatches the real input cancel event because native OS chooser dismissal is not automatable reliably; the test separately reports unchanged state and whether busy state recovers.

Artifacts include screenshots, exported bundle hashes in report.json, and per-context request, multipart, PNG dimensions, profile and fetch-cache evidence. Failed checks set a nonzero exit code. Profile persistence is checked by remounting the editor and rereading auth/me, not by inspecting React internals. Cache/redirect intent is observed at the App's Request construction; the shared Tauri stub forwards only method/headers/body to browser fetch. Response no-store headers are checked separately. Native Rust transport cache/redirect enforcement is outside this browser fixture.
