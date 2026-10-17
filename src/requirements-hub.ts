// 需求池走 Hub。手机和电脑读同一份。Hub 还没有这个接口时不要退回本机列表。
import { ACCEPT_COLUMNS_HEADERS } from './requirement-columns';
import { editFieldsFromHub, readOnlyFromHub } from './task-access';
import { appFetch } from './app-fetch';
import { clearConditionalReads, conditionalHeaders, readConditionalText } from './conditional-get';
import { fetchAuthMe } from './user-admin-api';
import { issuesFromHub } from './requirement-issues';
import { lastEventFromHub } from './requirement-last-event';
import { normalizeTags } from './requirement-tags';
import { seqFromHub } from './task-short-id';
import type { HubConfig } from './api';
import { parseJsonOrFriendly } from './api';
import { readEpoch, readStatusCountsAsFailure, reportReadFailure, reportReadSuccess } from './connectivity';
import { withDeadline } from './deadline';
import { assignmentsFromHub } from './requirement-people-api';
import type { RequirementPersonRef } from './requirement-people';
import { patchApplied, statusPatch, type EditPatch } from './task-board-model';
import {
  dueOk,
  REQ_COLUMNS,
  REQ_PRIORITIES,
  type ReqColumn,
  type ChecklistItem,
  type RequirementProject,
  type ReqPriority,
  type Requirement,
} from './requirements-model';

export class RequirementsHubError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function requirementFromHub(row: unknown): Requirement | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || !r.name.trim()) return null;
  const due = typeof r.due === 'string' && dueOk(r.due.trim()) ? r.due.trim() : '';
  const priority = REQ_PRIORITIES.includes(r.priority as ReqPriority) ? r.priority as ReqPriority : 'normal';
  const column = REQ_COLUMNS.includes(r.column as ReqColumn) ? r.column as ReqColumn : 'pool';
  return {
    ...(('updatedAt' in r || 'updated_at' in r) ? { updatedAt: typeof (r.updatedAt ?? r.updated_at) === 'string' ? String(r.updatedAt ?? r.updated_at) : null } : {}),
    ...('updated_by' in r ? { updatedBy: updateActor(r.updated_by) } : {}),
    // 最新一条动态(#506,Hub capability last_event):没有这个字段的旧 Hub 不出现,卡片照旧按 updatedAt 显示。
    ...('last_event' in r ? { lastEvent: lastEventFromHub(r.last_event) } : {}),
    ...('issues' in r ? { issues: issuesFromHub(r.issues) } : {}),
    ...('tags' in r ? { tags: normalizeTags(r.tags) ?? [] } : {}),
    ...(('owner' in r || 'participants' in r) ? assignmentsFromHub(r) : {}),
    ...('agent_owner' in r ? { agentOwner: agentOwnerFromHub(r.agent_owner) } : {}),
    ...(typeof r.description === 'string' ? { description: r.description } : {}),
    // 开始(Hub 的 start_date 能力):读不懂的值当没设,不让一张卡因为它整张丢掉。
    ...('start' in r ? { start: typeof r.start === 'string' && dueOk(r.start.trim()) ? r.start.trim() : '' } : {}),
    ...(Array.isArray(r.checklist) ? { checklist: checklistFromHub(r.checklist) } : {}),
    // 精简列表(view=summary):没有正文,只有「有没有描述」和子任务计数。
    ...(!Array.isArray(r.checklist) && r.checklist_count && typeof r.checklist_count === 'object' ? { summary: true as const, hasDescription: r.has_description === true, checklistCount: childCounts(r.checklist_count) } : {}),
    ...('project_id' in r ? { projectId: typeof r.project_id === 'string' && r.project_id ? r.project_id : null } : {}),
    ...('parent_id' in r ? { parentId: typeof r.parent_id === 'string' && r.parent_id ? r.parent_id : null } : {}),
    ...(r.children && typeof r.children === 'object' ? { children: childCounts(r.children) } : {}),
    ...('external_ref' in r ? { externalRef: typeof r.external_ref === 'string' && r.external_ref ? r.external_ref : null } : {}),
    // 只收 http(s):界面会把它做成可点的链接。
    ...('external_url' in r ? { externalUrl: typeof r.external_url === 'string' && /^https?:\/\//i.test(r.external_url) ? r.external_url : null } : {}),
    ...('seq' in r ? { seq: seqFromHub(r.seq) } : {}),
    // 只读(RFC-038 §9):只有 hub 显式说不能改才锁;没有这个字段(旧 Hub、全部任务的人)照旧能改。
    ...(readOnlyFromHub(r) ? { readOnly: true } : {}),
    // 只读但参与这张卡:hub 放开状态和检查项(viewer_can.edit_fields,agent-network#2201)。旧 Hub 没有 → 不出现。
    ...(editFieldsFromHub(r).length ? { editFields: editFieldsFromHub(r) } : {}),
    // 完成时间(capability completed_at):旧 Hub 没有这三个字段,仪表盘退回按 updatedAt 近似。
    ...('completedAt' in r ? { completedAt: typeof r.completedAt === 'string' && r.completedAt ? r.completedAt : null, completedAtApprox: r.completedAtApprox === true, completedBy: updateActor(r.completedBy) } : {}),
    id: r.id,
    name: r.name.trim().slice(0, 80),
    priority,
    assignee: typeof r.assignee === 'string' ? r.assignee.trim().slice(0, 80) : '',
    due,
    column,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
  };
}

function updateActor(value: unknown): RequirementPersonRef | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  return (v.kind === 'user' || v.kind === 'node') && typeof v.id === 'string' && !!v.id ? { kind: v.kind, id: v.id } : null;
}

