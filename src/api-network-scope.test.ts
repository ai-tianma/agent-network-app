// Every read in api.ts must state its network scope — and be driven to prove it.
//
// The hub resolves an unscoped read from a user token as "every network this
// user belongs to" (server/src/network-scope.ts, resolveRestNetworkScope: with
// no `network_id` and no network-bound token it falls through to
// `getUserNetworkIds(userId)`), and each handler then filters with
// `AND network_id IN (…)`. So omitting the parameter is not "no filter applied
// by the client" — it actively asks for the union across networks.
//
// A test asserting "api.ts mentions network_id" would be existence, not
// coverage: it passes while a newly added endpoint forgets the parameter. So
// this file does two things instead.
//
//   1. It parses api.ts, finds every `get<…>(cfg, …)` call site, and resolves
//      the exported function each one sits in. An endpoint missing from the
//      table below is a failure — new readers fail closed, and the person
//      adding one has to decide the scope rather than inherit it by silence.
//   2. It calls each of those functions against a stubbed fetch and asserts the
//      URL that actually goes out. Source text can lie about behaviour; a
//      recorded URL cannot.
import { readFileSync } from 'node:fs';
import {
  fetchExternalScheduleEdits,
  fetchNodePermissionReport,
  fetchHubNodes,
  fetchMessages,
  fetchNodeStatus,
  fetchScheduledRuns,
  fetchScheduledTasks,
  fetchStatus,
  fetchScopedStatus,
  fetchTaskDetail,
  fetchTaskInspection,
  fetchTasks,
  fetchUserMessages,
  fetchUserMessagesWithSystemRows,
  fetchChatUserMessages,
  type HubConfig,
} from './api';

let passed = 0;
const ck = (label: string, ok: boolean) => {
  if (!ok) { console.error(`FAIL: ${label}`); process.exit(1); }
  passed++; console.log(`PASS: ${label}`);
};

const NETWORK = 'net_alpha';
const cfg: HubConfig = { serverUrl: 'https://hub.example.test', token: 'utok_test', networkId: NETWORK };
const unscopedCfg: HubConfig = { serverUrl: 'https://hub.example.test', token: 'utok_test' };

