// ck-style (self-executing; run by scripts/run-tests.mjs): 聊天信息里的「规则文件」「技能」对 claude-code 节点也要出现。
//
// 2026-09-29 owner(桌面端 0.2.140):打开一个 claude-code 节点的聊天信息,只有 模型与运行时 / 项目文件夹 /
// 任务 / 定时任务,没有「规则文件」「技能」;而 hub 全量 /api/status 里这个会话 rules_file_capable=true、
// skills_capable=true。量出来的原因:聊天信息吃的是 `/api/status?light=1` 的行,light 投影根本不带能力位,
// 判据只剩 `agent` 前缀(agent-node:*)—— claude-code 会话永远是 false。与 node_id 无关:按别名查,
// 会话 node_id 为空、节点表有没有行都一样。
//
// fixture 照生产形状(占位名):同一个会话的 light 行 / 全量行;全量行 node_id 为空、能力位为真;
// 节点表有一行(刚铸造过绑定 node_id)或没有。
// @ts-expect-error app tsconfig 不带 node 类型(其余读源码的 ck 测试同样报这一条);运行时由 bun/node 提供。
import { readFileSync } from 'node:fs';
import type { HubNode, Session } from './api';
import { chatInfoCaps, chatInfoGroups } from './chat-info-model';
import { rulesFileTarget } from './node-rules';
import { visibleNodeSections } from './node-page-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n} ${extra}`); };

// ── fixture ────────────────────────────────────────────────────────────────
// light=1 的投影:hub server.ts 里就这 8 个字段。
const light = (alias: string, agent: string): Session =>
  ({ alias, status: 'idle', agent, task: null, server: 'host-a', updated_at: '2026-09-29 01:00:00', runtime: agent === 'claude-code' ? 'claude-code-cli' : agent.replace(/^agent-node:/, '') + '-sdk', network_id: 'net_a' } as unknown as Session);
// 全量行(只列用到的):claude-code 会话 node_id 为空,能力位由 node-server 上报。
const full = (alias: string, agent: string, caps: { rules?: boolean; skills?: boolean; files?: boolean } = {}): Session =>
  ({ ...light(alias, agent), node_id: null, rules_file_capable: caps.rules ?? false, skills_capable: caps.skills ?? false, files_capable: caps.files ?? false } as Session);

const CC = '甲组-负责人';
const ccLight = light(CC, 'claude-code');
const ccFull = full(CC, 'claude-code', { rules: true, skills: true, files: true });
const ccOld = full('甲组-旧版', 'claude-code'); // 旧 channel server:不报能力位
const anLight = light('乙组-工程师', 'agent-node:codex');
const minted: HubNode = { node_id: 'n_minted01', alias: CC, runtime: null } as HubNode;

// ① 缺陷的形状:light 行没有能力位 ─────────────────────────────────────────────
ck('light row carries no capability fields (the hub light projection)', !('rules_file_capable' in ccLight) && !('skills_capable' in ccLight) && !('node_id' in ccLight));
ck('defect shape: caps from the light row are false for a claude-code session', (() => { const c = chatInfoCaps(ccLight); return !c.rules && !c.skills; })());
ck('light row still proves agent-node rules (the fallback half)', chatInfoCaps(anLight).rules && !chatInfoCaps(anLight).skills);

// ② 全量行:claude-code 会话 node_id 为空、能力位为真 ⇒ 两行都出现 ────────────────
ck('full row: claude-code session with node_id null + caps ⇒ rules and skills', (() => { const c = chatInfoCaps(ccFull); return c.rules && c.skills; })());
ck('full row: an old claude-code channel server (no caps) ⇒ neither', (() => { const c = chatInfoCaps(ccOld); return !c.rules && !c.skills; })());
ck('no session ⇒ neither', (() => { const c = chatInfoCaps(undefined); return !c.rules && !c.skills; })());
ck('skills alone never implies rules (separate bits)', (() => { const c = chatInfoCaps(full('x', 'claude-code', { skills: true })); return !c.rules && c.skills; })());

const rowsFor = (caps: { rules: boolean; skills: boolean }) =>
  chatInfoGroups({ alias: CC, canOpenNode: true, hasRulesTarget: caps.rules, skillsCapable: caps.skills }).flat().map(r => r.label);
