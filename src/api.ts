import type { RuntimeReadinessMap } from './runtime-readiness';
import { readTaskDiagnostic, type TaskDiagnostic } from './task-execution';
import { appFetch, appFetchLoad } from './app-fetch';
import { reportProfileAuthResponse } from './profile-auth-state';
import type { NodePermissionReport } from './node-permission-model';
import { withDeadline } from './deadline';
import { clockOffsetFrom, dreqCreatedAt, recordSendTiming, type SendTiming } from './send-timing';
import { pollUntilTerminal } from './node-rules';
import { interpretCloneReply, isCloneToolMissing, type CloneNodeArgs } from './node-clone';

// Thin CommHub API client. The app talks to the same hub the dashboard
// proxies (status / tasks / messages); auth is the network token sent
// as a Bearer header. Server URL + token live in app state (Settings).

export interface Session {
  alias: string;
  status: string;
  agent?: string;
  task?: string;
  server?: string;
  updated_at?: string;
  /** Hub light/full `/api/status`: the network this row lives in (#769). Older hubs omit it. */
  network_id?: string | null;
  node_id?: string | null;
  hostname?: string | null;
  ip?: string | null;
  project_dir?: string | null;
  /** Codex 节点上报的 CODEX_HOME。不是工作路径，也不是从 project_dir 推出来的。 */
  codex_home?: string | null;
  version?: string | null;
  /**
   * Resumeable runtime session id on the full `/api/status` row (Claude Code
   * `--resume`, Codex thread, and the same idea on other runtimes). Older hubs
   * omit it; the node page still renders the cell and shows 「—」.
   */
  session_id?: string | null;
  model?: string | null;
  runtime?: string | null;
  /** Explicit runtime-reported OS identity only. Never infer this from project_dir. */
  os_user?: string | null;
  system_user?: string | null;
  /** app#225 follow-up — hub `/api/status`: this session answers the rules-file
   *  doorbell (agent-node, or a claude-code session's channel server). Absent on
   *  older hubs / older nodes ⇒ treat as false. */
  rules_file_capable?: boolean;
  /** #460 — hub ≥ #460: failing health layers, present only when the node's fresh health says a layer is down
   *  (light and full projections). Older hubs omit it; node-degraded.ts then reads `health` (full projection). */
  degraded?: Array<{ layer: string; label: string; reason: string }> | null;
  /** #448 — hub ≥ .84 full projection: the node's last layered health report (null = not reported / stale). */
  health?: Record<string, unknown> | null;
  health_observed_ms_ago?: number | null;
  /** Node skills view — hub `/api/status`: this session answers skills_list /
   *  skill_read on the rules-file doorbell. Absent ⇒ false (no fallback). */
  /** #1510 — how this node reaches the hub, as the NODE itself reports it:
   *  `loopback` (nothing leaves the machine), `https`, or `plain` (weakest; also
   *  what an unparseable hub URL reports). Absent ⇒ older node/hub. */
  env_transport?: 'loopback' | 'https' | 'plain' | string;
  /** #1491 — hub ≥ that lane: this node answers the `node_secrets` doorbell and
   *  can apply env changes to its own secrets.env at the next start. Absent ⇒ an
   *  older node/hub; the section hides instead of offering a button that expires. */
  node_secrets_capable?: boolean;
  /** #1474 — hub ≥ #1474: JSON array of the env key NAMES this node has, from
   *  its own `secrets.env`. **NAMES ONLY** — the node-side collector parses and
   *  drops values, and the hub rejects anything that is not a name. Absent ⇒ the
   *  hub/node predates #1474 (`node-secret-keys.ts` keeps that distinct from an
   *  empty list). */
  secret_keys?: string | null;
  skills_capable?: boolean;
  /** Project folder view — hub `/api/status`: this session answers files_list /
   *  file_read. A hub that predates it omits the key entirely (node-files.ts
   *  filesSupport tells the two apart). */
  files_capable?: boolean;
  /** Node run-log view — hub `/api/status`: this session answers logs_tail. A hub
   *  that predates it omits the key entirely (node-logs.ts logsSupport). */
  logs_capable?: boolean;
}

export interface HubTask {
  task_id?: string;
  from_name?: string;
  to_name?: string;
  content?: string;
  /** Agent replies live in `result` on the hub's task rows. */
  result?: string;
  reply?: string;
  status?: string;
  priority?: string;
  created_at?: string;
  updated_at?: string;
  delivered_at?: string;
  started_at?: string;
  runtime_submitted_at?: string;
  consumed_at?: string;
  completed_at?: string;
  expires_at?: string;
  /** Exact runtime context exposed by SideThread-capable Hubs. */
  thread_id?: string;
  turn_id?: string;
  /** Task meta as stored by the hub (JSON). Dashboard sends carry meta.client_request_id — the
   *  optimistic bubble's id — which is how ChatScreen matches its echo to this row (chat-echo.ts). */
  meta_json?: string | null;
}

export interface HubConfig {
  serverUrl: string; // e.g. https://hub.example.com
  token: string;
  networkId?: string; // hub scopes sends by network (#220 round 18)
  profileId?: string;
  /** Authenticated Hub username. Sent as REST task `from` so older hubs
   *  do not persist the transport fallback `api`. New logins set this. */
  username?: string;
  displayName?: string;
}

const headers = (cfg: HubConfig) => ({
  Authorization: `Bearer ${cfg.token}`,
  'Content-Type': 'application/json',
});

// RN's fetch has no timeout: on flaky mobile networks a request can hang
// forever and the UI spins with no way out (Vincent tg 841). Abort hard.
const TIMEOUT_MS = 12000;
/** hub MCP 工具调用(含读完响应体)的硬上限。withTimeout 只管到响应头。 */
const HUB_TOOL_DEADLINE_MS = TIMEOUT_MS + 3_000;

const withTimeout = (run: (signal: AbortSignal) => Promise<Response>): Promise<Response> => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return run(ctrl.signal).finally(() => clearTimeout(timer));
};

// 连接状态横幅(通信龙 App战线①):共享读路径上每次请求结局都上报 connectivity——
// 成功=拿到并解析出数据;失败=网络错/超时/网关 5xx/解析错(数据没到,UI 是陈旧的)。
// 其他非 2xx(401/403/404…)说明服务器是连得上的,不算"连不上"(readStatusCountsAsFailure)。
// 只挂在 get()(全部轮询读)上;写路径有各自显式失败 UI,不进此口径。
import { readEpoch, readStatusCountsAsFailure, reportReadFailure, reportReadSuccess } from './connectivity';
import { conditionalHeaders, readConditionalText } from './conditional-get';
import { classifyLoginFailure, type LoginFailureKind } from './login-flow';
import { isTokenExpiredBody } from './login-sessions';
import { LEGACY_SESSION_ID } from './session-registry';

/** 401 上报用的账号 id:手机 / 网页上迁移过来的账号 cfg 不带 profileId,它在账号列表里的 id 是 legacy
 *  (storage.sessionIdOf 同一规则;桌面端的 cfg 总带 profileId)。 */
export const authProfileId = (cfg: Pick<HubConfig, 'profileId'>): string => cfg.profileId ?? LEGACY_SESSION_ID;
import { userMessagesPath } from './user-unread';
import { pickDefaultNetworkId } from './user-admin';
import { fetchAuthMe, forgetAuthMeFor } from './user-admin-api';
import { SendTaskError, isNetworkScopedSendFailure } from './send-failure-reason';
export { SendTaskError } from './send-failure-reason';
import { stripHumanDms } from './human-dm';
import { aliasNetworkFor, networkCandidates, rememberAliasNetworks } from './send-target-network';
import { aliasNetworkCache, resolveAliasNetwork } from './alias-network-lookup';
import { splitSystemNotices, stripSystemNotices } from './system-notice';
import { createReplyInboxReader } from './inbox-cursor';
import { createUserMessagesWindow } from './user-messages-window';

/** 一次轮询读的硬上限:从发出到**读完响应体**。withTimeout 只管到响应头,响应体卡在半开的隧道
 *  连接上时 `res.json()` 永远不返回 —— 那个轮询就永远 running、再也不刷新(2026-09-29)。
 *  20 s 给高延迟链路留余量(手机经 RELAY 量到 /health 2.8 s),又不会让一次卡死拖住整页。 */
export const READ_DEADLINE_MS = 20_000;
let readDeadlineMs = READ_DEADLINE_MS;
/** Test-only: shorten the read deadline so a hanging-body test doesn't wait 20 s. */
export function __setReadDeadlineForTest(ms: number = READ_DEADLINE_MS): void { readDeadlineMs = ms; }