/** 负责 Agent:只认 {kind:'node', id}。读不懂的值当成未分配,不让一张卡因为它整张丢掉。 */
function agentOwnerFromHub(value: unknown): RequirementPersonRef | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  return v.kind === 'node' && typeof v.id === 'string' && v.id ? { kind: 'node', id: v.id } : null;
}

function childCounts(value: unknown): { total: number; done: number } {
  const v = value as Record<string, unknown>;
  const total = typeof v.total === 'number' && v.total >= 0 ? Math.floor(v.total) : 0;
  const done = typeof v.done === 'number' && v.done >= 0 ? Math.min(Math.floor(v.done), total) : 0;
  return { total, done };
}

/** 子任务:坏的项丢掉,不让一张卡因为它整张丢掉。 */
function checklistFromHub(rows: unknown[]): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const v = row as Record<string, unknown>;
    if (typeof v.id !== 'string' || !v.id || typeof v.text !== 'string') continue;
    out.push({ id: v.id, text: v.text, done: v.done === true });
  }
  return out;
}

/** 需求池每个请求(含响应体)的硬上限。原来没有任何超时:手机链路上一个卡住的连接会让任务页
 *  首次加载永远停在转圈(2026-09-29 Vincent 折叠屏截图),而 refresh 只在 ready 时才跑,没有东西能把它救回来。 */
export const REQUIREMENTS_DEADLINE_MS = 20_000;
export const REQUIREMENTS_TIMEOUT_TEXT = `Hub ${REQUIREMENTS_DEADLINE_MS / 1000} 秒内没有响应`;
let deadlineMs = REQUIREMENTS_DEADLINE_MS;
/** Test-only: shorten the deadline so a hanging-request test doesn't wait 20 s. */
export function __setRequirementsDeadlineForTest(ms: number = REQUIREMENTS_DEADLINE_MS): void { deadlineMs = ms; }

/**
 * 条件 GET(hub ≥ .75 的 GET /api/requirements 带 ETag):与 api.ts 的轮询读共用 conditional-get.ts ——
 * 按「账号 + hub + 令牌 + 路径」记原文,下次带 If-None-Match,304 用上次的;旧 hub 不发 ETag 就什么都不记。
 * 任务页每 15 s 轮询整张表(生产 500 行 gzip 163 KB),绝大多数轮询里表没变 —— 304 只剩一个往返。
 */
/** Test-only. */
export function __resetRequirementsConditionalCache(): void { clearConditionalReads(); }

