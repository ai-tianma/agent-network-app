# Local workspace lifecycle and data

Agent Network Desktop can manage a bundled, version-pinned CommHub for users
who do not already have a server. Choose **创建本地工作区** on first run. The
app binds the service to `127.0.0.1`, generates credentials in the native
credential store, waits for a secured health check, and then enters the same
workspace used for remote Hubs.

## Storage

Non-secret data uses the shared application namespace:

```text
~/.anet/app/
  local-hub/
    config.json
    data/
    logs/
  profiles/
  backups/
```

Tokens and the generated bootstrap password are not written to these files.
They remain in macOS Keychain or Windows Credential Manager. Logs rotate at
2 MiB and retain one previous file.

## Local daemon initialization

The local daemon installer scans Node.js/npm and the desktop's private CLI/runtime
under `~/.anet/app/local-daemon/anet`. It requires Node.js >= 22.13 and a compatible
version set: CLI `2.3.0-preview.162`, agent-node `2.5.0-preview.128`, and the bundled
Hub `0.9.0-preview.120`. Newer compatible packages may be reused. npm's `latest`
tag is not used, and an existing package with an older or unknown version is
upgraded. Global npm packages and other applications' daemons are unaffected.

Repair first stops the existing local daemon and confirms its PID has exited.
Only then does it replace packages and force initialization (which preserves
the daemon's node ID but issues a new token). A failed stop retains the existing
configuration and aborts. Concurrent repairs are rejected. Startup uses the
private agent-node entry point and records the login shell's tool directories
for child processes.

Success requires this exact daemon to have a live local process and an online
Hub record with `can_create_nodes: true`. Merely having a configuration file or
an offline Hub record is insufficient. Claude/Codex availability and credentials
are still assessed by the runtime; installing the daemon does not install or
authenticate those tools.

## Shutdown and recovery

The local Hub belongs to the desktop process. Closing the app stops it; an
unexpected exit is retried with finite backoff. A live ownership lock prevents
two app instances from opening the same database. Dead-owner locks are
recovered on the next launch.

If the preferred port `9200` is occupied, the app selects a free loopback port
through `9299`, persists it, and retargets the existing local profile without
changing its identity or credential.

Before a bundled Hub version changes, the stopped data directory is copied to
`~/.anet/app/backups/`. Failed health checks or bootstrap restore the previous
data and configuration.

## Private local daemon child executables

On macOS/Linux, the local-workspace install action uses the exact package pair
defined in `src-tauri/src/local_daemon_packages.rs`, under
`~/.anet/app/local-daemon/anet/`. The authoritative installer/launcher is
`src-tauri/src/local_daemon.rs`; it initializes the daemon profile, writes the
private `anet/bin` absolute path into that profile's `daemonExtraPath`, then
stops the old daemon and starts the validated pair. Child PATH intentionally
does **not** inherit the user's or installer's ambient PATH. Do not bypass this
with an unpinned global package or automatic `npx` fallback.

The daemon profile is `local-daemon/.anet/nodes/local-daemon/config.json`
relative to the app namespace above. Existing extra paths and unrelated profile
fields are preserved; malformed configuration or an unexpected node identity
blocks start. This setting adds no listener, tunnel, or reverse proxy and does
not change the loopback Hub port selection. The installer derives Hub/network
credentials from the active native local session and writes its private daemon
configuration with owner-only permissions; never copy those secrets into Git
or a test report. Other runtimes still require their own explicit executable
installation and authentication.

After installing a new **main-SHA-built release**, verify the exact CLI/node
versions, the private path in the daemon profile, Hub supervisor online state,
and an actual child creation. Online supervisor status alone is insufficient.
The PR test gate `tests/linux-native-daemon-ui/verify.py` checks profile/path and
Hub identity; `tests/linux-native-opencode/` separately checks real V2 runtime
authentication/model transport, not complete native lifecycle acceptance.

Before rollback retain an encrypted backup of the app namespace and native
credential-store recovery material. Stop the daemon with the installed private
`anet node stop local-daemon` from `~/.anet/app/local-daemon`, restore a previously
validated release and compatible profile/data backup, then verify child creation
again. Reverting only the binary does not repair the known old installer PATH
omission. Git recreates the installer and pinned software inputs, **not** Hub
database contents, local task history, runtime sessions or credentials. Those
need protected backups or re-registration. No full empty-machine recovery or
post-fix packaged V2 lifecycle success is implied by these instructions.

## Lost native credentials

The local profile's token and the generated bootstrap password live only in the
native credential store. If the store loses them (the profile still appears in
**账号与 Hub**, but switching to it used to fail with *No matching entry found in
secure storage*), the app recovers on the next local Hub start instead of asking
the user to reset data:

- token missing, bootstrap password present: the app logs in again with the
  stored password and rewrites the profile credential;
- bootstrap password missing too: with the Hub stopped and the data directory
  backed up, the app resets `local-admin`'s password directly in the local
  database (same scrypt format the Hub writes), revokes the old user tokens,
  stores the new password, then starts and logs in as usual.

Switching to **Local workspace** from Settings starts the local Hub first (and
runs this recovery) before the profile becomes active. Local data is never
deleted by recovery; the release gate exercises it with
`--smoke-local-hub-lost-credential`.

## Backup and deletion

Settings provides **立即备份**, restart/stop, and log-folder actions. Explicit
local-data deletion requires typing the displayed confirmation. The app stops
the Hub, creates a backup, then removes only the local profile, its native
credentials, and `local-hub/`; remote profiles remain untouched.

## Uninstall and reinstall

Normal macOS or Windows application uninstall does not delete
`~/.anet/app/local-hub` or `~/.anet/app/backups`. Reinstalling the app therefore
retains local data, provided the operating-system user profile and native
credential store are also retained. Users who want a full data removal must use
**删除本地工作区数据…** in Settings before uninstalling, then remove any backups
they no longer need.

The signed release gate creates previous-version data with a real published
CommHub, upgrades it with the current packaged app, and requires the user,
node, task, and pre-migration database snapshot to survive on macOS and
Windows. It also installs the macOS app bundle and Windows NSIS package into an
empty location, provisions local data, removes the installed application,
requires the external app-data namespace to remain, reinstalls, and launches
the exact packaged binary against the retained profile and credential. This is
the release-blocking definition of uninstall/reinstall retention; explicit
**删除本地工作区数据…** remains the only supported destructive flow.
