import fs from 'node:fs';
import path from 'node:path';
import { nodeStatusPath } from './api';
import { nodeInfoFacts, resumeSessionId, safeServerLabel, safeServerUrl } from './node-info';
import { factText, headerChips } from './node-page-model';

let passed = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) throw new Error(`FAIL: ${name}`);
  passed++;
  console.log(`PASS: ${name}`);
};
const value = (facts: ReturnType<typeof nodeInfoFacts>, label: string) => facts.find(f => f.label === label)?.value;

const facts = nodeInfoFacts({
  alias: 'agent-a', status: 'working', agent: 'codex-sdk', server: 'edge-a',
  hostname: 'host-a', ip: '10.0.0.8', project_dir: '/home/alice/project',
  version: '2.5.0', model: 'gpt-5', runtime: 'codex', os_user: 'runner',
}, {
  node_id: 'node-a', alias: 'agent-a', node_name: 'Agent A', role: 'worker',
}, 'https://hub.example');

check('explicit OS user is displayed', value(facts, '系统用户') === 'runner');
check('project path is displayed independently', value(facts, '工作路径') === '/home/alice/project');
check('codex node shows codex_home after the work path, unset until reported', facts.findIndex(f => f.label === 'codex_home') === facts.findIndex(f => f.label === '工作路径') + 1 && value(facts, 'codex_home') === '未上报');
check('server/hostname/IP are all retained', value(facts, '服务器') === 'edge-a' && value(facts, 'Hostname') === 'host-a' && value(facts, 'IP') === '10.0.0.8');
check('runtime/agent/node type remain distinct', value(facts, 'Runtime') === 'codex' && value(facts, 'Agent') === 'codex-sdk' && value(facts, '节点类型') === 'worker');
check('model/version/status are visible', value(facts, '模型') === 'gpt-5' && value(facts, '版本') === '2.5.0' && value(facts, '状态') === 'working');
const labels = facts.map(f => f.label);
check('session-id is the cell after 版本', labels[labels.indexOf('版本') + 1] === 'session-id');
check('missing session_id still occupies the row (empty, not omitted)', facts.some(f => f.label === 'session-id') && value(facts, 'session-id') === undefined);
check('empty session-id displays an em dash, same as other absent facts', factText(value(facts, 'session-id')) === '—' && factText(undefined) === '—');

const withSession = nodeInfoFacts({
  alias: 'agent-a', status: 'working', agent: 'codex-sdk', version: '2.5.0-preview.126',
  session_id: '  sess_01HRESUME  ',
}, { node_id: 'node-a', alias: 'agent-a' }, 'https://hub.example');
const sessionFact = withSession.find(f => f.label === 'session-id');
check('session-id shows the trimmed status session_id', sessionFact?.value === 'sess_01HRESUME' && sessionFact.wrap === true && sessionFact.testID === 'node-runtime-session-id');
check('header chips stay runtime/model/version and do not swallow the session id', !headerChips(withSession).some(chip => chip.includes('sess_01HRESUME')));
check('blank session_id is an empty fact', value(nodeInfoFacts({ alias: 'b', status: 'idle', session_id: '   ' }, null, 'https://hub.example'), 'session-id') === undefined);
check('non-string session_id does not throw and stays empty', value(nodeInfoFacts({ alias: 'n', status: 'idle', session_id: 12345 } as any, null, 'https://hub.example'), 'session-id') === undefined && resumeSessionId(null) === undefined && resumeSessionId({}) === undefined);