async function call(cfg: HubConfig, path: string, init?: RequestInit): Promise<unknown> {
  // 读(GET)和 api.ts 的轮询读一样上报连接横幅:任务页上轮询的主要就是这一路,不报的话横幅只能靠
  // 30 秒一次的头像轮询判断连没连上,「截至」时刻也会比屏上看板的实际数据更旧。写有自己的失败提示。
  const isRead = !init?.method || init.method === 'GET';
  const started = Date.now();
  const epoch = readEpoch();
  const ctrl = new AbortController();
  let status = 0;
  let bytes: number | undefined;
  try {
    const got = await withDeadline(
      (async () => {
        const res = await appFetch(`${cfg.serverUrl}${path}`, {
          ...init,
          headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', ...ACCEPT_COLUMNS_HEADERS, ...(isRead ? conditionalHeaders(cfg, path) : {}) },
          signal: ctrl.signal,
        });
        status = res.status;
        const len = Number(res.headers?.get?.('content-length') ?? NaN);
        bytes = Number.isFinite(len) && len >= 0 ? len : undefined;
        if (isRead && res.status === 304) {
          const text = await readConditionalText(cfg, path, res);
          if (text === null) throw new RequirementsHubError('HTTP 304', 304);
          status = 200;
          return { body: parseJsonOrFriendly<unknown>(text, 200, res.headers?.get?.('content-type') ?? null) };
        }
        if (res.status === 404) throw new RequirementsHubError('这个 Hub 还没有需求池', 404);
        if (!res.ok) throw new RequirementsHubError(`HTTP ${res.status}`, res.status);
        if (!isRead) return { body: await res.json() as unknown };
        return { body: parseJsonOrFriendly<unknown>((await readConditionalText(cfg, path, res))!, res.status, res.headers?.get?.('content-type') ?? null) };
      })(),
      deadlineMs,
      () => null,
    );
    if (!got) {
      ctrl.abort();
      throw new RequirementsHubError(REQUIREMENTS_TIMEOUT_TEXT, 0);
    }
    if (isRead) reportReadSuccess(Date.now(), Date.now() - started, { path, bytes, epoch });
    return got.body;
  } catch (e) {
    if (isRead && (status === 0 || status === 200 || readStatusCountsAsFailure(status))) reportReadFailure();
    throw e;
  }
}

function scoped(cfg: HubConfig, path: string): string {
  if (!cfg.networkId) return path;
  const join = path.includes('?') ? '&' : '?';
  return `${path}${join}network_id=${encodeURIComponent(cfg.networkId)}`;
}

export async function listRequirements(cfg: HubConfig): Promise<Requirement[]> {
  return (await listRequirementsFull(cfg)).rows;
}

/** Hub 的列表一次最多给这么多张(最新的在前);更老的要靠服务端搜索(capability search)才找得到。 */
export const HUB_LIST_CAP = 500;

/**
 * 读回来的是不是整张表:新 Hub(capability paging)直接告诉 has_more;旧 Hub 没有这个字段,
 * 正好 500 张就当可能被截断(它的 SQL 是 LIMIT 500)。
 */
export function listTruncated(data: { has_more?: unknown }, rowCount: number): boolean {
  if (typeof data.has_more === 'boolean') return data.has_more;
  return rowCount >= HUB_LIST_CAP;
}

/**
 * 列表 / 增量响应里的 capabilities。
 * 字段在(哪怕是空数组)= known,调用方用这一份覆盖上次的 —— Hub 降级后不再带 column_abandoned,
 * 空列表必须写回去,否则界面还拿「废弃」去 PATCH,旧 Hub 回 400 invalid_column。
 * 字段不在 = known false,增量读不要拿空数组把上次的能力清掉。
 */
export function capabilitiesFromPayload(data: { capabilities?: unknown }): { capabilities: string[]; known: boolean } {
  if (!Array.isArray(data.capabilities)) return { capabilities: [], known: false };
  return { capabilities: data.capabilities.filter((c): c is string => typeof c === 'string'), known: true };
}

/**
 * 连同 Hub 的 capabilities(#2076 起:agent_owner / description / checklist / projects / due_datetime;旧 Hub = [])。
 * summary = 读精简列表(capability list_summary):每行不带描述正文和子任务条目,打开卡时再按 id 读全文。
 * 只在上一次读到的 capabilities 里有 list_summary 时才传 —— 旧 Hub 不认识 view,会照旧回完整列表,也不会错。
 */
export async function listRequirementsFull(cfg: HubConfig, opts: { summary?: boolean } = {}): Promise<{ rows: Requirement[]; capabilities: string[]; truncated: boolean }> {
  const data = await call(cfg, scoped(cfg, opts.summary ? '/api/requirements?view=summary' : '/api/requirements')) as { requirements?: unknown; capabilities?: unknown; has_more?: unknown };
  const rows = Array.isArray(data.requirements) ? data.requirements : [];
  // 整表读:没带 capabilities 字段的旧 Hub 当成空(没有 column_abandoned)。
  const capabilities = capabilitiesFromPayload(data).capabilities;
  return { rows: rows.map(requirementFromHub).filter((row): row is Requirement => !!row), capabilities, truncated: listTruncated(data, rows.length) };
}