/** 响应头里的长度(经 gzip 时是线上字节);没有就不报。诊断用。 */
export function bodyBytes(res: { headers?: { get?: (k: string) => string | null } }): number | undefined {
  const n = Number(res.headers?.get?.('content-length') ?? NaN);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** #911 —— Hub 返回非 JSON(HTML/纯文本)时,把底层 JSON Parse error 换成可读提示。 */
export function parseJsonOrFriendly<T>(text: string, status: number, contentType: string | null): T {
  try { return JSON.parse(text) as T; } catch { /* fallthrough */ }
  const ct = (contentType ?? '').toLowerCase();
  const prefix = text.slice(0, 120).replace(/\s+/g, ' ').trim();
  let cause: string;
  if (ct.includes('text/html') || prefix.startsWith('<')) cause = 'HTML';
  else if (ct.includes('text/plain') || !ct) cause = '纯文本';
  else cause = ct;
  // Preserve JSON.parse's error type: legacy Hub route fallbacks identify SyntaxError.
  throw new SyntaxError(
    `Hub 返回了非 JSON 响应 / Non-JSON Hub response（HTTP ${status}, Content-Type: ${contentType ?? '无'}）。\n` +
    `正文前缀 / Response prefix:「${prefix.slice(0, 60)}」（${cause}）。\n` +
    `请检查 Hub 地址、登录是否过期及 Hub 版本 / Check Hub URL, sign-in expiry and Hub version（commhub-server ≥ 0.9.0-preview.126）。`,
  );
}

async function get<T>(cfg: HubConfig, path: string): Promise<T> {
  const started = Date.now();
  const epoch = readEpoch();
  const ctrl = new AbortController();
  let reported = false;
  try {
    const got = await withDeadline(
      (async () => {
        // #467 —— hub 回过 ETag 的读(/api/status、/api/requirements)带 If-None-Match;304 用上次的原文(conditional-get.ts)。
        const res = await appFetch(`${cfg.serverUrl}${path}`, { headers: { ...headers(cfg), ...conditionalHeaders(cfg, path) }, signal: ctrl.signal });
        // 401 的正文区分「登录已过期」(hub 闲置过期,error=token_expired)和别的失效。
        const expired = res.status === 401 && isTokenExpiredBody(await res.json().catch(() => null));
        reportProfileAuthResponse(res.status, authProfileId(cfg), expired ? 'token_expired' : undefined, cfg.token);
        const text = res.ok || res.status === 304 ? await readConditionalText(cfg, path, res) : null;
        return { res, ok: text !== null, data: text !== null ? parseJsonOrFriendly<T>(text, res.status, res.headers?.get?.('content-type') ?? null) : undefined };
      })(),
      readDeadlineMs,
      () => null,
    );
    if (!got) {
      ctrl.abort();
      throw new Error(`Hub ${Math.round(readDeadlineMs / 1000)} 秒内没有返回完整响应（${path}）`);
    }
    if (!got.ok) {
      if (!readStatusCountsAsFailure(got.res.status)) reported = true;
      throw new Error(`HTTP ${got.res.status} on ${path}`);
    }
    reportReadSuccess(Date.now(), Date.now() - started, { path, bytes: bodyBytes(got.res), epoch });
    reported = true;
    return got.data as T;
  } catch (e) {
    if (!reported) reportReadFailure();
    throw e;
  }
}

// `?light=1` (commhub-server ≥0.8.6) returns a narrow per-session
// projection — exactly the 6 fields the Session type uses, plus runtime +
// network_id. On a 150-agent network the response shrinks ~5x (e.g.
// 186 KB → 39 KB on a synthetic 160-row dataset), keeping cold open well
// inside the read deadline on flaky cellular. Older hubs ignore the param
// and return the full payload, so the call is safe regardless of server
// version.
/**
 * 列表不带 network_id ⇒ hub 按「我属于哪些网络」返回 ⇒ 列表是**跨网络**的。
 * 每一行都带 network_id,这里记下来:发送时直接用「这个 alias 住在哪个网络」,
 * 不用再靠 cfg.networkId 猜(admin 2026-10-21:其他用户发不了消息给 Agent 节点)。
 */
export const fetchStatus = async (cfg: HubConfig) => {
  const data = await get<{ sessions: Session[] }>(cfg, '/api/status?light=1');
  rememberAliasNetworks(aliasNetworkCache, data?.sessions);
  return data;
};

/** Detached daemon management must not inherit the account's default network. */
export const fetchScopedStatus = (cfg: HubConfig) =>
  get<{ sessions: Session[] }>(cfg, `/api/status?light=1${cfg.networkId ? `&network_id=${encodeURIComponent(cfg.networkId)}` : ''}`);

/** Full, authenticated status projection for the one-node details screen.
 * List/chat polling stays on `?light=1`; this opt-in read is where legacy
 * Hubs may omit newer nullable facts such as `os_user` and `session_id`.
 *
 * `alias` asks the hub for that one agent's rows (`/api/status?alias=`): the
 * full projection of a whole network is ~533 KB (94 KB gzip) on the
 * production hub, fetched per chat open and per 10 s node-page poll to read
 * one row. Hubs that predate the parameter ignore it and return every row, so
 * callers still pick their row by alias. */
export function nodeStatusPath(networkId?: string, alias?: string): string {
  const scoped = networkId?.trim();
  if (!scoped) throw new Error('network_id is required for node details');
  const one = alias?.trim();
  return `/api/status?network_id=${encodeURIComponent(scoped)}${one ? `&alias=${encodeURIComponent(one)}` : ''}`;
}

export const fetchNodeStatus = (cfg: HubConfig, alias?: string) =>
  get<{ sessions: Session[] }>(cfg, nodeStatusPath(cfg.networkId, alias));

/** A registered node row (subset we consume). The hub's GET /api/nodes
 *  returns `{ ok, nodes, count }`; hub #462 added `avatar_url` to the
 *  projection (server.ts:2784) — nullable, `/avatars/<name>.(webp|png|svg)`
 *  or an absolute http(s) URL (avatar-validate.ts). */
export interface HubNode {
  node_id: string;
  alias: string;
  node_name?: string | null;
  avatar_url?: string | null;
  lifecycle_state?: string | null;
  runtime?: string | null;
  model?: string | null;
  server?: string | null;
  hostname?: string | null;
  role?: string | null;
  /** app#196 —— hub 显式告知这个节点能不能走 stop/restart/delete。
   *  判据在 hub 侧（node_create_requests 里真有创建记录，或它本身是 daemon），
   *  🔴 **不是 id 前缀** —— 前缀是实现细节，今天恰好等价，明天会悄悄失效。
   *  旧 hub 没有这个字段 ⇒ undefined ⇒ 按可控渲染（与升级前行为逐字相同，
   *  错误仍会在提交时由 hub 拒绝并显示）。 */
  lifecycle_controllable?: boolean;
  lifecycle_daemon_node_id?: string | null;
  /** Hub .110 user-only projection; missing means no adoption UI. */
  managed?: 'created' | 'adopted' | 'none';
  adoption?: { request_id: string; daemon_node_id: string; status: 'pending' | 'active' | 'refused' | 'revoked'; error: string | null } | null;
  /** 行最近一次被写的时间(hub `datetime('now')`,UTC)。同一别名有多行时,选择器挑最新的那行。 */
  updated_at?: string | null;
  config_revision?: number | null;
  /** RFC-041(Hub ≥ .92):节点自己的模式。旧 Hub 没有 ⇒ undefined(当作正常)。 */
  permission_mode?: 'normal' | 'readonly' | 'restricted' | null;
  /** Hub ≥ .93(#2275):调用者能不能改这个节点的模式 —— 「权限」分区只在它为 true 时出现。 */
  viewer_can?: { permission_mode?: boolean } | null;
  config_snapshot?: {
    model?: string | null;
    role?: string | null;
    channels?: unknown[];
    flags?: Record<string, unknown>;
  } | null;
}

/** GET /api/nodes — the registered-node list, used for avatar resolution.
 *  Two things matter to the avatar chain: (1) a node's `avatar_url` is the
 *  CROSS-DEVICE truth (sits above any local layer), (2) an alias *appearing
 *  here at all* means it is "node-backed" — hub is its whole avatar truth,
 *  including when avatar_url is null (cleared). Aliases NOT in this list are
 *  session-only. Network-scoped like the rest; older hubs without the column
 *  simply omit `avatar_url` (→ alias falls through to the pool), so it's safe
 *  regardless of server version. */
export const fetchHubNodes = (cfg: HubConfig): Promise<{ nodes: HubNode[] }> => {
  const q = cfg.networkId ? `?network_id=${encodeURIComponent(cfg.networkId)}` : '';
  return get<{ nodes: HubNode[] }>(cfg, `/api/nodes${q}`);
};

export type HubScheduleSpec =
  | { type: 'once'; run_at: string }
  | { type: 'interval'; every_seconds: number }
  | { type: 'daily'; time: string }
  | { type: 'weekly'; time: string; weekdays: number[] };

export type HubMisfirePolicy = 'catch_up_once' | 'skip';

export interface HubScheduledTask {
  schedule_id: string;
  network_id: string;
  name: string;
  target_node_id: string;
  target_alias: string;
  task_content: string;
  priority: 'high' | 'normal' | 'low';
  schedule: HubScheduleSpec;
  timezone: string;
  misfire_policy?: HubMisfirePolicy;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  next_run_at?: string | null;
  last_run_at?: string | null;
  revision: number;
  /** Present when the Hub supports schedule watchers. */
  watchers?: { user_id: string; username: string; display_name: string }[];
  is_watcher?: boolean;
  can_edit?: boolean;
  can_manage_watchers?: boolean;
}

export interface HubScheduledRun {
  run_id: string;
  schedule_id: string;
  scheduled_for: string;
  task_id?: string | null;
  status: string;
  error_code?: string | null;
  error_message?: string | null;
  created_at: string;
  /** 终态时刻(Hub 镜像自任务的 completed_at);还没结束为 null。 */
  completed_at?: string | null;
}

const networkQuery = (cfg: HubConfig) => cfg.networkId
  ? `?network_id=${encodeURIComponent(cfg.networkId)}`
  : '';

export const fetchScheduledTasks = (cfg: HubConfig) =>
  get<{ ok: true; schedules: HubScheduledTask[] }>(cfg, `/api/scheduled-tasks${networkQuery(cfg)}`);

/** limit:Hub 夹在 1–200(server/src/scheduled-tasks.ts);节点页只要最近一次,传 1。 */
export const fetchScheduledRuns = (cfg: HubConfig, scheduleId: string, limit = 50) => {
  const q = new URLSearchParams({ limit: String(limit) });
  if (cfg.networkId) q.set('network_id', cfg.networkId);
  return get<{ ok: true; runs: HubScheduledRun[] }>(cfg, `/api/scheduled-tasks/${encodeURIComponent(scheduleId)}/runs?${q}`);
};

async function scheduledWrite<T>(cfg: HubConfig, path: string, method: string, body?: unknown): Promise<T> {
  const res = await withTimeout(signal => appFetch(`${cfg.serverUrl}${path}`, {
    method,
    headers: headers(cfg),
    signal,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new ScheduledTaskError(data?.message || data?.error || `HTTP ${res.status}`, res.status, data?.error);
  }
  return data as T;
}

export class ScheduledTaskError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'ScheduledTaskError';
  }
}

export type ScheduledTaskMutationInput = {
  name: string;
  target_node_id: string;
  task: string;
  priority: 'high' | 'normal' | 'low';
  timezone: string;
  schedule: HubScheduleSpec;
  misfire_policy: HubMisfirePolicy;
  watchers?: string[];
};

export const createScheduledTask = (
  cfg: HubConfig,
  input: ScheduledTaskMutationInput,
) => scheduledWrite<{ ok: true; schedule: HubScheduledTask }>(cfg, '/api/scheduled-tasks', 'POST', { ...input, network_id: cfg.networkId });

export const updateScheduledTask = (cfg: HubConfig, row: HubScheduledTask, input: ScheduledTaskMutationInput) =>
  scheduledWrite<{ ok: true; schedule: HubScheduledTask }>(
    cfg,
    `/api/scheduled-tasks/${encodeURIComponent(row.schedule_id)}${networkQuery(cfg)}`,
    'PATCH',
    { revision: row.revision, ...input },
  );

/**
 * 只改任务内容(定时任务详情页的「全屏」编辑):PATCH 只带 revision + task,其余字段 Hub 保持原样
 * (server/src/scheduled-tasks.ts:body 里没有的字段取库里的值)。409 的处理见 schedule-content-edit.ts。
 */
export const updateScheduledTaskContent = (cfg: HubConfig, row: HubScheduledTask, task: string) =>
  scheduledWrite<{ ok: true; schedule: HubScheduledTask }>(
    cfg,
    `/api/scheduled-tasks/${encodeURIComponent(row.schedule_id)}${networkQuery(cfg)}`,
    'PATCH',
    { revision: row.revision, task },
  );

export const setScheduledTaskStatus = (cfg: HubConfig, row: HubScheduledTask, status: 'active' | 'paused') =>
  scheduledWrite<{ ok: true; schedule: HubScheduledTask }>(cfg, `/api/scheduled-tasks/${encodeURIComponent(row.schedule_id)}${networkQuery(cfg)}`, 'PATCH', { revision: row.revision, status });

export const runScheduledTaskNow = (cfg: HubConfig, scheduleId: string) =>
  scheduledWrite<{ ok: true; taskId?: string; status: string }>(cfg, `/api/scheduled-tasks/${encodeURIComponent(scheduleId)}/run-now${networkQuery(cfg)}`, 'POST', {});

export const cancelScheduledTask = (cfg: HubConfig, scheduleId: string) =>
  scheduledWrite<{ ok: true; status: string }>(cfg, `/api/scheduled-tasks/${encodeURIComponent(scheduleId)}${networkQuery(cfg)}`, 'DELETE');

// ── 节点外部计划（RFC-036）。节点把本机 crontab/systemd 等计划的快照上报到
// Hub（#684，只有元数据，绝无命令/路径），owner 通过「编辑意向」改 enabled 或
// 五段 cron 时间（#688）；节点侧领取意向后自行落地并回执。

export interface HubExternalSchedule {
  id: string;
  name: string;
  kind: 'cron' | 'systemd' | 'tmux' | 'playwright' | 'custom';
  frequency: string;
  last_run_at: string | null;
  last_status: 'success' | 'failed' | 'running' | 'unknown';
  last_error: string | null;
  next_run_at: string | null;
  log_ref: string | null;
  enabled: boolean;
  /** RFC-036: 只有 agent-node 托管的 cron 条目带 editable+revision，其余只读。 */
  editable?: boolean;
  revision?: number;
}

export interface HubNodeExternalSchedules {
  node_id: string;
  alias: string;
  observed_at: string;
  error?: string;
  schedules: HubExternalSchedule[];
}

/** 汇总各节点上报的外部计划快照。走全量 /api/status —— light=1 会剥掉
 *  external_schedules 字段，这里绝不能带 light。同一 node_id 若有多条会话，
 *  取 updated_at 最新且带快照的那条（与 Hub 端 reportedSchedule 同准则）。 */
export const fetchExternalSchedules = async (cfg: HubConfig): Promise<HubNodeExternalSchedules[]> => {
  const data = await get<{ sessions: Array<{
    alias?: string;
    node_id?: string | null;
    updated_at?: string | null;
    external_schedules?: { observed_at?: string; schedules?: HubExternalSchedule[]; error?: string } | null;
  }> }>(cfg, `/api/status${networkQuery(cfg)}`);
  const byNode = new Map<string, { updatedAt: number; row: HubNodeExternalSchedules }>();
  for (const s of data.sessions || []) {
    if (!s.node_id || !s.external_schedules || !Array.isArray(s.external_schedules.schedules)) continue;
    const updatedAt = s.updated_at ? Date.parse(s.updated_at) || 0 : 0;
    const seen = byNode.get(s.node_id);
    if (seen && seen.updatedAt >= updatedAt) continue;
    byNode.set(s.node_id, { updatedAt, row: {
      node_id: s.node_id,
      alias: s.alias || s.node_id,
      observed_at: s.external_schedules.observed_at || '',
      ...(s.external_schedules.error ? { error: s.external_schedules.error } : {}),
      schedules: s.external_schedules.schedules,
    } });
  }
  return [...byNode.values()].map(v => v.row).sort((a, b) => a.alias.localeCompare(b.alias));
};

export interface HubExternalScheduleEditIntent {
  intent_id: string;
  node_id: string;
  schedule_id: string;
  base_revision: number;
  patch: { enabled?: boolean; cron?: string };
  status: 'pending' | 'delivered' | 'applied' | 'rejected' | 'expired';
  expires_at: string;
  created_at: string;
  delivered_at: string | null;
  acked_at: string | null;
  result_revision: number | null;
  error_code: string | null;
}

/** owner 视角的意向记录（最近 100 条，仅本人创建的）。 */
export const fetchExternalScheduleEdits = (cfg: HubConfig, nodeId: string) =>
  get<{ ok: true; edits: HubExternalScheduleEditIntent[] }>(cfg, `/api/nodes/${encodeURIComponent(nodeId)}/external-schedule-edits${networkQuery(cfg)}`);

/** 从意向记录里选出每个计划「仍在途」的那条：delivered（节点已领取、等回执）
 *  恒为在途；pending 只有未过 TTL（expires_at > now）才算——Hub 侧
 *  expireOpenIntents 会把过期 pending 收尾，这里镜像同一判定，别把死意向
 *  当在途去锁按钮。同计划多条取 created_at 最新。键：`${node_id}:${schedule_id}`。 */
export const selectOpenIntents = (
  edits: HubExternalScheduleEditIntent[],
  now: number,
): Record<string, HubExternalScheduleEditIntent> => {
  const open: Record<string, HubExternalScheduleEditIntent> = {};
  for (const edit of edits) {
    const inFlight = edit.status === 'delivered'
      || (edit.status === 'pending' && Date.parse(edit.expires_at) > now);
    if (!inFlight) continue;
    const key = `${edit.node_id}:${edit.schedule_id}`;
    if (!open[key] || Date.parse(edit.created_at) > Date.parse(open[key].created_at)) open[key] = edit;
  }
  return open;
};

/** 发起编辑意向。Hub 端 exactKeys 只收这四个键；network_id 必须等于节点归属网络
 *  （requireOwner 校验），patch 只允许 enabled / 五段 cron。冲突语义：
 *  revision_conflict / schedule_read_only / edit_in_flight / node_owner_changed
 *  都走 409，由 ScheduledTaskError.code 透出。 */
export const createExternalScheduleEdit = (
  cfg: HubConfig,
  nodeId: string,
  input: { schedule_id: string; base_revision: number; patch: { enabled?: boolean; cron?: string } },
) => scheduledWrite<{ ok: true; intent: HubExternalScheduleEditIntent }>(
  cfg,
  `/api/nodes/${encodeURIComponent(nodeId)}/external-schedule-edits`,
  'POST',
  { network_id: cfg.networkId, schedule_id: input.schedule_id, base_revision: input.base_revision, patch: input.patch },
);

export type PutAvatarResult =
  | { ok: true; avatar_url: string | null }
  | { ok: false; error: string; reason?: string; status?: number };

/** PUT /api/nodes/:node_id/permission-mode(RFC-041,#489)—— 节点主人、网络 owner / admin 能改;
 *  别人 403,看不见这个节点 404。 */
export const putNodePermissionMode = async (
  cfg: HubConfig,
  nodeId: string,
  mode: 'normal' | 'readonly' | 'restricted',
): Promise<{ ok: true; permission_mode: string; previous?: string } | { ok: false; error: string; status?: number }> => {
  try {
    const res = await withTimeout(signal =>
      appFetch(`${cfg.serverUrl}/api/nodes/${encodeURIComponent(nodeId)}/permission-mode`, {
        method: 'PUT',
        headers: headers(cfg),
        signal,
        body: JSON.stringify({ mode }),
      }),
    );
    const body = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || body?.ok === false) return { ok: false, error: body?.error || `HTTP ${res.status}`, status: res.status };
    return { ok: true, permission_mode: String(body?.permission_mode ?? mode), previous: body?.previous };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

/** GET /api/networks/:id/node-permission-report —— 过去 7 天每个节点「本来会被拦」的次数。只给网络 owner / admin;
 *  别人(包括只是节点主人的普通成员)403 ⇒ 返回 null,界面不显示报表这一行。 */
export const fetchNodePermissionReport = async (cfg: HubConfig): Promise<NodePermissionReport | null> => {
  if (!cfg.networkId) return null;
  try {
    return await get<NodePermissionReport>(cfg, `/api/networks/${encodeURIComponent(cfg.networkId)}/node-permission-report${networkQuery(cfg)}`);
  } catch {
    return null;
  }
};

/** PUT /api/nodes/:ref/avatar — set (or clear with null) a node's cross-device
 *  `avatar_url`. ref = alias (the hub resolves node_id/node_name/alias). The hub
 *  validates the URL shape (#550: absolute http(s) or /avatars/<name>.(webp|png|svg))
 *  — on reject it returns 400 {ok:false, reason}. Session-only aliases (no nodes
 *  row) return 404; callers should disable the control BEFORE the user tries. */
export const putNodeAvatar = async (
  cfg: HubConfig,
  ref: string,
  avatarUrl: string | null,
): Promise<PutAvatarResult> => {
  try {
    const res = await withTimeout(signal =>
      appFetch(`${cfg.serverUrl}/api/nodes/${encodeURIComponent(ref)}/avatar`, {
        method: 'PUT',
        headers: headers(cfg),
        signal,
        body: JSON.stringify({ avatar_url: avatarUrl }),
      }),
    );
    const body = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || body?.ok === false) {
      return { ok: false, error: body?.error || `HTTP ${res.status}`, reason: body?.reason, status: res.status };
    }
    return { ok: true, avatar_url: (body?.avatar_url ?? avatarUrl) as string | null };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || '网络错误' };
  }
};