const legacy = nodeInfoFacts({
  alias: 'legacy', status: 'offline', project_dir: '/home/should-not-be-a-user/secret',
  ...( { token: 'atok_secret', config_secret: 'do-not-render' } as any),
}, null, 'https://hub.example');
check('missing OS user is honest and never inferred from project_dir', value(legacy, '系统用户') === '未上报');
check('non-codex node has no codex_home row', value(legacy, 'codex_home') === undefined);
const reported = nodeInfoFacts({
  alias: 'codex-node', status: 'idle', agent: 'agent-node:codex-app-server',
  project_dir: '/data/workspaces/app', codex_home: '/data/nodes/codex-home',
}, { node_id: 'n_1', alias: 'codex-node', runtime: 'codex-app-server-sdk' }, 'https://hub.example');
check('reported codex_home is shown and is not the work path', value(reported, 'codex_home') === '/data/nodes/codex-home' && value(reported, '工作路径') === '/data/workspaces/app');
const unsafe = nodeInfoFacts({
  alias: 'codex-node', status: 'idle', runtime: 'codex',
  codex_home: '/tmp/ntok_secret',
}, null, 'https://hub.example');
check('token-shaped codex_home is not rendered', value(unsafe, 'codex_home') === '未上报' && !JSON.stringify(unsafe).includes('ntok_secret'));
const windowsHome = nodeInfoFacts({
  alias: 'codex-win', status: 'idle', agent: 'agent-node:codex',
  codex_home: 'C:\\nodes\\codex-home',
}, null, 'https://hub.example');
check('windows codex_home is shown', value(windowsHome, 'codex_home') === 'C:\\nodes\\codex-home');
check('safe projection allowlists labels and excludes arbitrary secrets', !legacy.some(f => /token|secret|config/i.test(f.label)) && !JSON.stringify(legacy).includes('atok_secret'));
// #649:兜底用的是本端 Hub 地址 → 只上屏打码值。
check('server URL fallback is masked (#649)', value(legacy, '服务器') === 'h****.example');
const urlReported = nodeInfoFacts({ alias: 'u', status: 'idle', server: 'https://hub.example.com:9300' } as any, null, 'https://other.example');
check('a node that reports the Hub URL as its server is masked too (#649)', value(urlReported, '服务器') === 'h.e****.com:9300');
// N6:节点把本端 Hub 主机(不带协议)当 server 报上来 → 也打码;别的机器名照旧。
const hubHostOnly = nodeInfoFacts({ alias: 'h', status: 'idle', server: 'hub.example.com:9300' } as any, null, 'https://hub.example.com:9300');
check('a node that reports the Hub host:port without scheme is masked (#649 N6)', value(hubHostOnly, '服务器') === 'h.e****.com:9300');
const hubNameOnly = nodeInfoFacts({ alias: 'h', status: 'idle', server: 'HUB.example.com' } as any, null, 'https://hub.example.com:9300');
check('a node that reports the bare Hub hostname (any case) is masked (#649 N6)', value(hubNameOnly, '服务器') === 'H.e****.com');
const otherHost = nodeInfoFacts({ alias: 'h', status: 'idle', server: 'edge-b.example.com' } as any, null, 'https://hub.example.com:9300');
check('a different machine name stays as reported', value(otherHost, '服务器') === 'edge-b.example.com');
check('credential-bearing server URL is reduced to its safe origin', safeServerLabel('https://user:secret@hub.example/base?q=token#private') === 'https://hub.example');
check('invalid or non-http server URL fails closed', safeServerLabel('not://[a-secret') === undefined && safeServerLabel('file:///tmp/secret') === undefined);
check('plain server labels reject credential/query/path shapes', safeServerLabel('hub.example?token=SECRET') === undefined && safeServerLabel('user@host') === undefined && safeServerLabel('host/path') === undefined && safeServerLabel('host name') === undefined);
check('plain server labels reject token-shaped secrets', ['atok_TOPSECRET', 'atok-TOPSECRET', 'ntok.TOPSECRET', 'Bearer TOPSECRET', 'sk-TOPSECRET'].every(label => safeServerLabel(label) === undefined));
check('plain labels require hostname syntax', safeServerLabel('not_a_hostname') === undefined && safeServerLabel('-bad.example') === undefined && safeServerLabel('bad-.example') === undefined);
check('plain hostname IPv4 IPv6 and valid ports remain usable', safeServerLabel('edge-a.example:443') === 'edge-a.example:443' && safeServerLabel('10.0.0.8:8080') === '10.0.0.8:8080' && safeServerLabel('[2001:db8::1]:443') === '[2001:db8::1]:443');
check('invalid plain port fails closed', safeServerLabel('hub.example:99999') === undefined);
check('configured server fallback requires URL origin', safeServerUrl('hub.example') === undefined && safeServerUrl('https://user:secret@hub.example/path?q=x') === 'https://hub.example');
check('full status is network scoped and URL encoded', nodeStatusPath('net /甲?') === '/api/status?network_id=net%20%2F%E7%94%B2%3F');
let missingNetworkRejected = false;
try { nodeStatusPath(undefined); } catch { missingNetworkRejected = true; }
check('full status refuses an unscoped request', missingNetworkRejected);
check('one agent\'s full status asks the hub for that alias only (encoded)', nodeStatusPath('net-a', '示例 A&x') === '/api/status?network_id=net-a&alias=%E7%A4%BA%E4%BE%8B%20A%26x');
check('blank alias keeps the whole-network read', nodeStatusPath('net-a', '  ') === '/api/status?network_id=net-a');

const root = process.cwd();
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'src/ChatScreen.tsx'), 'utf8');
const detail = fs.readFileSync(path.join(root, 'src/NodeDetailScreen.tsx'), 'utf8');
check('mobile chat opens exact-alias nodeInfo', app.includes('onOpenNodeSettings={() => setScreen(nodeInfoFromChat(screen))}'));
check('detached chat opens exact-alias nodeInfo', app.includes("onOpenNodeSettings={() => setScreen({ name: 'nodeInfo', alias: detachedAlias, daemonMgmt: screen.daemonMgmt })}"));
check('nodeInfo Back restores the same chat', app.includes('onBack={() => setScreen(chatBackFromNodeInfo(screen))} readOnly'));
check('Android hardware Back restores the same chat', app.includes("if (screen.name === 'nodeInfo')") && app.includes('setScreen(chatBackFromNodeInfo(screen))'));
// Since 聊天信息 the header's 「设置」 is gone: node settings are the panel's avatar row + section rows.
check('聊天信息 rows open node settings (with the section they name)', chat.includes('canOpenNode: !!onOpenNodeSettings') && /requestNodeSection\(nodeInfoSectionKey\(cfg\.profileId \?\? cfg\.serverUrl, alias\), row\.section\);\s*onOpenNodeSettings\?\.\(\);/.test(chat));
check('node info page honours the requested section (read-only page only)', detail.includes('const requested = readOnly ? takeNodeSectionRequest(sectionHandoffKey) : undefined;'));
check('read-only details hide mutation surfaces except overview restart/stop (board #694)', detail.includes('!readOnly ? <AvatarEditSection') && detail.includes('visible={!!pendingAction && (!readOnly || OVERVIEW_ACTIONS.includes(pendingAction))}') && detail.includes("{readOnly ? '节点信息' : '节点详情'}"));
check('details use network-scoped full status rather than the list projection', detail.includes('fetchNodeStatus(cfg, alias)'));
check('model & runtime summary reads modelSectionFacts (session-id beside 版本)', detail.includes('const runtimeFacts = modelSectionFacts(facts);') && detail.includes('runtimeFacts.map(fact => <FactCell'));
check('fact values stay selectable; a wrapped session-id is not ellipsized', detail.includes('selectable') && detail.includes('...(fact.wrap ? {} : { numberOfLines: 2 })') && detail.includes("overflowWrap: 'anywhere'"));

console.log(`node info: ${passed}/${passed} checks passed`);
