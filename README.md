# Agent Network App

Native desktop and mobile client for [Agent Network / CommHub](https://github.com/sleep2agi/agent-network). The primary desktop packages target macOS arm64 and Windows x64 through Tauri; Android/iOS share the React Native codebase.

Built with **Expo (React Native, TypeScript)**. Design language follows the dashboard's less-is-more overhaul: near-black surfaces, restrained color, green/red/amber/gray status triad, cyan accent.

| Agents | Chat | Messages |
|---|---|---|
| ![agents](docs/screens/app-web-agents.png) | ![chat](docs/screens/app-web-chat.png) | ![messages](docs/screens/app-web-messages.png) |

## Features (v0.2.41)

- **Login** — server URL + username/password (`POST /api/auth/login` → user token); friendly errors for empty/non-JSON responses; session persists in the platform keystore (expo-secure-store)
- **Agents** — live fleet list: status dot, current-task one-liner, pull-to-refresh, 10s polling; working sessions sort to the top; search box appears beyond 10 agents
- **Chat** — tap an agent card to chat; inverted list opens at the newest 20 and lazy-loads older history at the visual top; timestamps; send via `POST /api/send_task` with draft restore on failure
- **Messages** — network-wide feed: from → to routes, type dots (task/reply/broadcast), HIGH priority chips, timestamps, same lazy window
- **Create nodes** — five-step wizard (name / runtime / model / limits / confirm) that dispatches
  `create_node` to a host daemon. Co-presence runtimes (`claude-code-cli`, `codex-app-server`)
  need **no model and no API key** — they reuse the host TUI's logged-in session; the model field
  is omitted rather than sent empty. Runtime choices are filtered by what the daemon reports it
  supports. — `src/CreateNodeWizardScreen.tsx`
- **Node lifecycle** — stop / restart / delete from the node detail screen. Controls that cannot
  work on a given node are **disabled with a reason** rather than failing after the tap.
  — `src/NodeDetailScreen.tsx`, `src/node-lifecycle-api.test.ts`
- **Side threads (`/btw`)** — ask a question without interrupting the agent's running turn.
  `/btw` is a first-token command; `\/btw` escapes it, and `/btwfoo` or a later `/btw` is
  ordinary text. — `src/btw-command.ts`, `src/SideThreadDrawer.tsx`
- **Unread counts** — per-agent unread badges on the fleet list. — `src/AgentsScreen.tsx`
- **Bundled local Hub** — the desktop build ships a pinned CommHub sidecar, so a first-run user
  gets a working Hub without installing anything else. Upgrading the pin snapshots the existing
  data directory into `backups/` before migrating. — `src-tauri/src/local_hub.rs`
- **Branding** — cyan hub-and-spokes launcher icon (adaptive + monochrome for Material You)

## Server

The app talks directly to a CommHub instance. Use an HTTPS endpoint (release builds block cleartext HTTP by default; the current build carries a temporary cleartext exemption via `expo-build-properties` that will be removed once HTTPS is everywhere).

```
服务器地址  https://your-hub.example.com   (no port needed behind a reverse proxy)
用户名/密码  your hub credentials
```

API surface used: `POST /api/auth/login`, `GET /api/status`, `GET /api/tasks?to_name&limit`, `GET /api/messages?limit`, `POST /api/send_task` — all Bearer-token authed.

## Development

```bash
npm install
npx expo start        # Expo Go / dev client
npx tsc --noEmit      # typecheck
```

### Desktop releases

Tauri builds macOS arm64 and Windows x64 packages. Desktop acceptance,
Developer ID signing, notarization, and release rules are documented in the
[desktop release SOP](docs/desktop-release-sop.md).

Desktop first run can create a loopback-only local workspace without requiring
a server URL or global CLI/runtime installation. Storage, backup, deletion,
shutdown, and uninstall behavior are documented in the
[local workspace guide](docs/local-workspace.md).

The CLI/API-only path from Expo prebuild through IPA, TestFlight, and App Store
submission is documented in the [iOS release runbook](docs/ios-release-runbook.md).

OpenCode nodes created through a daemon may share a **host-shared OpenCode
server**. That decision is made on the daemon side, not by this app: see
[opencode-shared-server-reuse.md](docs/opencode-shared-server-reuse.md) for what
the client does (and deliberately does not) send.

### Visual verification without a device

`react-native-web` export + playwright renders the same components at a phone viewport, proxying API calls to a live hub (sidesteps CORS, swaps auth):

```bash
npx expo export --platform web
# serve dist/ and screenshot at 390×844 — see docs/screens/
```

## Android release build (local, no EAS)

Requires JDK 17 and the Android SDK (API 35); a userspace install works:

```bash
export JAVA_HOME=~/android-tools/jdk-17.0.19+10
export ANDROID_HOME=~/android-tools/sdk
npx expo prebuild --platform android --no-install
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
# → android/app/build/outputs/apk/release/app-release.apk  (~26MB arm64)
```

Expo signs release builds with the debug keystore by default — fine for direct-install test distribution, replace before store submission.

## Roadmap

- [ ] iOS build (needs macOS/EAS)
- [ ] Proper application id (currently `com.anonymous.agentnetworkapp`; migrating means a fresh install — held until distribution widens)
- [ ] Tighten the cleartext exemption once all endpoints are HTTPS
- [ ] "Join network" onboarding for non-admin users (hub scopes data by network membership)

## Tracking

Progress is reported round-by-round on [sleep2agi/agent-network#220](https://github.com/sleep2agi/agent-network/issues/220).