/**
 * 增量读(Hub capability changes):since 之后改过的卡(含归档的,行上 archived: true)+ 删掉的卡的 id + 下次用的 server_time。
 * 精简行(view=summary)。has_more = 这段时间改动太多一页装不下 —— 调用方改为整读一次。
 */
export async function listRequirementChanges(cfg: HubConfig, since: string): Promise<{ rows: Requirement[]; deleted: string[]; serverTime: string | null; hasMore: boolean; capabilities: string[]; capabilitiesKnown: boolean }> {
  const data = await call(cfg, scoped(cfg, `/api/requirements?changes=1&view=summary&limit=${HUB_LIST_CAP}&updated_since=${encodeURIComponent(since)}`)) as {
    requirements?: unknown; deleted?: unknown; server_time?: unknown; has_more?: unknown; capabilities?: unknown;
  };
  const raw = Array.isArray(data.requirements) ? data.requirements : [];
  const rows = raw.map(row => {
    const r = requirementFromHub(row);
    return r && (row as { archived?: unknown }).archived === true ? { ...r, archived: true } : r;
  }).filter((row): row is Requirement => !!row);
  const caps = capabilitiesFromPayload(data);
  return {
    rows,
    deleted: Array.isArray(data.deleted) ? data.deleted.filter((id): id is string => typeof id === 'string') : [],
    serverTime: typeof data.server_time === 'string' && data.server_time ? data.server_time : null,
    hasMore: data.has_more === true,
    capabilities: caps.capabilities,
    capabilitiesKnown: caps.known,
  };
}

/** 服务端搜索一页几张(带完整描述,比看板的精简行重):更多的点「加载更多」接着读。 */
export const SEARCH_PAGE = 200;

/**
 * 服务端搜索(Hub capability search):GET ?q=,语义同本机的任务搜索(task-search.ts)。
 * includeArchived = 连归档的一起搜(?include_archived=1,行上 archived: true 的标出来);cursor = 上一页的 next_cursor。
 * next = 还有下一页时的 cursor(Hub capability paging 的 has_more / next_cursor;没有就是 null)。
 */
export async function searchRequirementsOnHub(cfg: HubConfig, q: string, opts: { includeArchived?: boolean; cursor?: string | null } = {}): Promise<{ rows: Requirement[]; next: string | null }> {
  const qs = `q=${encodeURIComponent(q)}&limit=${SEARCH_PAGE}${opts.includeArchived ? '&include_archived=1' : ''}${opts.cursor ? `&cursor=${encodeURIComponent(opts.cursor)}` : ''}`;
  const data = await call(cfg, scoped(cfg, `/api/requirements?${qs}`)) as { requirements?: unknown; has_more?: unknown; next_cursor?: unknown };
  const raw = Array.isArray(data.requirements) ? data.requirements : [];
  const rows = raw.map(row => {
    const r = requirementFromHub(row);
    return r && (row as { archived?: unknown }).archived === true ? { ...r, archived: true } : r;
  }).filter((row): row is Requirement => !!row);
  return { rows, next: data.has_more === true && typeof data.next_cursor === 'string' && data.next_cursor ? data.next_cursor : null };
}

/**
 * 归档的卡(Hub capability `archived`):GET ?archived=true 只回归档的那些。平常的列表不带它们,
 * 搜索里勾了「包含已归档」才读一次,每行标上 archived。
 */
export async function listArchivedRequirements(cfg: HubConfig): Promise<Requirement[]> {
  const data = await call(cfg, scoped(cfg, '/api/requirements?archived=true')) as { requirements?: unknown };
  const rows = Array.isArray(data.requirements) ? data.requirements : [];
  return rows.map(requirementFromHub).filter((row): row is Requirement => !!row).map(row => ({ ...row, archived: true }));
}

/**
 * 仪表盘要整张表(含归档的卡 —— 完成的卡常被归档,只读平常的列表会少算):按 cursor 一页页读(capability paging),
 * 平常的和归档的各读一遍。旧 Hub 没有分页:各读一次,满 500 张就标 partial(数字只是下界)。
 * 页数封顶 DASH_MAX_PAGES,防一个坏 cursor 把它变成死循环。
 */