// Boot-time prefetch (perf: load time). App boot fires the status request the
// instant the saved session is restored — before AgentsScreen mounts — so the
// network round-trip overlaps React mount/navigation instead of starting after
// it. AgentsScreen's first load consumes this in-flight promise; everything
// else (polls, other screens) ignores it. Consume-once + an 8s freshness gate
// keep it from ever serving a stale promise to a later, unrelated load.
let _statusPrefetch: { cfg: HubConfig; promise: Promise<{ sessions: Session[] }>; at: number } | null = null;

export const prefetchStatus = (cfg: HubConfig): void => {
  const promise = fetchStatus(cfg);
  // Suppress unhandled-rejection if the prefetch is never consumed; the real
  // consumer still awaits `promise` and sees any rejection for its own catch.
  promise.catch(() => {});
  _statusPrefetch = { cfg, promise, at: Date.now() };
};

export const takeStatusPrefetch = (cfg: HubConfig): Promise<{ sessions: Session[] }> | null => {
  const p = _statusPrefetch;
  if (p && p.cfg.serverUrl === cfg.serverUrl && p.cfg.token === cfg.token && Date.now() - p.at < 8000) {
    _statusPrefetch = null; // consume once
    return p.promise;
  }
  return null;
};

// 🔴 network_id is not optional decoration here. The hub resolves an unscoped
// user-token read as "every network this user belongs to"
// (server/src/network-scope.ts resolveRestNetworkScope, last branch →
// getUserNetworkIds), and /api/tasks then filters with
// `AND network_id IN (…)`. Without this parameter a conversation with alias X
// returns X's messages from *all* of the user's networks, interleaved by
// created_at — the same alias in two networks reads as one thread.
export const fetchTasks = (
  cfg: HubConfig,
  params: { to_name?: string; from_name?: string; limit?: number; skipStats?: boolean; before?: string; before_task_id?: string },
) => {
  const q = new URLSearchParams();
  if (params.to_name) q.set('to_name', params.to_name);
  if (params.from_name) q.set('from_name', params.from_name);
  q.set('limit', String(params.limit ?? 20));
  // hub #459 游标:只要比 (before, before_task_id) 更老的行,排序 created_at DESC, task_id DESC(#745 会话往上翻页)。
  if (params.before) q.set('before', params.before);
  if (params.before && params.before_task_id) q.set('before_task_id', params.before_task_id);
  // hub #248:不要全表 GROUP BY 的 stats(通知每 10–20 s 拉一次,用不到它)。老 hub 忽略这个参数。
  if (params.skipStats) q.set('skip_stats', '1');
  if (cfg.networkId) q.set('network_id', cfg.networkId);
  return get<{ tasks: HubTask[] }>(cfg, `/api/tasks?${q}`);
};

// Detail fetch by task_id — hub supports `?task_id=<id>` as a filter on
// the /api/tasks endpoint (verified against dashboard's proxy at
// app/api/hub/tasks/route.ts, which accepts task_id and forwards it).
// Returns the single task or null; distinct from "network error" (which
// throws) so callers can render "not found" vs "temporary failure".
export const fetchTaskDetail = async (
  cfg: HubConfig,
  taskId: string,
): Promise<HubTask | null> => {
  const q = new URLSearchParams({ task_id: taskId, limit: '1' });
  // Same endpoint, same scoping rule — a task id is unique, but an unscoped
  // read still asks across every network the user belongs to.
  if (cfg.networkId) q.set('network_id', cfg.networkId);
  const data = await get<{ tasks: HubTask[] }>(cfg, `/api/tasks?${q}`);
  return data.tasks?.[0] ?? null;
};

/** Single-task diagnostic reuses the existing authenticated, network-scoped Hub endpoint.
 * Only legacy unsupported/not-found responses fall back. Auth/connection failures remain errors. */
export async function fetchTaskInspection(cfg: HubConfig, taskId: string): Promise<{
  task: HubTask | null; diagnostic: TaskDiagnostic | null;
}> {
  const q = new URLSearchParams();
  if (cfg.networkId) q.set('network_id', cfg.networkId);
  try {
    const data = await get<{ task?: HubTask; diagnostic?: unknown }>(cfg,
      `/api/tasks/${encodeURIComponent(taskId)}${q.size ? `?${q}` : ''}`);
    if (data.task?.task_id === taskId) {
      return { task: data.task, diagnostic: readTaskDiagnostic(data.diagnostic) };
    }
    // Old Hubs may answer an unknown route with their JSON help response.
  } catch (e) {
    if (!(e instanceof SyntaxError) && !(e instanceof Error && /^HTTP (404|501) on /.test(e.message))) throw e;
  }
  return { task: await fetchTaskDetail(cfg, taskId), diagnostic: null };
}

// Task events feed — status transitions logged by the hub.
//
// 🔴 Path naming warning: on the hub itself this endpoint is
// `/api/task_events` (UNDERSCORE). The dashboard's proxy at
// `/api/hub/task-events` (HYPHEN) is a naming choice of the dashboard,
// NOT the hub. Copy-pasting the dashboard path to hit hub directly will
// 404. Since the third-state banner below fires on 404, a mis-typed
// path here would silently produce "hub 未暴露 task_events" for
// everyone — the runtime evidence and the real cause would look the
// same. Keep the underscore.
export interface HubTaskEvent {
  id?: number;
  event_type?: string;
  from_status?: string;
  to_status?: string;
  detail?: string;
  created_at?: string;
}
export type FetchTaskEventsResult =
  | { ok: true; events: HubTaskEvent[]; count: number }
  | { ok: false; unconfirmed: true; error: string }   // 404 / 501 / non-JSON → hub 未暴露 or 需升级
  | { ok: false; unconfirmed: false; error: string }; // 网络 / 其它错误

const TASK_EVENTS_NEEDS_UPGRADE =
  '当前 hub 未暴露 /api/task_events，events feed 不可用（需 hub 升级或缺少该 endpoint）';

export const fetchTaskEvents = async (
  cfg: HubConfig,
  taskId: string,
  limit = 50,
): Promise<FetchTaskEventsResult> => {
  try {
    const q = new URLSearchParams({ task_id: taskId, limit: String(limit) });
    if (cfg.networkId) q.set('network_id', cfg.networkId);
    const res = await withTimeout(signal =>
      // NB: hub path uses underscore — see comment above.
      appFetch(`${cfg.serverUrl}/api/task_events?${q}`, { headers: headers(cfg), signal }),
    );
    if (res.status === 404 || res.status === 501) {
      return { ok: false, unconfirmed: true, error: TASK_EVENTS_NEEDS_UPGRADE };
    }
    if (!res.ok) {
      return { ok: false, unconfirmed: false, error: `HTTP ${res.status}` };
    }
    // Pre-support hubs may serve a non-JSON help banner on unknown paths
    // (same pattern as fetchHostSupervisors). Guard the content-type so
    // "wrong hub version" doesn't slide into an "empty events" green.
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      return { ok: false, unconfirmed: true, error: TASK_EVENTS_NEEDS_UPGRADE };
    }
    const data = (await res.json().catch(() => null)) as
      { ok?: boolean; events?: HubTaskEvent[]; count?: number; error?: string } | null;
    if (!data || (data.ok === undefined && data.events === undefined)) {
      return { ok: false, unconfirmed: true, error: TASK_EVENTS_NEEDS_UPGRADE };
    }
    if (data.ok === false) {
      return { ok: false, unconfirmed: false, error: data.error || 'hub returned ok:false' };
    }
    const events = Array.isArray(data.events) ? data.events : [];
    const count = typeof data.count === 'number' ? data.count : events.length;
    return { ok: true, events, count };
  } catch (e: unknown) {
    return { ok: false, unconfirmed: false, error: e instanceof Error ? e.message : String(e) };
  }
};

export interface HubMessage {
  id: string;
  from_alias?: string;
  to_alias?: string;
  type?: string;
  priority?: string;
  content?: string;
  created_at?: string;
  acked?: number;
}

/** scope=user 分支(user_inbox 表)的一行;字段名与 inbox 行不同。 */
export interface HubUserMessage {
  message_id?: string;
  from_session?: string;
  acked?: number;
  /** 0.2.76 系统通知要念正文/时间;hub 一直返回这些字段,之前客户端没读。 */
  kind?: string;
  title?: string | null;
  content?: string;
  created_at?: string;
}

/** alias 分支(inbox 表)。🔴 hub 不给 `since` 时默认只看最近 1 小时 —— 算「回复未读」要把窗口拉开,
 *  否则一小时前的未读会凭空消失(reply-unread.ts)。 */
export const fetchMessages = (cfg: HubConfig, limit: number, since?: string) =>
  get<{ messages: HubMessage[] }>(cfg, `/api/messages?limit=${limit}${since ? `&since=${encodeURIComponent(since)}` : ''}`);

/** 回复未读的取数窗口:最近 7 天(hub 的 UTC `YYYY-MM-DD HH:MM:SS`)。 */
export const replyUnreadSince = (now: Date = new Date()): string =>
  new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);

/**
 * 回复未读 / 通知的 inbox 读(Agent 列表和通知轮询共用一份)。第一次整读 7 天 × 300 条,之后只读游标之后的
 * 新行并合并成同一个「窗口内最新 300 条」(inbox-cursor.ts)。生产上每 10 s 从 116 KB(gzip)降到几 KB。
 * 读失败时缓存不动,照旧抛给调用方。
 */
const replyInbox = createReplyInboxReader();
export const fetchReplyInbox = (cfg: HubConfig, now: number = Date.now()): Promise<{ messages: HubMessage[] }> =>
  replyInbox.read(`${cfg.serverUrl}\u0000${cfg.token}\u0000${cfg.networkId ?? ''}`, (limit, since) => fetchMessages(cfg, limit, since), now);
/** Test-only. */
export function __resetReplyInboxForTest(): void { replyInbox.reset(); }

/**
 * #1563 —— agent 主动发给**登录用户**的消息落在 hub 的 `user_inbox` 表,
 * 上面那个 `fetchMessages` 走的是 **alias 分支**(读 `inbox` 表),取不到它们。
 * 服务端的 user 作用域返回 `{ ok, messages, unread, pending_count }`,
 * 其中 `unread` 就是给角标读的 —— 而这个客户端此前**一次都没调过**
 * (全仓 `scope=user` 0 处)。
 */
