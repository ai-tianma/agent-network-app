import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const { daemonChecklist, installBlocker, nodeVersionOk, hubDaemonView } = await import('./local-daemon');
let ck = 0;
const check = (cond: boolean, msg: string) => { assert.ok(cond, msg); ck++; };

const base = { supported: true, shell: '/bin/zsh', daemonDir: '/Users/x/.anet/app/local-daemon', daemonName: 'local-daemon', profileExists: false, hubEndpoint: 'http://127.0.0.1:9201' };

check(nodeVersionOk('v22.13.0') && nodeVersionOk('24.0.1') && !nodeVersionOk('v22.12.0') && !nodeVersionOk('v20.20.0') && !nodeVersionOk(null), 'node gate = engines.node >= 22.13');

// 全缺:清单四行都是 ✗,但**不阻塞**——安装会自动下载私有 Node 22
{
  const scan = { ...base };
  const rows = daemonChecklist(scan);
  check(rows.map(r => r.state).join(',') === 'missing,missing,missing,missing,missing', 'all missing');
  check(rows[0].detail.includes('私有 Node 22') && rows[0].detail.includes('不动系统'), 'node row explains the private download');
  check(installBlocker(scan) === null, 'missing node is not a blocker any more');
}
// node 太低(Vincent 的 v20.12.2):bad 但不阻塞
{
  const scan = { ...base, node: { path: '/Users/v/.nvm/versions/node/v20.12.2/bin/node', version: '20.12.2' }, npm: { path: '/Users/v/.nvm/versions/node/v20.12.2/bin/npm', version: '10.5.0' } };
  const rows = daemonChecklist(scan);
  check(rows[0].state === 'bad' && rows[0].detail.includes('版本太低') && rows[0].detail.includes('私有 Node 22'), 'old node → bad with private-node hint');
  check(installBlocker(scan) === null, 'old node is not a blocker');
}
// 已有私有 Node:node/npm 两行 ✓
{
  const scan = { ...base, node: { path: '/usr/local/bin/node', version: '20.20.0' }, privateNode: { path: '/Users/v/.anet/app/local-daemon/node/bin/node', version: '22.23.2' } };
  const rows = daemonChecklist(scan);
  check(rows[0].state === 'ok' && rows[0].detail.startsWith('私有'), 'private node satisfies the node row');
  check(rows[1].state === 'ok' && rows[1].detail.includes('私有 Node 自带'), 'npm row satisfied by private node');
}
// node+npm 在、anet 缺:可以装,anet 行说明会 npm install
{
  const scan = { ...base, node: { path: '/opt/homebrew/bin/node', version: '22.14.0' }, npm: { path: '/opt/homebrew/bin/npm', version: '10.9.0' } };
  check(installBlocker(scan) === null, 'installable');
  const rows = daemonChecklist(scan);
  check(rows[2].state === 'missing' && rows[2].detail.includes('local-daemon/anet'), 'anet row explains the private-prefix install');
  check(rows[4].detail.includes(base.daemonDir), 'daemon row names the target dir');
  check(rows[3].key === 'agentNode' && rows[3].state === 'missing' && rows[3].detail.includes('私有目录'), 'agent-node row explains the private install');
}
// 已装 + 已注册
{
  const scan = { ...base, node: { path: '/n', version: '22.14.0' }, npm: { path: '/m', version: '10' }, anet: { path: '/a', version: '2.3.0-preview.76' }, agentNode: { path: '/p/lib/node_modules/@sleep2agi/agent-node', version: '2.5.0-preview.58' }, profileExists: true, nodeId: 'node_daemon_abc' };
  const rows = daemonChecklist(scan);
  check(rows.every(r => r.state === 'ok'), 'all ok');
  check(rows[4].detail.includes('node_daemon_abc'), 'daemon row shows node_id');
}
// Windows / 本地 Hub 没起
check(installBlocker({ ...base, supported: false, reason: '只支持 macOS / Linux' })?.includes('macOS') === true, 'unsupported platform blocks with the Rust reason');
check(installBlocker({ ...base, node: { path: '/n', version: '22.14.0' }, npm: { path: '/m' }, hubEndpoint: null })?.includes('Local workspace') === true, 'no local hub → blocked');

// 接线契约:只在桌面端 Local workspace 的空状态里出现;Rust 命令已注册;smoke 只在 macOS 跑
const picker = readFileSync(new URL('./HostSupervisorPickerScreen.tsx', import.meta.url), 'utf8');
check(picker.includes("cfg.profileId === LOCAL_HUB_PROFILE_ID && isTauriDesktop() ? <LocalDaemonSetupCard"), 'picker gates the card on desktop + local profile');
const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
check(lib.includes('local_daemon_scan,') && lib.includes('local_daemon_install,') && lib.includes('async fn local_daemon_install()') && lib.includes('spawn_blocking'), 'Rust commands registered; install runs off the main thread');
const wf = readFileSync(new URL('../.github/workflows/release-desktop-auto-update.yml', import.meta.url), 'utf8');
check(wf.includes('--smoke-local-daemon-install') && wf.includes('if [ "$RUNNER_OS" = "macOS" ]; then'), 'release gate runs the daemon install smoke on macOS');