export const DASH_PAGE = 1000;
export const DASH_MAX_PAGES = 20;
export async function listAllRequirementsForDashboard(cfg: HubConfig): Promise<{ rows: Requirement[]; partial: boolean }> {
  const out: Requirement[] = [];
  let partial = false;
  for (const archived of [false, true]) {
    let cursor: string | null = null;
    for (let page = 0; ; page++) {
      const qs = `limit=${DASH_PAGE}${archived ? '&archived=true' : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const data = await call(cfg, scoped(cfg, `/api/requirements?${qs}`)) as { requirements?: unknown; has_more?: unknown; next_cursor?: unknown };
      const rows = Array.isArray(data.requirements) ? data.requirements : [];
      for (const row of rows) {
        const r = requirementFromHub(row);
        if (r) out.push(archived ? { ...r, archived: true } : r);
      }
      if (typeof data.has_more !== 'boolean') { if (rows.length >= HUB_LIST_CAP) partial = true; break; }
      if (!data.has_more || typeof data.next_cursor !== 'string' || !data.next_cursor) break;
      if (page + 1 >= DASH_MAX_PAGES) { partial = true; break; }
      cursor = data.next_cursor;
    }
  }
  // 同一张卡在两遍里都出现(读的间隙被归档 / 取消归档):留后读到的那份。
  return { rows: [...new Map(out.map(r => [r.id, r])).values()], partial };
}

/**
 * 任务动态(Hub capability events,GET /api/requirements/events):一个网络的字段级改动流水,新 → 旧。
 * since = 只要这之后的(含);cursor = 上一页的 next_cursor(更早的);原样返回,task-activity-model.ts parseEvents 校验。
 */
export async function fetchRequirementEvents(cfg: HubConfig, q: { since?: string | null; cursor?: string | null; limit: number; requirementId?: string }): Promise<unknown> {
  const qs = [`limit=${q.limit}`, q.since ? `since=${encodeURIComponent(q.since)}` : '', q.cursor ? `cursor=${encodeURIComponent(q.cursor)}` : '', q.requirementId ? `requirement_id=${encodeURIComponent(q.requirementId)}` : ''].filter(Boolean).join('&');
  return call(cfg, scoped(cfg, `/api/requirements/events?${qs}`));
}

/** GET /api/requirements/stats(capability stats)。原样返回 JSON,由 task-dashboard-model.parseHubStats 校验。 */
export async function fetchRequirementStats(cfg: HubConfig, q: { from: number | null; tz: string; days: number; recent: number; projectId?: string | null }): Promise<unknown> {
  const qs = `tz=${encodeURIComponent(q.tz)}&days=${q.days}&recent=${q.recent}${q.from !== null ? `&from=${encodeURIComponent(new Date(q.from).toISOString())}` : ''}${q.projectId ? `&project_id=${encodeURIComponent(q.projectId)}` : ''}`;
  return call(cfg, scoped(cfg, `/api/requirements/stats?${qs}`));
}

/** 按 id 读一张卡(仪表盘点开一张不在看板里的卡 —— 通常是归档的)。 */
export async function getRequirementOnHub(cfg: HubConfig, id: string): Promise<Requirement | null> {
  const data = await call(cfg, scoped(cfg, `/api/requirements/${encodeURIComponent(id)}`)) as { requirement?: unknown };
  const row = requirementFromHub(data.requirement);
  if (!row) return null;
  const archived = (data.requirement as { archived?: unknown } | undefined)?.archived === true;
  return archived ? { ...row, archived: true } : row;
}

type CreateInput = { name: string; priority: ReqPriority; assignee: string; due: string; column?: ReqColumn; clientId?: string; owner?: RequirementPersonRef; agentOwner?: RequirementPersonRef; participants?: RequirementPersonRef[]; projectId?: string; parentId?: string; tags?: string[] };

/** POST 的请求体。负责人只带稳定身份 {kind,id},多余字段(显示名、networkId…)一律不发。 */
export function createRequirementBody(cfg: HubConfig, input: CreateInput): Record<string, unknown> {
  return {
    name: input.name,
    priority: input.priority,
    assignee: input.assignee,
    due: input.due,
    column: input.column,
    client_id: input.clientId,
    network_id: cfg.networkId,
    owner: input.owner ? { kind: input.owner.kind, id: input.owner.id } : undefined,
    agent_owner: input.agentOwner ? { kind: input.agentOwner.kind, id: input.agentOwner.id } : undefined,
    // 参与人在 POST 里一起建(Hub #2065 起 create 就收 participants,和 PATCH 同一个 assignments())。
    participants: input.participants?.length ? input.participants.map(r => ({ kind: r.kind, id: r.id })) : undefined,
    project_id: input.projectId || undefined,
    parent_id: input.parentId || undefined,
    tags: input.tags?.length ? input.tags : undefined,
  };
}

export async function createRequirementOnHub(cfg: HubConfig, input: CreateInput): Promise<Requirement> {
  const data = await call(cfg, '/api/requirements', {
    method: 'POST',
    body: JSON.stringify(createRequirementBody(cfg, input)),
  }) as { requirement?: unknown };
  const row = requirementFromHub(data.requirement);
  if (!row) throw new RequirementsHubError('Hub 没有返回这条需求', 502);
  return row;
}

/**
 * 改标题 / 优先级 / 期限 / 负责人(Hub #2070 的 PATCH)。只发改过的字段(editPatch)。
 * 旧 Hub:不认识这些字段时回 400 empty_patch;更老的会忽略字段照样回 200 —— 两种都报「还不能改」,
 * 不把没生效的保存说成成功。
 */
/** 改母任务被 Hub 拒绝的两种说法(详情把它们显示在「母任务」下面,而不是底部)。 */
export const PARENT_TOO_DEEP = '子任务最多 5 层';
export const PARENT_REJECTED = '不能挂到这个母任务下(会形成循环,或它已不存在)';

export async function updateRequirementOnHub(cfg: HubConfig, id: string, patch: EditPatch): Promise<Requirement> {
  const res = await appFetch(`${cfg.serverUrl}${scoped(cfg, `/api/requirements/${encodeURIComponent(id)}`)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', ...ACCEPT_COLUMNS_HEADERS },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => null) as { requirement?: unknown; error?: string; message?: unknown } | null;
  // 参与人改了状态 / 检查项以外的字段:hub 带一句中文 message(agent-network#2201),照它说。
  if (res.status === 403) throw new RequirementsHubError(typeof data?.message === 'string' && data.message.trim() ? data.message.trim().slice(0, 200) : '你没有修改这条需求的权限', 403);
  if (res.status === 400 && data?.error === 'invalid_issues') throw new RequirementsHubError('invalid_issues', 400);
  if (res.status === 400 && data?.error === 'invalid_tags') throw new RequirementsHubError('invalid_tags', 400);
  if (res.status === 400 && data?.error === 'empty_patch') throw new RequirementsHubError(HUB_CANNOT_EDIT, 400);
  if (res.status === 400 && (data?.error === 'person_not_in_network' || data?.error === 'invalid_person')) throw new RequirementsHubError('这个负责人已不在当前网络', 400);
  if (res.status === 400 && data?.error === 'owner_must_be_human') throw new RequirementsHubError('负责人只能是人类;Agent 请放在「负责 Agent」', 400);
  if (res.status === 400 && data?.error === 'project_archived') throw new RequirementsHubError('这个项目已归档，换一个项目', 400);
  if (res.status === 400 && data?.error === 'project_not_in_network') throw new RequirementsHubError('这个项目不在当前网络', 400);
  if (res.status === 400 && data?.error === 'parent_too_deep') throw new RequirementsHubError(PARENT_TOO_DEEP, 400);
  if (res.status === 400 && (data?.error === 'parent_cycle' || data?.error === 'parent_not_found')) throw new RequirementsHubError(PARENT_REJECTED, 400);
  if (res.status === 400 && data?.error === 'invalid_description') throw new RequirementsHubError('描述太长了(最多 20000 字)', 400);
  if (res.status === 400 && data?.error === 'invalid_checklist') throw new RequirementsHubError('检查项不合法(最多 100 项,每项 1–500 字)', 400);
  if (res.status === 400 && data?.error === 'agent_owner_must_be_agent') throw new RequirementsHubError('负责 Agent 只能是 Agent 节点', 400);
  if (res.status === 404) throw new RequirementsHubError('这条需求已不存在', 404);
  if (!res.ok) throw new RequirementsHubError('修改没有保存，请重试', res.status);
  const row = requirementFromHub(data?.requirement);
  if (!row) throw new RequirementsHubError('Hub 没有返回这条需求', 502);
  if (!patchApplied(row, patch)) throw new RequirementsHubError(HUB_CANNOT_EDIT, 501);
  return row;
}

/**
 * 归档 / 恢复(Hub capability `archived`):只发 { archived }。归档的卡不在平常的列表里(增量读里带 archived: true 的行
 * 由看板去掉),只在搜索「包含已归档」里出现。Agent 一直能通过 MCP requirements_update 归档;这是人在 app 里的同一个动作。
 * 回来的行带 archived 标记(requirementFromHub 不读这个键)。
 */
export async function setRequirementArchivedOnHub(cfg: HubConfig, id: string, archived: boolean): Promise<Requirement> {
  const res = await appFetch(`${cfg.serverUrl}${scoped(cfg, `/api/requirements/${encodeURIComponent(id)}`)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', ...ACCEPT_COLUMNS_HEADERS },
    body: JSON.stringify({ archived }),
  });
  const data = await res.json().catch(() => null) as { requirement?: unknown; message?: unknown } | null;
  if (res.status === 403) throw new RequirementsHubError(typeof data?.message === 'string' && data.message.trim() ? data.message.trim().slice(0, 200) : '你没有修改这条需求的权限', 403);
  if (res.status === 404) throw new RequirementsHubError('这条需求已不存在', 404);
  if (!res.ok) throw new RequirementsHubError(archived ? '没有归档成功，请重试' : '没有恢复成功，请重试', res.status);
  const raw = data?.requirement as { archived?: unknown } | undefined;
  const row = requirementFromHub(raw);
  if (!row) throw new RequirementsHubError('Hub 没有返回这条需求', 502);
  // 回来的行上 archived 没变成要的值(Hub 不认识这个键):当没成功,不假装归档了。
  if (raw?.archived !== archived) throw new RequirementsHubError(HUB_CANNOT_EDIT, 501);
  return archived ? { ...row, archived: true } : row;
}

/**
 * 这个 Hub 分不分「负责人(人类)/ 负责 Agent」?看板里有卡片时直接看行里有没有 agent_owner 字段;
 * 一张卡都没有时用一个不存在的 id 探一下:认识 agent_owner 的 Hub 过了 empty_patch 检查、回 404
 * requirement_not_found;旧 Hub 不认识这个字段,回 400 empty_patch。探针什么都不写。
 */
export async function probeAgentOwnerSupport(cfg: HubConfig): Promise<boolean> {
  // 在看板首次加载的路径上:卡住就当旧 Hub(false),不能让它把任务页挂在转圈上。
  try {
    return await withDeadline((async () => {
      const res = await appFetch(`${cfg.serverUrl}${scoped(cfg, '/api/requirements/__capability_probe__')}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', ...ACCEPT_COLUMNS_HEADERS },
        body: JSON.stringify({ agent_owner: null }),
      });
      const data = await res.json().catch(() => null) as { error?: string } | null;
      return res.status === 404 && data?.error === 'requirement_not_found';
    })(), deadlineMs, () => false);
  } catch {
    return false;
  }
}