export interface UserMessagesResponse {
  messages: HubMessage[];
  unread?: number;
  pending_count?: number;
  /** #1828(hub ≥ 0.9.0-preview.51):按 from_session 分的权威未读;老 hub 没有这个字段。 */
  unread_by_agent?: Record<string, number>;
  unread_total?: number;
}
// 私信(kind='human_dm')也在 user_inbox 里:在这个唯一的取数口摘掉,agent 的会话 / 角标 / 通知都看不到它(human-dm.ts)。
// 「任务提醒」发的到期提醒(没有会话可去的系统通知)同样摘掉(system-notice.ts,#493)。
export const fetchUserMessages = (cfg: HubConfig, limit: number) =>
  get<UserMessagesResponse>(cfg, userMessagesPath(limit, cfg.networkId)).then(body => stripSystemNotices(stripHumanDms(body)));
/**
 * 手机通知运行时用(#499):同一次读,agent 链路照旧拿不到系统通知行,另外把这些行单独交出来
 * (应用在后台、用户流没推到时,只有轮询能看到「任务提醒」发的到期提醒)。
 */
export const fetchUserMessagesWithSystemRows = (cfg: HubConfig, limit: number) =>
  get<UserMessagesResponse>(cfg, userMessagesPath(limit, cfg.networkId)).then(body => splitSystemNotices(stripHumanDms(body)));

/**
 * 会话页的 user_inbox 读:第一次 200 条,之后每拍只读最新 50 条并进手里的 200 条(user-messages-window.ts)。
 * 口径与每拍读 200 条相同;生产上每 5 s 从 90 KB(gzip)降到约 19 KB。人与人私信照旧在最后剥掉 ——
 * 窗口按 hub 原始行判断「有没有漏」,剥掉之后的条数不能拿来判断。
 */
const chatUserWindow = createUserMessagesWindow();
export const fetchChatUserMessages = (cfg: HubConfig, now: number = Date.now()) =>
  chatUserWindow
    .read(`${cfg.serverUrl}\u0000${cfg.token}\u0000${cfg.networkId ?? ''}`, limit => get<UserMessagesResponse>(cfg, userMessagesPath(limit, cfg.networkId)), now)
    .then(body => stripSystemNotices(stripHumanDms(body as UserMessagesResponse)));
/** Test-only. */
export function __resetChatUserMessagesForTest(): void { chatUserWindow.reset(); }

/** #1828:把看过的消息在 hub 上标已读(user_inbox 行 + inbox 里发给自己用户名的回复行);hub 只改自己的行。 */
export const ackUserMessages = async (cfg: HubConfig, messageIds: string[]): Promise<number> => {
  if (!messageIds.length) return 0;
  const res = await withTimeout(signal =>
    appFetch(`${cfg.serverUrl}/api/messages/ack`, {
      method: 'POST',
      headers: headers(cfg),
      signal,
      body: JSON.stringify({ message_ids: messageIds.slice(0, 500) }),
    }),
  );
  if (!res.ok) throw new Error(`ack failed: HTTP ${res.status}`);
  const d = await res.json();
  return typeof d?.acked === 'number' ? d.acked : 0;
};

/** agent 级 ack(hub ≥ 0.9.0-preview.55):把该 agent 发给当前用户的**全部**未读行(两表、全部时间)一次标已读。
 *  老 hub 不认 `agent` 字段,回 400 message_id_required → supported=false,调用方退回按 id。 */
export const ackAgentMessages = async (cfg: HubConfig, agent: string): Promise<{ supported: boolean; acked: number }> => {
  if (!agent) return { supported: false, acked: 0 };
  const res = await withTimeout(signal =>
    appFetch(`${cfg.serverUrl}/api/messages/ack`, {
      method: 'POST',
      headers: headers(cfg),
      signal,
      body: JSON.stringify({ agent }),
    }),
  );
  if (res.status === 400) return { supported: false, acked: 0 };
  if (!res.ok) throw new Error(`ack failed: HTTP ${res.status}`);
  const d = await res.json();
  if (d?.ok !== true || d?.scope !== 'agent') return { supported: false, acked: 0 };
  return { supported: true, acked: typeof d?.acked === 'number' ? d.acked : 0 };
};

/** The hub's REST send endpoint is POST /api/task with {alias, task} —
 *  /api/send_task does not exist (it 404s into the server help text).
 *  Sends are network-scoped: utok users must pass an explicit network_id. */
const fetchAuthIdentity = async (cfg: HubConfig): Promise<{ networkId?: string; username?: string }> => {
  try {
    // 响应体也要有上限:规则文件/技能/项目文件夹的每一次入队和轮询都会先走这里拿 network_id。
    // Shared with every other「我是谁」read (user-admin-api.ts fetchAuthMe): one request per hub + token.
    const d: any = await withDeadline(fetchAuthMe(cfg).catch(() => null), HUB_TOOL_DEADLINE_MS, () => null);
    // 默认网络:current_network,否则 networks[0];多用户(hub#2084)下被管理员建进某网络的受限成员落在那个网络。
    const networkId = pickDefaultNetworkId(d);
    const username = d?.user?.username ?? d?.username;
    return {
      ...(typeof networkId === 'string' && networkId.trim() ? { networkId } : {}),
      ...(typeof username === 'string' && username.trim() ? { username: username.trim() } : {}),
    };
  } catch {
    return {};
  }
};

export const fetchNetworkId = async (cfg: HubConfig): Promise<string | undefined> =>
  (await fetchAuthIdentity(cfg)).networkId;

export interface TaskAttachment {
  type: 'file';
  file_id: string;
  name?: string;
  mime?: string;
  size?: number;
}

export type TaskPriority = 'high' | 'normal' | 'low';

export interface SendTaskResponse {
  ok: true;
  task_id?: string;
  message_id?: string;
  queued?: boolean;
  session_status?: string;
  deduplicated?: boolean;
  /** Hub contract provenance: agent-network draft PR #1209 (additive). */
  actual_to?: { alias: string; to_node_id: string | null; network_id: string | null };
  [key: string]: unknown;
}

// Dashboard chat is the only user-authenticated lane that may steer an
// already-running human Codex TUI turn. The Hub overwrites `auth_origin` from
// the bearer token; this client supplies only the interaction provenance and
// a per-send correlation id. The id is for routing/idempotency, not a secret.
let dashboardRequestSequence = 0;
export const createDashboardRequestId = () => {
  dashboardRequestSequence = (dashboardRequestSequence + 1) >>> 0;
  const time = Date.now().toString(16).padStart(12, '0').slice(-12);
  const random = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
    .toString(16)
    .padStart(13, '0')
    .slice(-13);
  const sequence = dashboardRequestSequence.toString(16).padStart(7, '0');
  return `dreq_${time}${random}${sequence}`;
};

const DASHBOARD_REQUEST_ID = /^dreq_[a-f0-9]{32}$/;

/** Retries of one optimistic bubble are one logical send. Legacy local-* rows
 * receive a deterministic, non-secret correlation id instead of a new id on
 * every click. */