const shown = rowsFor(chatInfoCaps(ccFull));
ck('chat info lists 规则文件 and 技能 for the claude-code session', shown.includes('规则文件') && shown.includes('技能'), shown.join('/'));
const shownLight = rowsFor(chatInfoCaps(ccLight));
ck('(collect) the light-row path is exactly the owner screenshot: no 规则文件 / 技能', !shownLight.includes('规则文件') && !shownLight.includes('技能'), shownLight.join('/'));
ck('chat info rows match the read-only node page sections', (() => {
  const secs = visibleNodeSections({ readOnly: true, hasRulesTarget: true, skillsCapable: true });
  return secs.includes('rules') && secs.includes('skills') && !secs.includes('danger');
})());

// ③ 节点信息页的目标(全量行 + 节点表):node_id 为空的会话照样有目标 ─────────────
const tNoRow = rulesFileTarget({ readOnly: true, node: null, session: ccFull });
ck('node page: caps + no node row ⇒ alias target (hub queues it as session:<alias>)', !!tNoRow && !('node_id' in tNoRow) && (tNoRow as { alias: string }).alias === CC);
const tRow = rulesFileTarget({ readOnly: true, node: minted, session: ccFull });
ck('node page: caps + a freshly minted node row (session node_id still null) ⇒ node_id target', !!tRow && (tRow as { node_id?: string }).node_id === 'n_minted01');
ck('node page: old channel server, read-only, no row ⇒ no target (row hidden, not broken)', rulesFileTarget({ readOnly: true, node: null, session: ccOld }) === null);

// ── 接线(读源码)────────────────────────────────────────────────────────
const srcDir = new URL('.', import.meta.url);
const read = (f: string) => readFileSync(new URL(f, srcDir), 'utf8').replace(/\r\n?/g, '\n');
const strip = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
const chat = strip(read('ChatScreen.tsx'));
const detail = strip(read('NodeDetailScreen.tsx'));
const api = strip(read('api.ts'));
// #1974: fetchStatus 现在多一步「记住 alias → network」(列表是跨网络的,发送要用它),
// 所以这里从「一行箭头函数」放宽成「仍然读 light 投影」,并另加一条断言。
ck('api: fetchStatus is the light projection, fetchNodeStatus the full one', /fetchStatus = (?:async )?\(cfg: HubConfig\)\s*=>\s*\{?[\s\S]{0,240}?get<[^>]+>\(cfg, '\/api\/status\?light=1'\)/.test(api) && /fetchNodeStatus = \(cfg: HubConfig, alias\?: string\) =>\s*get<[^>]+>\(cfg, nodeStatusPath\(cfg\.networkId, alias\)\)/.test(api));
ck('api: the agent list read remembers alias -> network (#1974)', api.includes('rememberAliasNetworks(aliasNetworkCache, data?.sessions)'));
ck('chat: caps come from the full status (fetchNodeStatus → chatInfoCaps → setFullCaps)', /fetchNodeStatus\(cfg, alias\)[\s\S]{0,400}chatInfoCaps\(s\)[\s\S]{0,200}setFullCaps\(/.test(chat));
ck('chat: the full read re-runs when the info panel opens', /\}, \[cfg, alias, infoOpen\]\);/.test(chat));
ck('chat: full caps win, light only as fallback', /const sessionCaps = fullCaps \?\? lightCaps;/.test(chat));
ck('chat: switching chats clears the previous caps', /useEffect\(\(\) => \{ setFullCaps\(null\); \}, \[cfg, alias\]\);/.test(chat));
ck('chat: no inline caps judgement left (one rule, in chat-info-model)', !/rules_file_capable === true/.test(chat) && !/skills_capable === true/.test(chat));
ck('chat: info groups fed from sessionCaps', /hasRulesTarget: sessionCaps\.rules,\s*skillsCapable: sessionCaps\.skills,/.test(chat));
ck('node page: reads the full status by alias (no node_id join)', /const data = await fetchNodeStatus\(cfg, alias\);\s*const found = \(data\.sessions \?\? \[\]\)\.find\(s => s\.alias === alias\);/.test(detail));
ck('node page: rules target + skills gate from the full session', /rulesFileTarget\(\{ readOnly, node, session: s \}\)/.test(detail) && /skills_capable === true/.test(detail));

console.log(`\n${p}/${t} passed`);
if (p !== t) (globalThis as any).process.exit(1);