/**
 * 勾一个子任务:PATCH /api/requirements/{id}/checklist/{itemId} {done}。只改那一项(Agent 同时在勾别的项不会被盖掉)。
 * done 是显式值,重复请求结果一样。
 */
export async function setChecklistItemOnHub(cfg: HubConfig, id: string, itemId: string, done: boolean): Promise<Requirement> {
  const res = await appFetch(`${cfg.serverUrl}${scoped(cfg, `/api/requirements/${encodeURIComponent(id)}/checklist/${encodeURIComponent(itemId)}`)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', ...ACCEPT_COLUMNS_HEADERS },
    body: JSON.stringify({ done }),
  });
  const data = await res.json().catch(() => null) as { requirement?: unknown; error?: string } | null;
  if (res.status === 403) throw new RequirementsHubError('你没有修改这条需求的权限', 403);
  if (res.status === 404 && data?.error === 'checklist_item_not_found') throw new RequirementsHubError('这个检查项已被删除，请刷新', 404);
  if (res.status === 404) throw new RequirementsHubError(HUB_CANNOT_EDIT, 404);
  if (!res.ok) throw new RequirementsHubError('检查项没有保存，请重试', res.status);
  const row = requirementFromHub(data?.requirement);
  if (!row) throw new RequirementsHubError('Hub 没有返回这条需求', 502);
  return row;
}

export const HUB_CANNOT_EDIT = '这个 Hub 还不能修改已有需求的内容，升级 Hub 后再试';

/** 当前登录用户的 user_id(「我负责的」用)。拿不到就是 null,左栏那一项不可用。 */
export async function fetchMyUserId(cfg: HubConfig): Promise<string | null> {
  try {
    const data = await withDeadline(fetchAuthMe(cfg).catch(() => null) as Promise<{ user?: { user_id?: unknown } } | null>, deadlineMs, () => null);
    return typeof data?.user?.user_id === 'string' && data.user.user_id ? data.user.user_id : null;
  } catch {
    return null;
  }
}

export async function moveRequirementOnHub(cfg: HubConfig, id: string, column: ReqColumn): Promise<Requirement> {
  const data = await call(cfg, `/api/requirements/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(statusPatch(column)),
  }) as { requirement?: unknown };
  const row = requirementFromHub(data.requirement);
  if (!row) throw new RequirementsHubError('Hub 没有返回这条需求', 502);
  return row;
}