export const dashboardRequestIdForLocalId = (localId: string): string => {
  if (DASHBOARD_REQUEST_ID.test(localId)) return localId;
  let output = '';
  for (let seed = 0; seed < 4; seed += 1) {
    let hash = (0x811c9dc5 ^ seed) >>> 0;
    for (let i = 0; i < localId.length; i += 1) {
      hash ^= localId.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    output += hash.toString(16).padStart(8, '0');
  }
  return `dreq_${output}`;
};

// #518 —— 发送的身份(network_id / username)每个 hub + 令牌只查一次,之后发送前**零等待**。
// 以前它只挂在传进来的 cfg 对象上:cfg 一换新对象(切账号回来、资料重载)就又是一次 /api/auth/me 往返
// (中国 → 美国 hub 一次 0.2–0.3 s,查询卡住时最多 15 s),全堆在「点发送」和「请求发出」之间。
// 只缓存查到的值;/api/task 回 401/403 时丢掉(令牌换了网络 / 被移出)。
const sendIdentityCache = new Map<string, { networkId?: string; username?: string }>();
const sendIdentityKey = (cfg: Pick<HubConfig, 'serverUrl' | 'token'>) => `${cfg.serverUrl}\u0000${cfg.token}`;
/** Test-only / after a role change. */
export function forgetSendIdentity(): void { sendIdentityCache.clear(); }
const rememberSendIdentity = (cfg: HubConfig, identity: { networkId?: string; username?: string }) => {
  if (!identity.networkId && !identity.username) return;
  const key = sendIdentityKey(cfg);
  sendIdentityCache.set(key, { ...sendIdentityCache.get(key), ...identity });
};

// #518 —— 一次发送的硬上限。withTimeout 只管到**响应头**(12 s);之后的 `res.json()` 在响应体卡住的连接上
// (半开隧道、hub 重启时被代理吊住)永远不返回 —— 气泡就永远「发送中…」。整个请求(含响应体)一个上限,
// 与 hub 工具调用同一个值(HUB_TOOL_DEADLINE_MS);到点 abort 并抛错,气泡转「未送达 · 重试」。
let sendHeaderTimeoutMs = TIMEOUT_MS;
let sendDeadlineMs = HUB_TOOL_DEADLINE_MS;
/** Test-only: shorten the send bounds so hang tests don't wait 15 s. No args = production values. */
export function __setSendBoundsForTest(bounds: { headerMs?: number; totalMs?: number } = {}): void {
  sendHeaderTimeoutMs = bounds.headerMs ?? TIMEOUT_MS;
  sendDeadlineMs = bounds.totalMs ?? HUB_TOOL_DEADLINE_MS;
}
/** Upper bound of one sendTask: identity lookup (only when network_id is unknown) + the request incl. body. */
export const sendSettleBoundMs = (): number => HUB_TOOL_DEADLINE_MS + sendDeadlineMs;

// #552 —— 发送把网络纠正过来后,把新的 network_id 落到这个账号上(App 装;手机 / 网页写 session-registry,
// 不改当前账号)。没装 = 只改内存里的 cfg。
type NetworkIdPersister = (cfg: HubConfig, networkId: string) => Promise<void> | void;
let networkIdPersister: NetworkIdPersister | null = null;
export function setNetworkIdPersister(fn: NetworkIdPersister | null): () => void {
  networkIdPersister = fn;
  return () => { if (networkIdPersister === fn) networkIdPersister = null; };
}

/**
 * POST /api/task。#552:Hub 回 404 alias_not_found / 400 network_id_required / 403「access denied to requested
 * network」时,很可能是 app 记着的网络过期了(登录时落盘的是个人网络,之后管理员把人拉进团队并授权 Agent)。
 * 这时丢掉缓存的身份、重新读 /api/auth/me 判网络(pickDefaultNetworkId);网络**真变了**才用同一个
 * client_request_id 再发**一次**(Hub 按它去重),并把新网络落盘。网络没变 / 第二次还失败 → 原样抛,绝不循环。
 */
export const sendTask = async (
  cfg: HubConfig,
  to: string,
  content: string,
  attachments?: TaskAttachment[],
  priority: TaskPriority = 'normal',
  clientRequestId = createDashboardRequestId(),
): Promise<SendTaskResponse> => {
  // #1968 私信发不出去(admin 2026-10-21 截图:tang → tang02 404 alias_not_found):
  // 列表是跨网络的(cfg.networkId 落在用户自己的个人网络),发送却钉死这一个网络。
  // 先用「这个 alias 住在哪个网络」发 —— 它就在用户点的那个 Agent 所在网络里。
  // 发送前用「这个 alias 住在哪个网络」——**只查已经记住的**(列表读时记下的),不发请求:
  // 发送路径的请求数是不变量(send-settle / task-priority-send 的断言)。
  // 没记住(第一次发、还没拉过列表)就走下面的重试那条路:那里才允许多读一次。
  const targetNetwork = aliasNetworkFor(aliasNetworkCache, to);
  try {
    return await sendTaskOnce(cfg, to, content, attachments, priority, clientRequestId, targetNetwork);
  } catch (err) {
    if (!isNetworkScopedSendFailure(err)) throw err;
    sendIdentityCache.delete(sendIdentityKey(cfg));
    forgetAuthMeFor(cfg);
    const identity = await fetchAuthIdentity(cfg);
    const fresh = identity.networkId;
    // 候选顺序:列表里记下的 alias 所属网络 → hub 查到的 → 重算的默认网络。
    // #552 的老路只有第三个,而且当两个网络对这个人都是 'all' 时它挑回原来那个错网络。
    const hinted = await resolveAliasNetwork(cfg.serverUrl, cfg.token, to);
    const candidates = networkCandidates(err.networkId, [hinted, fresh]);
    if (!candidates.length) throw err;
    rememberSendIdentity(cfg, identity);
    let lastError: unknown = err;
    for (const networkId of candidates.slice(0, 2)) {
      try {
        const response = await sendTaskOnce(cfg, to, content, attachments, priority, clientRequestId, networkId);
        cfg.networkId = networkId;
        try { void Promise.resolve(networkIdPersister?.(cfg, networkId)).catch(() => {}); } catch { /* persistence is best-effort */ }
        return response;
      } catch (retryError) {
        lastError = retryError;
        if (!isNetworkScopedSendFailure(retryError)) throw retryError;
      }
    }
    throw lastError;
  }
};

const sendTaskOnce = async (
  cfg: HubConfig,
  to: string,
  content: string,
  attachments: TaskAttachment[] | undefined,
  priority: TaskPriority,
  clientRequestId: string,
  /** 这一次发送用的网络(目标 alias 所在网络)。给了就用它,不动 cfg.networkId。 */
  networkOverride?: string,
): Promise<SendTaskResponse> => {
  const started = Date.now();
  const dreqAt = dreqCreatedAt(clientRequestId);
  const load = appFetchLoad(started);
  const cached = sendIdentityCache.get(sendIdentityKey(cfg));
  let networkId = networkOverride ?? cfg.networkId ?? cached?.networkId;
  let username = cfg.username?.trim() || cached?.username;
  let identitySource: SendTiming['identity'] = cfg.networkId && cfg.username?.trim() ? 'cfg' : 'cache';
  // #68 replacement: current hubs (#1156 / preview.38+) attribute omitted `from` from the user token.
  // Still send `from` when we have a username so older hubs do not persist the transport label `api`.
  // #518: only a missing network_id (required for utok sends) is worth waiting for; a missing
  // username is looked up in the background for the next send — never block the send on it.
  if (!networkId) {
    identitySource = 'lookup';
    const identity = await fetchAuthIdentity(cfg);
    rememberSendIdentity(cfg, identity);
    networkId = identity.networkId;
    username ||= identity.username;
  } else if (!username) {
    identitySource = 'background';
    void fetchAuthIdentity(cfg).then(identity => rememberSendIdentity(cfg, identity));
  }
  // 覆盖来的网络只用于这一次发送:cfg.networkId 是「这个账号的网络」,不能被目标 Agent 的网络改写。
  if (networkId && !networkOverride) cfg.networkId = networkId;
  if (username) cfg.username = username;
  const identityMs = Date.now() - started;

  const ctrl = new AbortController();
  const headerTimer = setTimeout(() => ctrl.abort(), sendHeaderTimeoutMs);
  const postAt = Date.now();
  let headersAt: number | null = null;
  let bodyAt: number | null = null;
  let status: number | null = null;
  let clockOffsetMs: number | null = null;
  const timing = (outcome: SendTiming['outcome'], error?: unknown) => recordSendTiming({
    at: started,
    requestId: clientRequestId,
    identity: identitySource,
    sinceDreqMs: dreqAt === null ? null : started - dreqAt,
    identityMs,
    headersMs: headersAt === null ? null : headersAt - postAt,
    bodyMs: headersAt === null || bodyAt === null ? null : bodyAt - headersAt,
    totalMs: Date.now() - started,
    outcome,
    status,
    clockOffsetMs,
    inflightAtSend: load.inflight,
    requestsLastMinute: load.lastMinute,
    ...(error !== undefined ? { error: error instanceof Error ? error.message : String(error) } : {}),
  });
  let got: { res: Response; data: any } | null;
  try {
    got = await withDeadline(
      (async () => {
        const res = await appFetch(`${cfg.serverUrl}/api/task`, {
          method: 'POST',
          headers: headers(cfg),
          signal: ctrl.signal,
          body: JSON.stringify({
            alias: to,
            task: content,
            priority,
            network_id: networkId,
            ...(username ? { from: username } : {}),
            meta: {
              source: 'dashboard-chat',
              client_request_id: clientRequestId,
            },
            ...(attachments?.length ? { attachments } : {}),
          }),
        });
        headersAt = Date.now();
        status = res.status;
        clockOffsetMs = clockOffsetFrom(res.headers?.get?.('date'), postAt, headersAt);
        const data = await res.json().catch(() => null);
        bodyAt = Date.now();
        return { res, data };
      })(),
      sendDeadlineMs,
      () => null,
    );
  } catch (e) {
    const aborted = ctrl.signal.aborted;
    const error = aborted && headersAt === null ? new Error(`Hub ${Math.round(sendHeaderTimeoutMs / 1000)} 秒内没有响应（/api/task）`) : e;
    timing(aborted ? 'timeout' : 'error', error);
    throw error;
  } finally {
    clearTimeout(headerTimer);
  }
  if (!got) {
    ctrl.abort();
    const error = new Error(`Hub ${Math.round(sendDeadlineMs / 1000)} 秒内没有返回完整响应（/api/task）`);
    timing('timeout', error);
    throw error;
  }
  const { res, data } = got;
  if (res.status === 401 || res.status === 403) sendIdentityCache.delete(sendIdentityKey(cfg));
  // CommHub returns this exact 429 only after an identical task was already
  // recorded during its five-minute deduplication window. Retire the local
  // optimistic row instead of accumulating a false “未送达” bubble.
  if (res.status === 429 && data?.error === 'duplicate_send') {
    timing('ok');
    return { ...data, ok: true, deduplicated: true } as SendTaskResponse;
  }
  // Hub #1209 intentionally keeps the existing offline body semantics:
  // HTTP 202 + ok:false + queued:true + alias_offline is an accepted write.
  if (res.status === 202 && data?.queued === true && data?.error === 'alias_offline') {
    timing('ok');
    return { ...data, ok: true } as SendTaskResponse;
  }
  const code = typeof data?.error === 'string' && data.error ? data.error : undefined;
  const failure = !res.ok
    ? new SendTaskError(`HTTP ${res.status} on /api/task${code ? ` (${code})` : ''}`, res.status, code, networkId)
    : !data?.ok ? new SendTaskError(String(data?.error ?? 'send failed'), res.status, code, networkId) : null;
  if (failure) {
    timing('error', failure);
    throw failure;
  }
  timing('ok');
  return data as SendTaskResponse;
};

/** The hub's root/help route is plain text starting with
 *  "CommHub MCP Server vX.Y.Z …" — scrape the version for the Server tab.
 *  Returns undefined if unreachable or the banner isn't present. */
// #338 RFC-026 §9.2.1 — list host_supervisor daemon nodes the caller can
// dispatch create_node to. Hub side landed in commhub-server preview.8
// (PR #341 MCP + PR #343 audit) — earlier hubs return 501/404 and we
// surface the "needs upgrade" state honestly — never a fake empty list
// (an empty daemons array on an unsupported hub is indistinguishable
// from a supported hub that genuinely has no daemons yet; the third
// state must be visible to callers).
export interface HostSupervisorDaemon {
  adopt_capable?: boolean;
  daemon_node_id: string;
  alias: string;
  hostname?: string | null;
  online?: boolean;
  last_seen_at?: string | null;
  runtimes_supported?: string[];
  allowed_secret_keys?: string[];
  host_telemetry?: {
    alert_level?: 'green' | 'yellow' | 'red' | 'gray';
    cpu_cores?: number | null;
    mem_gb?: number | null;
    ip_internal?: string | null;
  };
  // #1545 —— daemon 自报的「我现在能不能建节点」,hub 在 server.ts 的
  // /api/host-supervisors 里原样带出(只在 daemon 真报了时才出现这三格)。
  //
  // 🔴 三态,不是两态:`undefined`(从没报过)**不等于** `false`(报了说不能)。
  //    把没升级的 daemon 渲染成"不能建",会让人去修一台其实好好的机器;
  //    反过来把它渲染成"能建",又是朝"没问题"方向说谎。渲染见
  //    src/daemon-capability.ts,那里三态各有一句不同的话。
  can_create_nodes?: boolean;
  create_nodes_blocked_reason?: string;
  /** 该能力值是在**这份 report 发出前 N 毫秒**测得的。
   *  绝对年龄 = (now - last_seen_at) + 本值 —— daemon 只给时长,
   *  绝对时间由 hub/本地的钟出,它自己的钟偏移污染不到这个数。 */
  create_capability_observed_ms_ago?: number;
  /** 新建节点的默认工作目录根(daemon 所在机器上的绝对路径)。只有 hub 与 daemon 都支持
   *  node_spec.workdir、且调用者是 admin/owner 时才出现;缺席 = 不支持,向导隐藏「工作目录」行。
   *  见 src/create-node-workdir.ts。 */
  default_workdir_root?: string;
  /** #623(hub PR #2429 / 看板 #622)—— daemon 逐 runtime 实测「能不能在这台机器建这种节点」。
   *  只有 daemon 真报了才出现;缺席(旧 daemon / 第一轮自检没跑完)= 按今天的样子、什么都不灰。
   *  怎么画在 src/runtime-readiness.ts。 */
  runtime_readiness?: RuntimeReadinessMap;
}
export type HostSupervisorListResult =
  | { ok: true; count: number; daemons: HostSupervisorDaemon[] }
  | { ok: false; unconfirmed: true; error: string }   // hub < preview.8
  | { ok: false; unconfirmed: false; error: string }; // other failure

export const fetchHostSupervisors = async (cfg: HubConfig): Promise<HostSupervisorListResult> => {
  const qs = cfg.networkId ? `?network_id=${encodeURIComponent(cfg.networkId)}` : '';
  const NEEDS_UPGRADE = '当前 hub 未包含 /api/host-supervisors API，需升级到 commhub-server@0.9.0-preview.8 以上';
  try {
    const res = await withTimeout(signal =>
      appFetch(`${cfg.serverUrl}/api/host-supervisors${qs}`, { headers: headers(cfg), signal }),
    );
    if (res.status === 404 || res.status === 501) {
      return { ok: false, unconfirmed: true, error: NEEDS_UPGRADE };
    }
    if (!res.ok) {
      return { ok: false, unconfirmed: false, error: `HTTP ${res.status}` };
    }
    // ⚠️ Pre-preview.8 hubs serve a plain-text help banner on unknown paths
    // at HTTP 200 instead of 404 (proven via real curl against preview.7).
    // A naive `data?.daemons ?? []` slides those into the onboarding state,
    // silently misreporting "no daemons yet" when the truth is "wrong hub
    // version". Detect by content-type OR by absence of any contract field.
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      return { ok: false, unconfirmed: true, error: NEEDS_UPGRADE };
    }
    const data = (await res.json().catch(() => null)) as
      { ok?: boolean; count?: number; daemons?: HostSupervisorDaemon[]; error?: string } | null;
    if (!data) {
      return { ok: false, unconfirmed: true, error: NEEDS_UPGRADE };
    }
    // Endpoint shape sanity: a real /api/host-supervisors response always
    // carries either `ok` or `daemons` or `count`. Absence of all three
    // means we hit a different handler (older hub catch-all returning
    // JSON help, or a proxy front-page). Never silently fake "no
    // daemons" from a non-conforming response — surface the upgrade
    // hint so the caller can tell "empty for the right reason" apart
    // from "wrong hub answered".
    if (data.ok === undefined && data.daemons === undefined && data.count === undefined) {
      return { ok: false, unconfirmed: true, error: NEEDS_UPGRADE };
    }
    if (data.ok === false) {
      return { ok: false, unconfirmed: false, error: data?.error || 'hub returned ok:false' };
    }
    const daemons = Array.isArray(data?.daemons) ? data.daemons : [];
    const count = typeof data?.count === 'number' ? data.count : daemons.length;
    return { ok: true, count, daemons };
  } catch (e: unknown) {
    return { ok: false, unconfirmed: false, error: e instanceof Error ? e.message : String(e) };
  }
};

// #338 RFC-026 §3.1 — create_node via MCP JSON-RPC. Hub exposes
// create_node only as an MCP tool at POST /mcp (no REST mirror in
// preview.8). We send a single stateless tools/call envelope without
// a prior `initialize` handshake — the hub treats tool calls as session-
// scoped per token but accepts unsequenced calls (matches dashboard's
// callMcp pattern in app/lib/hub-mcp.ts).
//
// Response body comes back as application/json OR text/event-stream; the
// tool payload itself lives at envelope.result.content[0].text as a JSON
// string. A `ok:true` from the tool means "hub accepted the RPC", not
// "the child agent is running" — so callers must poll fetchStatus
// afterwards to confirm the child registered before reporting success
// to the user.
export interface CreateNodeRequest {
  daemon_node_id: string;
  network_id?: string;
  node_spec: {
    name: string;
    runtime: string;
    model?: string;
    flags?: Record<string, unknown>;
    /** 只在 daemon 带 default_workdir_root 时发送(老 daemon 会忽略它,节点落在别处)。 */
    workdir?: string;
  };
}
import type { CreateRequestRow } from './create-request-status';
export type CreateNodeResult =
  | { ok: true; request_id?: string; result?: unknown }
  | { ok: false; unconfirmed?: true; error: string; /** Hub 校验错误带的字段名(如 flag_key_unknown 的 copresence);老 hub/其它错误没有。 */ field?: string };

const NEEDS_UPGRADE_HINT = '当前 hub 不响应 create_node MCP 工具，需升级到 commhub-server@0.9.0-preview.8 以上';

// Discriminated parse result so createNode can distinguish:
//   - business errors (hub returned ok:false OR JSON-RPC error: tool
//     rejected the args, schema invalid, validation failed) → real
//     create_node failure to surface as-is to the user
//   - version / transport errors (no valid envelope at all, SSE
//     unparseable, missing result.content.text) → "needs upgrade hub"
//
// Mapping ANY parse error to "needs upgrade" (the bug 通信龙 caught) is
// misleading: it tells a user with bad inputs that their server is broken.
type ParsedMcp =
  | { kind: 'payload'; payload: unknown }
  | { kind: 'jsonRpcError'; message: string }
  | { kind: 'malformed'; message: string };