// Hub 视角(Vincent 2026-09-07:daemon ✓ + 1 在线节点,但列表为空)
{
  const base = { nodeId: 'node_daemon_6f85', alias: 'local-daemon' };
  const v1 = hubDaemonView({ ...base, sessions: [], nodes: [], supervisors: [] });
  check(!v1.ok && v1.verdict.includes('没有向 Hub 注册'), 'no session → not registered verdict');
  const v2 = hubDaemonView({ ...base, sessions: [{ alias: 'local-daemon', status: 'idle', version: '2.5.0-preview.66' }], nodes: [], supervisors: [] });
  check(!v2.ok && v2.verdict.includes('别的网络') && v2.lines[0].includes('idle') && v2.lines[0].includes('preview.66'), 'session but no node row → wrong-network verdict');
  const v3 = hubDaemonView({ ...base, sessions: [{ alias: 'local-daemon', status: 'idle' }], nodes: [{ node_id: 'node_daemon_6f85', config_snapshot: { role: null } }], supervisors: [] });
  check(!v3.ok && v3.verdict.includes('旧版 agent-node') && v3.lines[1].includes('快照里没有 role'), 'node row without role → old agent-node verdict (Vincent 2026-09-07 logs)');
  const oldOnPath = daemonChecklist({ ...base, node: { path: '/n', version: '22.14.0' }, npm: { path: '/m' }, agentNodeOnPath: '/Users/v/.nvm/versions/node/v20.12.2/bin/agent-node' });
  check(oldOnPath[3].state === 'missing' && oldOnPath[3].detail.includes('v20.12.2') && oldOnPath[3].detail.includes('旧版'), 'agent-node row warns about the PATH copy');
  const rust = readFileSync(new URL('../src-tauri/src/local_daemon.rs', import.meta.url), 'utf8');
  check(rust.includes('@sleep2agi/agent-node@2.5.0-preview.137') && rust.includes('probe_private_agent_node()') && rust.includes('stop_existing_daemon') , 'installer installs a compatible private agent-node beside anet and verifies the old daemon stopped');
  const v4 = hubDaemonView({ ...base, sessions: [{ alias: 'local-daemon', status: 'idle' }], nodes: [{ node_id: 'node_daemon_6f85', config_snapshot: { role: 'host_supervisor' } }], supervisors: [] });
  check(!v4.ok && v4.verdict.includes('token'), 'role ok but unlisted → token verdict');
  const v5 = hubDaemonView({ ...base, sessions: [{ alias: 'local-daemon', status: 'idle' }], nodes: [{ node_id: 'node_daemon_6f85', config_snapshot: { role: 'host_supervisor' } }], supervisors: [{ daemon_node_id: 'node_daemon_6f85', online: true, can_create_nodes: true }] });
  check(v5.ok && v5.lines[2].includes('online'), 'listed → ok');
  const offline = hubDaemonView({ ...base, supervisors: [{ daemon_node_id: base.nodeId, online: false, can_create_nodes: true }] });
  check(!offline.ok && offline.verdict.includes('离线'), 'offline records do not indicate a working daemon');
  const blocked = hubDaemonView({ ...base, supervisors: [{ daemon_node_id: base.nodeId, online: true, can_create_nodes: false, create_nodes_blocked_reason: 'runtime missing' }] });
  check(!blocked.ok && blocked.verdict.includes('runtime missing'), 'creation capability failure is visible');
  check(!hubDaemonView({ ...base, supervisors: [{ daemon_node_id: base.nodeId, online: true }] }).ok, 'missing creation capability is not success');
  check(!hubDaemonView({ ...base, supervisors: [{ daemon_node_id: 'old-id', alias: base.alias, online: true, can_create_nodes: true }] }).ok, 'same alias with old identity does not mask failed reinitialization');
  const v6 = hubDaemonView({ ...base, errors: { supervisors: 'HTTP 401' } });
  check(v6.lines[2].includes('查不到') && v6.lines[2].includes('401'), 'fetch error is not reported as absence');
  const card = readFileSync(new URL('./LocalDaemonSetupCard.tsx', import.meta.url), 'utf8');
  check(card.includes('testID="local-daemon-hub-view"') && card.includes('fetchHostSupervisors(cfg)') && card.includes('fetchHubNodes(cfg)') && card.includes('fetchStatus(cfg)'), 'card renders the hub view from the three hub endpoints');
}
{
  const rows = daemonChecklist({ ...base, anet: { path: '/private/anet', version: '2.3.0-preview.76' }, agentNode: { path: '/private/agent-node', version: '2.5.0-preview.58' }, anetCompatible: false, agentNodeCompatible: false });
  check(rows[2].state === 'bad' && rows[2].detail.includes('升级'), 'old private CLI is shown as incompatible');
  check(rows[3].state === 'bad' && rows[3].detail.includes('升级'), 'old private runtime is shown as incompatible');
}
console.log(`local daemon: ${ck} checks passed`);