/** 本机旧卡片逐条迁到 Hub。Hub 里已经有别的卡片也要迁。一张成功就从本机删掉一张，中途失败留下剩下的，下次接着迁。clientId 用本机 id，Hub 再收到同一条就返回原卡片。 */
export async function migrateLocalRequirements(
  cfg: HubConfig,
  read: () => Requirement[],
  write: (items: Requirement[]) => void,
  create: typeof createRequirementOnHub = createRequirementOnHub,
): Promise<{ migrated: number; left: number }> {
  let migrated = 0;
  for (const item of read()) {
    await create(cfg, {
      name: item.name,
      priority: item.priority,
      assignee: item.assignee,
      due: item.due,
      column: item.column,
      clientId: item.id,
    });
    write(read().filter(row => row.id !== item.id));
    migrated += 1;
  }
  return { migrated, left: read().length };
}

/** 负责节点从 Hub 的节点列表里点，不手填。空名丢掉，同名只留一个，按名字排。 */
export function filterAssigneeChoices(aliases: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of aliases) {
    const alias = raw.trim();
    if (!alias || seen.has(alias)) continue;
    if (q && !alias.toLowerCase().includes(q)) continue;
    seen.add(alias);
    out.push(alias);
  }
  out.sort((a, b) => a.localeCompare(b, 'zh'));
  return out;
}