function parseMcpToolResponse(rawText: string): ParsedMcp {
  let envelope: unknown;
  try {
    envelope = JSON.parse(rawText);
  } catch {
    // SSE path: find the last `data:` line and parse it.
    const dataLines = rawText
      .split('\n')
      .filter(l => l.startsWith('data:'))
      .map(l => l.slice(5).trim())
      .filter(Boolean);
    const last = dataLines[dataLines.length - 1];
    if (!last) return { kind: 'malformed', message: 'empty MCP response' };
    try {
      envelope = JSON.parse(last);
    } catch {
      return { kind: 'malformed', message: 'MCP response not parseable as JSON or SSE' };
    }
  }
  const env = envelope as {
    error?: { message?: string };
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
  };
  // JSON-RPC envelope-level error = business error from hub
  // (auth_failed, tool_not_found, validation, etc.) — surface it.
  if (env.error) {
    return { kind: 'jsonRpcError', message: env.error.message || 'MCP error' };
  }
  const text = env.result?.content?.[0]?.text;
  if (typeof text !== 'string') {
    // No result.content.text usually means the response shape doesn't
    // match the tool contract — either the tool is missing or the
    // server is on an older protocol. This IS a version concern.
    return { kind: 'malformed', message: 'MCP result missing content.text' };
  }
  // result.isError=true is the MCP convention for tool-level errors
  // delivered in result.content[0].text as plain text (NOT JSON). We
  // saw this with create_node's "MCP error -32602: Input validation
  // error: ..." message when schema fields are missing. Treat as
  // jsonRpcError so createNode surfaces the raw message instead of
  // wrongly mapping the unparseable text body to ok:true.
  if (env.result?.isError === true) {
    return { kind: 'jsonRpcError', message: text };
  }
  // Tool replies typically encode their payload as a JSON string in
  // result.content[0].text. If that fails to parse, the payload is
  // a free-form string the tool wanted to return — treat as ok with
  // text so callers can still surface something.
  try {
    return { kind: 'payload', payload: JSON.parse(text) };
  } catch {
    return { kind: 'payload', payload: { ok: true, text } };
  }
}

export type NodeLifecycleAction = 'start_node' | 'restart_node' | 'stop_node' | 'delete_node';

export type NodeLifecycleRequest = {
  kind: 'adopt' | 'start' | 'stop'; request_id: string; node_id: string;
  status: string; error: string | null;
};
export async function fetchNodeLifecycleRequest(cfg: HubConfig, kind: NodeLifecycleRequest['kind'], requestId: string): Promise<NodeLifecycleRequest | null> {
  if (!cfg.networkId || !requestId) throw new Error('lifecycle_scope_required');
  return withDeadline((async () => {
    const q = new URLSearchParams({ kind, request_id: requestId, network_id: cfg.networkId! });
    const res = await withTimeout(signal => appFetch(`${cfg.serverUrl}/api/node-lifecycle-requests?${q}`, { headers: headers(cfg), signal }));
    if (res.status === 404 || res.status === 501) return null;
    if (!res.ok) throw new Error('lifecycle_read_failed');
    const d = await res.json();
    if (!d?.ok || !d.request || d.request.kind !== kind || d.request.request_id !== requestId) throw new Error('lifecycle_read_failed');
    return d.request;
  })(), 15000, () => { throw new Error('lifecycle_read_failed'); });
}

export async function adoptKnownNode(cfg: HubConfig, nodeId: string, daemonId: string, workdir: string): Promise<NodeLifecycleResult> {
  if (!cfg.networkId || !nodeId || !daemonId || !workdir.trim()) return { ok: false, error: 'invalid_workdir' };
  const r = await callHubTool(cfg, 'request_adopt_node', { node_id: nodeId, daemon_node_id: daemonId, workdir: workdir.trim(), network_id: cfg.networkId });
  if (r.kind !== 'payload') return { ok: false, error: 'lifecycle_error' };
  if (r.payload?.ok !== true) return { ok: false, error: r.payload?.error ?? 'lifecycle_error' };
  return typeof r.payload.request_id === 'string' ? { ok: true, request_id: r.payload.request_id } : { ok: false, error: 'lifecycle_error' };
}

export type NodeLifecycleResult =
  | { ok: true; request_id?: string; update_id?: string; lifecycle_state?: string }
  | { ok: false; error: string; in_flight_count?: number; unsupported?: true };

/** Invoke only the public, audited CommHub lifecycle tools. The desktop app
 * deliberately uses the same MCP contract as anet/dashboard; there is no
 * app-only endpoint to drift from the CLI. */
export const runNodeLifecycleAction = async (
  cfg: HubConfig,
  action: NodeLifecycleAction,
  node: Pick<HubNode, 'node_id' | 'alias'> & Partial<Pick<HubNode, 'lifecycle_daemon_node_id' | 'managed' | 'adoption'>>,
  options: { force?: boolean; deleteConfig?: boolean } = {},
): Promise<NodeLifecycleResult> => {
  if (action === 'restart_node' && (node.managed === 'adopted' || node.adoption?.status === 'active')) return { ok: false, error: 'adopted_restart_requires_daemon' };
  const networkId = cfg.networkId ?? (await fetchNetworkId(cfg));
  // ID-only callers must resolve current authority, not silently skip the guard.
  // A real old-Hub row may still omit both fields: preserve its legacy behavior.
  if (action === 'restart_node' && (node.managed === undefined || node.adoption === undefined)) {
    try {
      if (!networkId) throw new Error('missing network');
      const full = await withDeadline(fetchHubNodes({ ...cfg, networkId }), 15000, () => null);
      const target = full?.nodes?.find(n => n.node_id === node.node_id);
      if (!target) return { ok: false, error: 'lifecycle_identity_unavailable' };
      if (target.managed === 'adopted' || target.adoption?.status === 'active') return { ok: false, error: 'adopted_restart_requires_daemon' };
    } catch { return { ok: false, error: 'lifecycle_identity_unavailable' }; }
  }
  // board #585 —— start_node 由节点所在机器上的 daemon 执行。daemon_node_id 可省(Hub 按创建记录自己找),
  // 带上 /api/nodes 给的那个只是让 Hub 核对;Hub 的 zod 只收 node_[a-z0-9_-]+,不合形状就不带。
  const daemonId = node.lifecycle_daemon_node_id && /^node_[a-z0-9_-]+$/.test(node.lifecycle_daemon_node_id)
    ? node.lifecycle_daemon_node_id : undefined;
  const args = action === 'start_node'
    ? { node_id: node.node_id, ...(daemonId ? { daemon_node_id: daemonId } : {}), ...(networkId ? { network_id: networkId } : {}) }
    : action === 'restart_node'
    ? { node_id: node.node_id, ...(networkId ? { network_id: networkId } : {}) }
    : action === 'stop_node'
      ? { child_node_id: node.node_id, ...(networkId ? { network_id: networkId } : {}), ...(options.force ? { force: true } : {}) }
      : {
          child_node_id: node.node_id,
          confirm_alias: node.alias,
          ...(networkId ? { network_id: networkId } : {}),
          ...(options.force ? { force: true } : {}),
          ...(options.deleteConfig ? { delete_config: true } : {}),
        };
  try {
    const res = await withTimeout(signal => appFetch(`${cfg.serverUrl}/mcp`, {
      method: 'POST',
      headers: {
        ...headers(cfg),
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-03-26',
      },
      signal,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: action, arguments: args } }),
    }));
    if (res.status === 404 || res.status === 501) return { ok: false, unsupported: true, error: '当前 Hub 不支持节点生命周期操作，请先升级 Hub' };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const parsed = parseMcpToolResponse(await res.text());
    if (parsed.kind === 'malformed') return { ok: false, unsupported: true, error: '当前 Hub 未返回兼容的节点生命周期响应' };
    if (parsed.kind === 'jsonRpcError') return { ok: false, error: parsed.message };
    const payload = parsed.payload as NodeLifecycleResult | null;
    if (!payload || payload.ok === false) return payload ?? { ok: false, error: 'Hub 返回空响应' };
    return payload;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

// ── RFC-024 —— 节点模型远程修改（不经 LLM）──────────────────────────────
//
// GET /api/nodes/:id/config 是 dashboard 拥有的读接口(server.ts nodeConfigMatch),
// `config_update_capable` 三态见 node-model-change.ts。update_node_config 走和
// 生命周期操作同一条公开 MCP 契约;改模型 = apply_mode "restart"(节点 exit 75,
// 启动器原地拉起),所以调用方拿到 ok 只表示「已下发」,是否生效要轮询 config。

export interface NodeConfigRead {
  node_id: string;
  alias?: string;
  config_revision: number;
  model: string | null;
  flags?: Record<string, unknown>;
  config_update_capable: boolean;
}

/** null = hub 没有这个接口(404/501/非 JSON);其它失败抛错(调用方按「读失败」处理)。 */
export const fetchNodeConfig = async (cfg: HubConfig, nodeId: string): Promise<NodeConfigRead | null> => {
  const res = await withTimeout(signal =>
    appFetch(`${cfg.serverUrl}/api/nodes/${encodeURIComponent(nodeId)}/config`, { headers: headers(cfg), signal }),
  );
  if (res.status === 404 || res.status === 501) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return null;
  const d = (await res.json().catch(() => null)) as (Partial<NodeConfigRead> & { ok?: boolean }) | null;
  if (!d || d.ok === false || typeof d.config_revision !== 'number') return null;
  return {
    node_id: typeof d.node_id === 'string' ? d.node_id : nodeId,
    alias: typeof d.alias === 'string' ? d.alias : undefined,
    config_revision: d.config_revision,
    model: typeof d.model === 'string' ? d.model : null,
    flags: d.flags && typeof d.flags === 'object' ? d.flags : undefined,
    config_update_capable: d.config_update_capable === true,
  };
};

export interface UpdateNodeConfigRequest {
  nodeId: string;
  baseRevision: number;
  patch: { model?: string; flags?: Record<string, unknown> };
}

export type UpdateNodeConfigResult =
  | { ok: true; update_id?: string; apply_mode?: string }
  | { ok: false; conflict: true; error: string }
  | { ok: false; conflict?: false; unsupported?: true; error: string };

export const updateNodeConfig = async (cfg: HubConfig, req: UpdateNodeConfigRequest): Promise<UpdateNodeConfigResult> => {
  const networkId = cfg.networkId ?? (await fetchNetworkId(cfg));
  const patch: Record<string, unknown> = {};
  if (typeof req.patch.model === 'string') patch.model = req.patch.model;
  if (req.patch.flags && typeof req.patch.flags === 'object') patch.flags = req.patch.flags;
  const args = {
    node_id: req.nodeId,
    base_revision: req.baseRevision,
    patch,
    ...(networkId ? { network_id: networkId } : {}),
  };
  try {
    const res = await withTimeout(signal => appFetch(`${cfg.serverUrl}/mcp`, {
      method: 'POST',
      headers: {
        ...headers(cfg),
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-03-26',
      },
      signal,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'update_node_config', arguments: args } }),
    }));
    if (res.status === 404 || res.status === 501) return { ok: false, unsupported: true, error: '当前 Hub 不支持远程修改节点配置，请先升级 Hub' };
    if (res.status === 409) return { ok: false, conflict: true, error: 'revision conflict' };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const parsed = parseMcpToolResponse(await res.text());
    if (parsed.kind === 'malformed') return { ok: false, unsupported: true, error: '当前 Hub 未返回兼容的节点配置响应' };
    if (parsed.kind === 'jsonRpcError') {
      // hub 侧 base_revision 不匹配走 MCP 错误文本(不是 HTTP 409):按文案识别。
      if (/409|conflict|revision/i.test(parsed.message)) return { ok: false, conflict: true, error: parsed.message };
      return { ok: false, error: parsed.message };
    }
    const payload = parsed.payload as { ok?: boolean; error?: string; update_id?: string; apply_mode?: string } | null;
    if (!payload) return { ok: false, error: 'Hub 返回空响应' };
    if (payload.ok === false) {
      const msg = payload.error || 'update_node_config failed';
      if (/409|conflict|revision/i.test(msg)) return { ok: false, conflict: true, error: msg };
      return { ok: false, error: msg };
    }
    return { ok: true, update_id: payload.update_id, apply_mode: payload.apply_mode };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

// ── app#225 —— 节点规则文件（CLAUDE.md / AGENTS.md）读写 ────────────────
//
// 走的是和生命周期操作同一条公开 MCP 契约（tools/call），hub 侧工具见主仓
// server/src/tools.ts 的 read_node_rules_file / write_node_rules_file /
// get_rules_file_result。🔴 入参只有 node_id（+ network_id）和 content：
// 没有路径、没有文件名 —— 文件名由节点按自己的运行时决定，目录固定是节点
// 工作目录。这里不拼任何路径（#225 验收第 5 条）。

export type RulesFileRequestStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'timeout';

export interface RulesFileResult {
  ok: true;
  request_id: string;
  op: 'read' | 'write';
  status: RulesFileRequestStatus;
  file_name: string | null;
  exists: boolean | null;
  content?: string;
  error: string | null;
  age_ms: number;
  /** hub ≥ #2001:首次终态读取 60 秒后内容被清掉,之后再读只剩这个旗、没有 content。 */
  content_purged?: boolean;
}

export type RulesFileEnqueueResult =
  | { ok: true; request_id: string; op: 'read' | 'write' }
  | { ok: false; error: string; unsupported?: true; existing_request_id?: string };

export type RulesFileOutcome =
  | RulesFileResult
  | { ok: false; error: string; unsupported?: true; transient?: boolean };

const callHubTool = async (cfg: HubConfig, name: string, args: Record<string, unknown>): Promise<
  | { kind: 'payload'; payload: any }
  | { kind: 'unsupported'; error: string }
  | { kind: 'error'; error: string; transient?: boolean }