let lastUrl = '';
(globalThis as any).fetch = async (url: string) => {
  lastUrl = String(url);
  return new Response(JSON.stringify({ ok: true, sessions: [], nodes: [], tasks: [], messages: [], runs: [], edits: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

/** Run a reader and hand back the path it requested. */
const urlOf = async (run: () => Promise<unknown>): Promise<string> => {
  lastUrl = '';
  await run().catch(() => undefined);
  return lastUrl;
};

type Scope =
  /** Must carry network_id (or an equivalent scoped path) whenever cfg.networkId is set. */
  | { kind: 'network' }
  /** Deliberately cross-network. The reason is required and is what a reviewer reads. */
  | { kind: 'unscoped'; reason: string };

/**
 * One entry per exported reader that issues a `get<…>(cfg, …)`.
 *
 * `drive` is what the enumeration below runs. Declaring an endpoint without a
 * way to exercise it is not allowed — an unexercised entry fails too, so the
 * table cannot be used to wave an endpoint through on paper.
 */
const ENDPOINTS: Record<string, { scope: Scope; drive: () => Promise<unknown> }> = {
  fetchScopedStatus: {
    scope: { kind: 'network' },
    drive: () => fetchScopedStatus(cfg),
  },
  fetchStatus: {
    // Known gap, same shape as the /api/tasks defect this file was added with.
    // Not changed here because scoping it changes which agents the list shows,
    // which is a product decision and needs its own review — unlike a
    // conversation, where messages from a second network under one alias are
    // unambiguously wrong. Tracked in #187.
    scope: { kind: 'unscoped', reason: 'agent list is cross-network today; scoping it changes visible rows — separate change' },
    drive: () => fetchStatus(cfg),
  },
  fetchNodeStatus: {
    scope: { kind: 'network' },
    drive: () => fetchNodeStatus(cfg),
  },
  fetchHubNodes: {
    scope: { kind: 'network' },
    drive: () => fetchHubNodes(cfg),
  },
  fetchScheduledTasks: {
    scope: { kind: 'network' },
    drive: () => fetchScheduledTasks(cfg),
  },
  fetchScheduledRuns: {
    scope: { kind: 'network' },
    drive: () => fetchScheduledRuns(cfg, 'sched_1'),
  },
  fetchExternalScheduleEdits: {
    scope: { kind: 'network' },
    drive: () => fetchExternalScheduleEdits(cfg, 'node_1'),
  },
  fetchNodePermissionReport: {
    // #489 —— 报表本来就在网络路径下(/api/networks/:id/…);query 里的 network_id 与路径一致,和其余读一个样子。
    scope: { kind: 'network' },
    drive: () => fetchNodePermissionReport(cfg),
  },
  fetchUserMessages: {
    // #1563 —— agent 主动发给登录用户的消息落在 user_inbox;这个读必须按网络
    //   作用域,否则会跨网络返回别的网络的私信。
    scope: { kind: 'network' },
    drive: () => fetchUserMessages(cfg, 20),
  },
  fetchUserMessagesWithSystemRows: {
    // #499 手机通知运行时的同一份 user_inbox 读(另外交出系统通知行),作用域同上。
    scope: { kind: 'network' },
    drive: () => fetchUserMessagesWithSystemRows(cfg, 20),
  },
  fetchChatUserMessages: {
    // 会话页同一份 user_inbox 读(200 → 每拍 50 的窗口,user-messages-window.ts),作用域同上。
    scope: { kind: 'network' },
    drive: () => fetchChatUserMessages(cfg),
  },
  fetchTasks: {
    scope: { kind: 'network' },
    drive: () => fetchTasks(cfg, { to_name: 'agent-a', limit: 20 }),
  },
  fetchTaskDetail: {
    scope: { kind: 'network' },
    drive: () => fetchTaskDetail(cfg, 'task_1'),
  },
  fetchTaskInspection: {
    scope: { kind: 'network' },
    drive: () => fetchTaskInspection(cfg, 'task_1'),
  },
  fetchMessages: {
    // Same known gap as fetchStatus.
    scope: { kind: 'unscoped', reason: 'activity feed is cross-network today; scoping it changes visible rows — separate change' },
    drive: () => fetchMessages(cfg, 20),
  },
};

// ---- 1. enumeration: every call site in the file is accounted for -----------

const source = readFileSync(new URL('./api.ts', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

/** The exported function a source offset sits inside. */
const enclosingExport = (offset: number): string | null => {
  const before = source.slice(0, offset);
  const decls = [...before.matchAll(/export\s+(?:const|(?:async\s+)?function)\s+([A-Za-z0-9_]+)/g)];
  const last = decls[decls.length - 1];
  return last ? last[1] : null;
};

const callSites = [...source.matchAll(/get<[^>]*>\(\s*cfg\s*,/g)].map(m => ({
  offset: m.index ?? 0,
  fn: enclosingExport(m.index ?? 0),
}));

ck('api.ts still routes its reads through get<…>(cfg, …)', callSites.length >= 9);

for (const site of callSites) {
  const line = source.slice(0, site.offset).split('\n').length;
  ck(
    `the read at api.ts:${line} resolves to an exported function`,
    site.fn !== null,
  );
  ck(
    `${site.fn ?? '<unresolved>'} (api.ts:${line}) declares a network scope`,
    site.fn !== null && Object.prototype.hasOwnProperty.call(ENDPOINTS, site.fn),
  );
}

const declared = Object.keys(ENDPOINTS);
const found = new Set(callSites.map(s => s.fn));
for (const name of declared) {
  ck(`${name} is declared and still exists as a read in api.ts`, found.has(name));
}

// ---- 2. behaviour: the URL that actually goes out ---------------------------

for (const [name, entry] of Object.entries(ENDPOINTS)) {
  const url = await urlOf(entry.drive);
  ck(`${name} issues a request`, url.length > 0);

  if (entry.scope.kind === 'network') {
    ck(
      `${name} scopes its read to cfg.networkId`,
      url.includes(`network_id=${NETWORK}`),
    );
  } else {
    ck(
      `${name} is declared cross-network and gives a reason`,
      entry.scope.reason.trim().length > 20,
    );
    ck(
      `${name} does not smuggle a scope past its declaration`,
      !url.includes('network_id='),
    );
  }
}

// ---- 3. the parameter is conditional, not pasted in --------------------------
//
// A hub with no network selected yet must not be asked for `network_id=` with
// nothing after it — that is a different request, not an unscoped one.

const noNetworkTasks = await urlOf(() => fetchTasks(unscopedCfg, { to_name: 'agent-a' }));
ck('with no network configured, tasks omits the parameter entirely', !noNetworkTasks.includes('network_id'));
ck('with no network configured, tasks still asks for the conversation', noNetworkTasks.includes('to_name=agent-a'));

const scopedTasks = await urlOf(() => fetchTasks(cfg, { to_name: 'agent-a' }));
ck('a scoped conversation read keeps its own filters', scopedTasks.includes('to_name=agent-a') && scopedTasks.includes('limit='));

const scopedDetail = await urlOf(() => fetchTaskDetail(cfg, 'task_1'));
ck('a scoped task detail read keeps its task id', scopedDetail.includes('task_id=task_1'));

console.log(`api network scope: ${passed} checks passed`);