// ── 项目 ──
// GET 在旧 Hub 上是 404(没有这个路由)→ 返回 null:界面把项目整个藏起来。

export function projectFromHub(value: unknown): RequirementProject | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || typeof v.name !== 'string' || !v.name.trim()) return null;
  return {
    id: v.id,
    name: v.name,
    color: typeof v.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.color) ? v.color : '#4b5563',
    sort: typeof v.sort === 'number' ? v.sort : 0,
    archived: v.archived === true,
    // 同卡片的 viewer_can:只认显式的 edit === false(task-access.readOnlyFromHub 同一判据)。
    ...(readOnlyFromHub(v) ? { canEdit: false } : {}),
  };
}

async function projectCall(cfg: HubConfig, path: string, init?: RequestInit): Promise<{ status: number; data: any }> {
  // listProjects 在看板首次加载的路径上:同样要有上限。
  const got = await withDeadline((async () => {
    const res = await appFetch(`${cfg.serverUrl}${scoped(cfg, path)}`, {
      ...init,
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', ...ACCEPT_COLUMNS_HEADERS },
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  })(), deadlineMs, () => null);
  if (!got) throw new RequirementsHubError(REQUIREMENTS_TIMEOUT_TEXT, 0);
  return got;
}

const projectError = (status: number, error?: string): RequirementsHubError =>
  new RequirementsHubError(
    error === 'project_name_taken' ? '已经有同名的项目'
      : error === 'invalid_project_name' ? '项目名 1–40 个字'
        : status === 403 ? '你没有管理项目的权限'
          : status === 404 ? '这个 Hub 还没有项目，升级 Hub 后再试' : '项目没有保存，请重试',
    status,
  );

/** 项目列表;旧 Hub(没有项目)返回 null。 */
export async function listProjects(cfg: HubConfig): Promise<RequirementProject[] | null> {
  const { status, data } = await projectCall(cfg, '/api/requirements/projects');
  if (status === 404) return null;
  if (status < 200 || status >= 300 || !Array.isArray(data?.projects)) throw projectError(status, data?.error);
  return data.projects.map(projectFromHub).filter((p: RequirementProject | null): p is RequirementProject => !!p);
}

export async function createProject(cfg: HubConfig, input: { name: string; color?: string }): Promise<RequirementProject> {
  const { status, data } = await projectCall(cfg, '/api/requirements/projects', { method: 'POST', body: JSON.stringify({ ...input, network_id: cfg.networkId }) });
  const row = projectFromHub(data?.project);
  if (status !== 201 || !row) throw projectError(status, data?.error);
  return row;
}

export async function updateProject(cfg: HubConfig, id: string, patch: { name?: string; color?: string; sort?: number; archived?: boolean }): Promise<RequirementProject> {
  const { status, data } = await projectCall(cfg, `/api/requirements/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
  const row = projectFromHub(data?.project);
  if (status !== 200 || !row) throw projectError(status, data?.error);
  return row;
}