> => {
  try {
    // 🔴 整个请求(含响应体)一个硬上限:withTimeout 只管到响应头,`res.text()` 卡住时
    // 规则文件/技能/项目文件夹的轮询会永远 await,界面一直转圈(见 deadline.ts)。
    const got = await withDeadline(
      (async () => {
        const res = await withTimeout(signal => appFetch(`${cfg.serverUrl}/mcp`, {
          method: 'POST',
          headers: {
            ...headers(cfg),
            Accept: 'application/json, text/event-stream',
            'MCP-Protocol-Version': '2025-03-26',
          },
          signal,
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
        }));
        return { res, text: res.status === 404 || res.status === 501 || !res.ok ? '' : await res.text() };
      })(),
      HUB_TOOL_DEADLINE_MS,
      () => null,
    );
    if (!got) return { kind: 'error', error: `Hub ${HUB_TOOL_DEADLINE_MS / 1000} 秒内没有返回完整响应`, transient: true };
    const { res } = got;
    if (res.status === 404 || res.status === 501) return { kind: 'unsupported', error: '当前 Hub 不支持节点规则文件，请先升级 Hub' };
    if (!res.ok) return { kind: 'error', error: `HTTP ${res.status}` };
    const parsed = parseMcpToolResponse(got.text);
    if (parsed.kind === 'malformed') return { kind: 'unsupported', error: '当前 Hub 未返回兼容的响应' };
    if (parsed.kind === 'jsonRpcError') {
      // 旧 hub 没有这个工具时 SDK 回 "Tool xxx not found"（-32602）。
      if (/not found|unknown tool/i.test(parsed.message)) return { kind: 'unsupported', error: '当前 Hub 版本还没有规则文件工具，请先升级 Hub（commhub-server 含 app#225）' };
      return { kind: 'error', error: parsed.message };
    }
    return { kind: 'payload', payload: parsed.payload };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const aborted = (error instanceof Error && error.name === 'AbortError') || /abort/i.test(msg);
    return { kind: 'error', error: aborted ? `Hub ${TIMEOUT_MS / 1000} 秒内没有响应` : msg, transient: true };
  }
};

export type OpenCodeCatalogPoll =
  | { ok: true; status: 'pending'; request_id: string }
  | { ok: true; status: 'ready'; request_id: string; snapshot: { providers?: Array<{ id: string; activation?: string }>; models?: Array<{ providerId: string; id: string }> } }
  | { ok: false; error: string; unsupported?: true };

/** Queue a read of the node's OpenCode V2 server catalog. Does not start a server. */
export async function queueOpenCodeCatalog(cfg: HubConfig, node: { nodeId: string; daemonNodeId: string }): Promise<OpenCodeCatalogPoll> {
  const networkId = cfg.networkId ?? (await fetchNetworkId(cfg));
  const r = await callHubTool(cfg, 'read_opencode_catalog', {
    daemon_node_id: node.daemonNodeId,
    node_id: node.nodeId,
    ...(networkId ? { network_id: networkId } : {}),
  });
  if (r.kind === 'unsupported') return { ok: false, unsupported: true, error: '当前 Hub 还不能读取 OpenCode V2 模型列表' };
  if (r.kind === 'error') return { ok: false, error: r.error };
  const p = r.payload;
  if (!p || p.ok !== true || typeof p.request_id !== 'string') return { ok: false, error: String(p?.error ?? 'Hub 返回空响应') };
  return { ok: true, status: 'pending', request_id: p.request_id };
}

export async function pollOpenCodeCatalog(cfg: HubConfig, requestId: string): Promise<OpenCodeCatalogPoll> {
  const networkId = cfg.networkId ?? (await fetchNetworkId(cfg));
  const r = await callHubTool(cfg, 'get_opencode_catalog', {
    request_id: requestId,
    ...(networkId ? { network_id: networkId } : {}),
  });
  if (r.kind === 'unsupported') return { ok: false, unsupported: true, error: '当前 Hub 还不能读取 OpenCode V2 模型列表' };
  if (r.kind === 'error') return { ok: false, error: r.error };
  const p = r.payload;
  if (!p) return { ok: false, error: 'Hub 返回空响应' };
  if (p.ok === true && p.status === 'pending') return { ok: true, status: 'pending', request_id: requestId };
  if (p.ok === true && p.status === 'ready' && p.snapshot) return { ok: true, status: 'ready', request_id: requestId, snapshot: p.snapshot };
  return { ok: false, error: String(p.error ?? 'unavailable') };
}

const enqueueRulesFile = async (
  cfg: HubConfig,
  tool: 'read_node_rules_file' | 'write_node_rules_file',
  node: RulesTarget,
  content?: string,
): Promise<RulesFileEnqueueResult> => {
  const networkId = cfg.networkId ?? (await fetchNetworkId(cfg));
  const args = {
    ...rulesTargetArgs(node),
    ...(networkId ? { network_id: networkId } : {}),
    ...(tool === 'write_node_rules_file' ? { content: content ?? '' } : {}),
  };
  const r = await callHubTool(cfg, tool, args);
  if (r.kind === 'unsupported') return { ok: false, unsupported: true, error: r.error };
  if (r.kind === 'error') return { ok: false, error: r.error };
  const p = r.payload;
  if (!p || p.ok !== true || typeof p.request_id !== 'string') {
    return { ok: false, error: p?.error === 'request_in_flight' ? '节点还有一个规则文件请求没做完，请稍后再试' : String(p?.error ?? 'Hub 返回空响应'), ...(p?.existing_request_id ? { existing_request_id: p.existing_request_id } : {}) };
  }
  return { ok: true, request_id: p.request_id, op: p.op === 'write' ? 'write' : 'read' };
};

/** app#225 follow-up — who a rules-file request goes to: a hub `nodes` row
 *  (node_id), or — for claude-code sessions that have none — just the alias. */
export type RulesTarget = { node_id?: string | null; alias: string; runtime?: string | null };

/** Hub tool args for a target: node_id when the hub has a nodes row; otherwise the
 *  alias (the hub resolves it to a session that reported rules_file_capable).
 *  Never both — a node_id always wins, so an alias can't redirect a known node. */
export const rulesTargetArgs = (t: RulesTarget): { node_id: string } | { alias: string } =>
  t.node_id ? { node_id: t.node_id } : { alias: t.alias };

export const readNodeRulesFile = (cfg: HubConfig, node: RulesTarget): Promise<RulesFileEnqueueResult> =>
  enqueueRulesFile(cfg, 'read_node_rules_file', node);

export const writeNodeRulesFile = (cfg: HubConfig, node: RulesTarget, content: string): Promise<RulesFileEnqueueResult> =>
  enqueueRulesFile(cfg, 'write_node_rules_file', node, content);

/** Node skills view — enqueue list_node_skills / read_node_skill (read-only; the
 *  only argument besides the target is a skill NAME). Result comes back through
 *  getRulesFileResult / waitForRulesFileResult like the rules file. */
const enqueueSkills = async (
  cfg: HubConfig,
  tool: 'list_node_skills' | 'read_node_skill',
  node: RulesTarget,
  name?: string,
): Promise<RulesFileEnqueueResult> => {
  const networkId = cfg.networkId ?? (await fetchNetworkId(cfg));
  const args = {
    ...rulesTargetArgs(node),
    ...(networkId ? { network_id: networkId } : {}),
    ...(tool === 'read_node_skill' ? { name: name ?? '' } : {}),
  };
  const r = await callHubTool(cfg, tool, args);
  if (r.kind === 'unsupported') return { ok: false, unsupported: true, error: '当前 Hub 版本还没有技能查看工具,请先升级 Hub' };
  if (r.kind === 'error') return { ok: false, error: /not found|unknown tool/i.test(r.error) ? '当前 Hub 版本还没有技能查看工具,请先升级 Hub' : r.error };
  const p = r.payload;
  if (!p || p.ok !== true || typeof p.request_id !== 'string') {
    return { ok: false, error: p?.error === 'request_in_flight' ? '节点还有一个技能请求没做完,请稍后再试' : String(p?.error ?? 'Hub 返回空响应'), ...(p?.existing_request_id ? { existing_request_id: p.existing_request_id } : {}) };
  }
  return { ok: true, request_id: p.request_id, op: 'read' };
};

/** 读一个 JSON 响应；200 但内容不是 JSON 时不把解析错误抛给用户。
 *
 *  背景（真实现场）：老 Hub 没有 /api/skills 时会把**首页 HTML 以 200** 返回
 *  （0.9.0-preview.137 实测），客户端 `res.json()` 直接抛
 *  "The string did not match the expected pattern."，用户看到的就是这句。
 *  这不是「解析失败」，是「这个 Hub 没有这个接口」——两者要修的机器不同。 */
const readJsonOrNull = async (res: Response): Promise<any | null> => {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
};

// ── Hub 级技能目录（#1473 / #909）───────────────────────────────────────
//
// 服务端 GET /api/skills 与 MCP list_skills 同源，只回元数据、**不回 SKILL.md
// 正文**；pending 仅 owner/admin 可见（服务端已把关，客户端不再自己判断）。
// 三态必须分清：不支持(404/501) ≠ 没权限(403) ≠ 真的空目录。
export type HubSkillRow = {
  skill_id: string;
  slug: string;
  name: string;
  description: string;
  version: string;
  status: 'published' | 'pending' | 'rejected' | string;
  source_type?: string | null;
  source_alias?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
};
export type HubSkillsResult =
  | { ok: true; reviewer: boolean; skills: HubSkillRow[] }
  | { ok: false; error: string; unsupported?: boolean; forbidden?: boolean };

// ── 节点密钥的排队/轮询（#1491 E2）──────────────────────────────────────
//
// Hub 的节点密钥是一条「排队 + 节点 ack」的 lane：POST 入队，GET 轮询。
// 值只在 POST 请求体里出现一次；响应里只有 key 名与 revision。
export type NodeSecretSnapshot = {
  network_id?: string;
  node_id?: string;
  revision: number;
  activation?: string;
  keys: Array<{ key: string; source?: string }>;
};
export type NodeSecretOpResult =
  | { ok: true; request_id: string; expires_at?: number }
  | { ok: false; error: string; message?: string };

export type NodeSecretPollResult =
  | { ok: true; status: 'pending' | 'succeeded' | 'failed'; snapshot?: NodeSecretSnapshot; error?: string }
  | { ok: false; error: string };

export const requestNodeSecretOp = async (
  cfg: HubConfig,
  nodeId: string,
  body: { action: 'list' | 'put' | 'delete'; key?: string; value?: string; revision?: number },
): Promise<NodeSecretOpResult> => {
  const qs = cfg.networkId ? `?network_id=${encodeURIComponent(cfg.networkId)}` : '';
  try {
    const res = await withTimeout(signal =>
      appFetch(`${cfg.serverUrl}/api/nodes/${encodeURIComponent(nodeId)}/secrets${qs}`, {
        method: 'POST',
        headers: { ...headers(cfg), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      }),
    );
    const data = await res.json().catch(() => null) as any;
    if (res.status === 404 || res.status === 501) {
      return { ok: false, error: '当前 Hub 版本还没有节点密钥接口，请先升级 Hub' };
    }
    if (!res.ok || !data || data.ok !== true) {
      return { ok: false, error: String(data?.error ?? `HTTP ${res.status}`), message: data?.message };
    }
    return { ok: true, request_id: String(data.request_id), expires_at: data.expires_at };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
};

export const pollNodeSecretOp = async (cfg: HubConfig, nodeId: string, requestId: string): Promise<NodeSecretPollResult> => {
  const qs = cfg.networkId ? `?network_id=${encodeURIComponent(cfg.networkId)}` : '';
  try {
    const res = await withTimeout(signal =>
      appFetch(`${cfg.serverUrl}/api/nodes/${encodeURIComponent(nodeId)}/secrets/${encodeURIComponent(requestId)}${qs}`, {
        headers: headers(cfg), signal,
      }),
    );
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json() as any;
    if (!data || data.ok !== true) return { ok: false, error: String(data?.error ?? 'Hub 返回空响应') };
    return { ok: true, status: data.status, snapshot: data.snapshot, error: data.error };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
};

// ── Hub 级环境密钥「名字」（#1479 / #909）──────────────────────────────
//
// 服务端 GET /api/secrets 只回 `{key, updated_at}`；ciphertext/iv/tag 三列根本
// 没有进 SELECT。客户端这边再守一道：只渲染看起来像 key 名的字符串。
export type HubSecretKey = { key: string; updated_at: number | string | null };
export type HubSecretsResult =
  | { ok: true; keys: HubSecretKey[] }
  | { ok: false; error: string; unsupported?: boolean; forbidden?: boolean };

export const fetchHubSecrets = async (cfg: HubConfig): Promise<HubSecretsResult> => {
  const qs = cfg.networkId ? `?network_id=${encodeURIComponent(cfg.networkId)}` : '';
  try {
    const res = await withTimeout(signal =>
      appFetch(`${cfg.serverUrl}/api/secrets${qs}`, { headers: headers(cfg), signal }),
    );
    if (res.status === 404 || res.status === 501) {
      return { ok: false, unsupported: true, error: '当前 Hub 版本还没有密钥目录接口，请先升级 Hub' };
    }
    if (res.status === 403) return { ok: false, forbidden: true, error: '没有权限查看这个网络的密钥' };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = await readJsonOrNull(res);
    if (!body) return { ok: false, unsupported: true, error: '当前 Hub 版本还没有密钥目录接口，请先升级 Hub' };
    if (body.ok !== true || !Array.isArray(body.keys)) return { ok: false, error: 'Hub 返回空响应' };
    return { ok: true, keys: body.keys as HubSecretKey[] };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
};

export const fetchHubSkills = async (
  cfg: HubConfig,
  opts?: { includePending?: boolean; limit?: number },
): Promise<HubSkillsResult> => {
  const qs = new URLSearchParams();
  if (cfg.networkId) qs.set('network_id', cfg.networkId);
  if (opts?.includePending) qs.set('include_pending', '1');
  if (opts?.limit) qs.set('limit', String(opts.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  try {
    const res = await withTimeout(signal =>
      appFetch(`${cfg.serverUrl}/api/skills${suffix}`, { headers: headers(cfg), signal }),
    );
    if (res.status === 404 || res.status === 501) {
      return { ok: false, unsupported: true, error: '当前 Hub 版本还没有技能目录接口，请先升级 Hub' };
    }
    if (res.status === 403) return { ok: false, forbidden: true, error: '没有权限查看这个网络的技能目录' };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = await readJsonOrNull(res);
    if (!body) return { ok: false, unsupported: true, error: '当前 Hub 版本还没有技能目录接口，请先升级 Hub' };
    if (body.ok !== true || !Array.isArray(body.skills)) return { ok: false, error: 'Hub 返回空响应' };
    return { ok: true, reviewer: body.reviewer === true, skills: body.skills as HubSkillRow[] };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
};

export const listNodeSkills = (cfg: HubConfig, node: RulesTarget): Promise<RulesFileEnqueueResult> =>
  enqueueSkills(cfg, 'list_node_skills', node);

export const readNodeSkill = (cfg: HubConfig, node: RulesTarget, name: string): Promise<RulesFileEnqueueResult> =>
  enqueueSkills(cfg, 'read_node_skill', node, name);

/** Project folder view — enqueue list_node_files / read_node_file (read-only). The
 *  only argument besides the target is a path RELATIVE to the node's work dir;
 *  hub and node both refuse absolute paths and `..`. Results come back through
 *  getRulesFileResult / waitForRulesFileResult like the rules file. */
const FILES_TOOL_MISSING = '当前 Hub 版本还没有项目文件夹工具,请先升级 Hub';
const enqueueFiles = async (
  cfg: HubConfig,
  tool: 'list_node_files' | 'read_node_file',
  node: RulesTarget,
  relPath: string,
): Promise<RulesFileEnqueueResult> => {
  const networkId = cfg.networkId ?? (await fetchNetworkId(cfg));
  const args = {
    ...rulesTargetArgs(node),
    ...(networkId ? { network_id: networkId } : {}),
    path: relPath,
  };
  const r = await callHubTool(cfg, tool, args);
  if (r.kind === 'unsupported') return { ok: false, unsupported: true, error: FILES_TOOL_MISSING };
  if (r.kind === 'error') return { ok: false, error: /not found|unknown tool/i.test(r.error) ? FILES_TOOL_MISSING : r.error };
  const p = r.payload;
  if (!p || p.ok !== true || typeof p.request_id !== 'string') {
    return { ok: false, error: p?.error === 'request_in_flight' ? '节点还有一个项目文件夹请求没做完,请稍后再试' : String(p?.error ?? 'Hub 返回空响应'), ...(p?.existing_request_id ? { existing_request_id: p.existing_request_id } : {}) };
  }
  return { ok: true, request_id: p.request_id, op: 'read' };
};

export const listNodeFiles = (cfg: HubConfig, node: RulesTarget, relPath: string): Promise<RulesFileEnqueueResult> =>
  enqueueFiles(cfg, 'list_node_files', node, relPath);

export const readNodeFile = (cfg: HubConfig, node: RulesTarget, relPath: string): Promise<RulesFileEnqueueResult> =>
  enqueueFiles(cfg, 'read_node_file', node, relPath);

/** Node run-log view — enqueue tail_node_logs (read-only, no path; the node reads
 *  and redacts its own log). The hub hands the result to this login once, then
 *  purges it. Results come back through getRulesFileResult / waitForRulesFileResult. */
const LOGS_TOOL_MISSING = 'Hub 版本过旧，升级后可查看日志';
export const tailNodeLogs = async (
  cfg: HubConfig,
  node: RulesTarget,
  query: { lines: number; level?: 'info' | 'warn' | 'error'; grep?: string; since_ts?: number },
): Promise<RulesFileEnqueueResult & { code?: string }> => {
  const networkId = cfg.networkId ?? (await fetchNetworkId(cfg));
  const r = await callHubTool(cfg, 'tail_node_logs', { ...rulesTargetArgs(node), ...(networkId ? { network_id: networkId } : {}), ...query });
  if (r.kind === 'unsupported') return { ok: false, unsupported: true, error: LOGS_TOOL_MISSING };
  if (r.kind === 'error') return /not found|unknown tool/i.test(r.error) ? { ok: false, unsupported: true, error: LOGS_TOOL_MISSING } : { ok: false, error: r.error };
  const p = r.payload;
  if (!p || p.ok !== true || typeof p.request_id !== 'string') {
    return { ok: false, error: String(p?.error ?? 'Hub 返回空响应'), code: typeof p?.error === 'string' ? p.error : undefined, ...(p?.existing_request_id ? { existing_request_id: p.existing_request_id } : {}) };
  }
  return { ok: true, request_id: p.request_id, op: 'read' };
};

export const getRulesFileResult = async (cfg: HubConfig, requestId: string): Promise<RulesFileOutcome> => {
  const networkId = cfg.networkId ?? (await fetchNetworkId(cfg));
  const r = await callHubTool(cfg, 'get_rules_file_result', { request_id: requestId, ...(networkId ? { network_id: networkId } : {}) });
  if (r.kind === 'unsupported') return { ok: false, unsupported: true, error: r.error };
  if (r.kind === 'error') return { ok: false, error: r.error, ...(r.transient ? { transient: true } : {}) };
  const p = r.payload;
  if (!p || p.ok !== true) return { ok: false, error: String(p?.error ?? 'Hub 返回空响应') };
  return p as RulesFileResult;
};

/** 轮询到终态（done / failed / timeout / 认不出的状态）或本地上限；`isCancelled` 让组件卸载时停下。
 *  循环本体在 node-rules.ts 的 pollUntilTerminal(纯函数,有单测);这里只接上真实的 hub 调用。 */
export const waitForRulesFileResult = async (
  cfg: HubConfig,
  requestId: string,
  options: { nextDelayMs: (elapsedMs: number) => number; isTerminal: (s: string) => boolean; isCancelled?: () => boolean; maxWaitMs?: number } ,
): Promise<RulesFileOutcome> =>
  pollUntilTerminal<RulesFileOutcome>(() => getRulesFileResult(cfg, requestId), {
    ...options,
    callDeadlineMs: HUB_TOOL_DEADLINE_MS + 3_000,
  });

/** 读一条 create_node 请求的结果(daemon 回的 status/error)。老 hub 没有这个接口 → 404 → null(向导退回只等注册)。 */
export const fetchCreateRequestStatus = async (cfg: HubConfig, requestId: string): Promise<CreateRequestRow | null> => {
  const q = new URLSearchParams({ request_id: requestId });
  if (cfg.networkId) q.set('network_id', cfg.networkId);
  const res = await withTimeout(signal => appFetch(`${cfg.serverUrl}/api/node-create-requests?${q}`, { headers: headers(cfg), signal }));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  return d?.ok && d.request && typeof d.request === 'object' ? d.request as CreateRequestRow : null;
};

export const createNode = async (cfg: HubConfig, req: CreateNodeRequest): Promise<CreateNodeResult> => {
  const networkId = req.network_id ?? cfg.networkId ?? (await fetchNetworkId(cfg));
  try {
    const args = {
      daemon_node_id: req.daemon_node_id,
      ...(networkId ? { network_id: networkId } : {}),
      node_spec: req.node_spec,
    };
    const envelope = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'create_node', arguments: args },
    };
    const res = await withTimeout(signal =>
      appFetch(`${cfg.serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          ...headers(cfg),
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-03-26',
        },
        signal,
        body: JSON.stringify(envelope),
      }),
    );
    if (res.status === 404 || res.status === 501) {
      return { ok: false, unconfirmed: true, error: NEEDS_UPGRADE_HINT };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      try {
        const j = JSON.parse(text) as { error?: string | { message?: string } };
        const err = typeof j?.error === 'string' ? j.error : j?.error?.message;
        return { ok: false, error: err || `HTTP ${res.status}` };
      } catch {
        return { ok: false, error: `HTTP ${res.status}` };
      }
    }
    const raw = await res.text();
    const parsed = parseMcpToolResponse(raw);
    if (parsed.kind === 'malformed') {
      // No valid JSON-RPC envelope OR missing result.content.text — this
      // is the real "wrong hub version" case.
      return { ok: false, unconfirmed: true, error: NEEDS_UPGRADE_HINT };
    }
    if (parsed.kind === 'jsonRpcError') {
      // Hub answered with a JSON-RPC error envelope. This is a business
      // error (validation rejected, tool not allowed, etc.) — surface it
      // raw rather than misclassifying as a version mismatch.
      return { ok: false, error: parsed.message };
    }
    // payload kind
    const payload = parsed.payload as { ok?: boolean; error?: string; field?: unknown; request_id?: string; result?: unknown } | null;
    if (!payload) return { ok: false, error: 'empty hub response' };
    if (payload.ok === false) {
      // Tool returned ok:false in its content payload — also business.
      return { ok: false, error: payload.error || 'create_node failed', ...(typeof payload.field === 'string' ? { field: payload.field } : {}) };
    }
    return { ok: true, request_id: payload.request_id, result: payload.result ?? payload };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

/** Hub MCP `clone_node` (agent-network 5f8961c8). ok:true inserts a pending row; the child is not registered yet. A missing tool is the only demo path. */
export async function cloneNode(cfg: HubConfig, req: CloneNodeArgs): Promise<ReturnType<typeof interpretCloneReply>> {
  const preview: CloneNodeArgs = {
    daemon_node_id: req.daemon_node_id,
    source_node_id: req.source_node_id,
    name: req.name,
    copy_session: req.copy_session,
    workdir_policy: req.workdir_policy,
  };
  try {
    const networkId = req.network_id ?? cfg.networkId ?? (await fetchNetworkId(cfg));
    if (networkId) preview.network_id = networkId;
    const res = await withTimeout(signal =>
      appFetch(`${cfg.serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          ...headers(cfg),
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-03-26',
        },
        signal,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'clone_node', arguments: preview },
        }),
      }),
    );
    if (res.status === 404 || res.status === 501) return interpretCloneReply({ kind: 'unsupported' }, preview);
    const raw = await res.text();
    if (!res.ok) {
      try {
        const j = JSON.parse(raw) as { error?: string | { message?: string } };
        const err = typeof j?.error === 'string' ? j.error : j?.error?.message;
        const message = err || `HTTP ${res.status}`;
        return interpretCloneReply(isCloneToolMissing(message) ? { kind: 'unsupported' } : { kind: 'error', error: message }, preview);
      } catch {
        return interpretCloneReply({ kind: 'error', error: `HTTP ${res.status}` }, preview);
      }
    }
    const parsed = parseMcpToolResponse(raw);
    if (parsed.kind === 'malformed') return interpretCloneReply({ kind: 'error', error: 'clone_node response was not a tool result' }, preview);
    if (parsed.kind === 'jsonRpcError') {
      return interpretCloneReply(isCloneToolMissing(parsed.message) ? { kind: 'unsupported' } : { kind: 'error', error: parsed.message }, preview);
    }
    return interpretCloneReply({ kind: 'payload', payload: parsed.payload }, preview);
  } catch (e: unknown) {
    return interpretCloneReply({ kind: 'error', error: e instanceof Error ? e.message : String(e) }, preview);
  }
}

export const fetchServerVersion = async (cfg: HubConfig): Promise<string | undefined> => {
  try {
    const res = await withTimeout(signal =>
      appFetch(`${cfg.serverUrl}/api/version`, { headers: headers(cfg), signal }),
    );
    const text = await res.text();
    const m = text.match(/CommHub MCP Server v([^\s]+)/i);
    return m?.[1];
  } catch {
    return undefined;
  }
};

/** Username/password login → token (Vincent tg 679: 不需要填 TOKEN).
 *  POST /api/auth/login {username,password} → {ok, token, error?}. */
export const login = async (
  serverUrl: string,
  username: string,
  password: string,
  /** 这台设备在 hub「登录设备」里的名字(login-sessions.ts clientLabelForLogin);旧 hub 忽略。 */
  clientLabel?: string,
): Promise<{ ok: true; cfg: HubConfig; mustChangePassword: boolean } | { ok: false; error: string; kind: LoginFailureKind }> => {
  try {
    const res = await withTimeout(signal =>
      appFetch(`${serverUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ username, password, ...(clientLabel ? { client_label: clientLabel } : {}) }),
      }),
    );
    // Vincent hit this against a half-open port: connection succeeds but
    // the body is empty, and res.json() throws a cryptic JSON parse
    // error. Read text first so we can say what actually went wrong.
    const text = await res.text();
    if (!text.trim()) {
      // review-fix(通信龙 #34):响应形状不对=不是 hub → server-error,与 HTTP 状态码无关
      // (401+空体的常见真身是 basic-auth nginx——判 bad-credentials 会诱导用户反复重打密码)。
      return { ok: false, kind: 'server-error', error: 'Hub 无响应内容 — 检查地址和端口（Hub 默认 9999）' };
    }
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      // 同上:非 JSON 体(HTML 401 页等)= 不是 hub → server-error(kind 必须与本行文案同向)。
      return { ok: false, kind: 'server-error', error: `Hub 返回了非 JSON 内容（HTTP ${res.status}）— 确认地址指向 Hub` };
    }
    if (!data?.ok) return { ok: false, kind: classifyLoginFailure(false, res.status), error: String(data?.error ?? `HTTP ${res.status}`) };
    const token = data.token ?? data.user_token ?? data.access_token;
    if (!token) return { ok: false, kind: 'server-error', error: 'login ok but no token in response' };
    const networkId = await fetchNetworkId({ serverUrl, token });
    // #653:hub ≥ 0.9.0-preview.108 对弱密码登录回 must_change_password: true(只在为真时带这个字段)。
    return { ok: true, cfg: { serverUrl, token, networkId, username }, mustChangePassword: data.must_change_password === true };
  } catch (e) {
    // fetch 抛了 = 压根没拿到 HTTP 响应(连接拒绝/DNS/超时)→ unreachable。
    return { ok: false, kind: classifyLoginFailure(true, null), error: e instanceof Error ? e.message : 'network error' };
  }
};
