// 任务看板(需求池)的纯逻辑:筛选、分组、排序、期限、拖动状态机、新建校验。
// 不 import react-native —— task-board-model.test.ts 直接引。界面在 RequirementBoard.tsx。
//
// Owner 2026-09-29:「这个任务列表也他妈太难看了」。重做参照 Linear / TickTick:
// 头部一行(标题 · 列表/看板 · 负责人/优先级筛选 · ＋ 新建),三列等宽铺满,卡片整张可点,
// 桌面拖动换列、手机长按菜单。Hub 数据模型不变(标题/状态/优先级/期限/负责人/参与人)。
import { dueInstant, dueToLocal, formatDueFull, formatTime, isDateTime, systemClock, type Clock } from './due-time';
import { taskTimestamp } from './task-time';
import { activityTime } from './requirement-last-event';
import { dueMarker, dueMarkerLabel, isOverdue, type DueAt } from './due-marker';
import { seqCmp } from './task-short-id';
import {
  type ChecklistItem,
  type RequirementProject,
  columnsOf,
  dueOk,
  REQ_COLUMNS,
  REQ_PRIORITIES,
  type ReqColumn,
  type ReqPriority,
  type Requirement,
} from './requirements-model';
import { personKey, type RequirementPerson, type RequirementPersonRef } from './requirement-people';

// ── 筛选 ──────────────────────────────────────────────────────────────────

/** 「未分配」在负责人筛选里的键(personKey 形如 user:… / node:…,不会撞)。 */
export const UNASSIGNED = 'none';

/** 一张卡片在负责人筛选里的键。旧 Hub 没有稳定负责人(owner undefined)时按未分配算。 */
export const ownerKeyOf = (item: Pick<Requirement, 'owner'>): string => (item.owner ? personKey(item.owner) : UNASSIGNED);

/**
 * 卡片在筛选里能被哪些人认领:负责人(人类)和负责 Agent 各算一个。两个都没有 = 未分配。
 * 「我负责的」= user:<我> 命中负责人;「按 Agent」= node:<id> 命中负责 Agent(旧 Hub 上命中单一负责人)。
 */
export function roleKeysOf(item: Pick<Requirement, 'owner' | 'agentOwner'>): string[] {
  const keys: string[] = [];
  if (item.owner) keys.push(personKey(item.owner));
  if (item.agentOwner) keys.push(personKey(item.agentOwner));
  return keys.length ? keys : [UNASSIGNED];
}

/** 这张卡所在的 Hub 分不分两个角色(行里带 agent_owner 字段)。 */
export const hasRoles = (item: Pick<Requirement, 'agentOwner'>): boolean => item.agentOwner !== undefined;

export interface BoardFilter {
  tag?: string;
  /** Chart drill-down into the distinct no-label bucket. */
  untagged?: boolean;
  /** 负责人键(personKey 或 UNASSIGNED)。空 = 不按负责人筛。 */
  owners: string[];
  /** 参与人键(personKey):左栏「我参与的」。省略 / '' = 不按参与人筛。和负责人是两回事(我负责的 ≠ 我参与的)。 */
  participant?: string;
  /** 空 = 不按优先级筛。 */
  priorities: ReqPriority[];
  /** 项目 id;NO_PROJECT = 不属于任何项目;省略 / '' = 全部项目。 */
  project?: string;
  /** 只看顶层(不显示子需求)。 */
  topLevel?: boolean;
  /** 状态(看板的列)。省略 / 空 = 不按状态筛;看板只画选中的列。 */
  statuses?: ReqColumn[];
  /** 快捷筛选「已逾期」(#493):只看逾期且未完成 / 未归档的卡(判据 due-marker.ts isOverdue,与红色胶囊同源)。 */
  overdue?: boolean;
  /**
   * 「废弃」(#724)默认不显示:状态筛选为空(=「全部」)时也不含废弃的卡,看板上那一列收起。
   * true = 连废弃的一起显示;状态筛选里显式选了「废弃」也算。
   */
  showAbandoned?: boolean;
}

export const NO_PROJECT = '__none__';

export const EMPTY_FILTER: BoardFilter = { owners: [], priorities: [] };

export const filterActive = (f: BoardFilter): boolean => f.owners.length > 0 || f.priorities.length > 0 || !!f.project || !!f.statuses?.length || !!f.tag || !!f.untagged || !!f.participant || !!f.overdue;

/** 状态筛选里的「隐藏已完成」= 只选需求池 + 进行中(废弃本来就默认不显示)。 */
export const HIDE_DONE: readonly ReqColumn[] = REQ_COLUMNS.filter(c => c !== 'done' && c !== 'abandoned');

/** 废弃的卡这次显不显示:显式打开开关,或状态筛选里选了「废弃」。 */
export const abandonedShown = (f: Pick<BoardFilter, 'showAbandoned' | 'statuses'>): boolean =>
  !!f.showAbandoned || !!f.statuses?.includes('abandoned');
export const hidesDone = (statuses: readonly ReqColumn[] | undefined): boolean =>
  !!statuses && statuses.length === HIDE_DONE.length && HIDE_DONE.every(c => statuses.includes(c));
/** 点「隐藏已完成」:已经是这个组合就清空(回到全部),否则换成它。 */
export const toggleHideDone = (statuses: readonly ReqColumn[] | undefined): ReqColumn[] => (hidesDone(statuses) ? [] : [...HIDE_DONE]);

export function matchesFilter(item: Requirement, f: BoardFilter, at: DueAt = {}): boolean {
  if (f.overdue && !isOverdue(item, at)) return false;
  if (f.tag && !item.tags?.includes(f.tag)) return false;
  if (f.untagged && item.tags?.some(t => !!t)) return false;
  if (f.owners.length && !roleKeysOf(item).some(k => f.owners.includes(k))) return false;
  if (f.participant && !item.participants?.some(r => personKey(r) === f.participant)) return false;
  if (f.priorities.length && !f.priorities.includes(item.priority)) return false;
  if (f.statuses?.length && !f.statuses.includes(item.column)) return false;
  if (item.column === 'abandoned' && !abandonedShown(f)) return false;
  if (f.project) {
    if (f.project === NO_PROJECT ? !!item.projectId : item.projectId !== f.project) return false;
  }
  if (f.topLevel && item.parentId) return false;
  return true;
}

// ── 子需求 ───────────────────────────────────────────────────────────────

/** 这个 Hub 有没有子需求(行里带 parent_id 字段)。 */
export const hasSubRequirements = (item: Pick<Requirement, 'parentId'>): boolean => item.parentId !== undefined;

/** 一张卡的直接子需求(按看板顺序)。 */
export const childrenOf = (items: readonly Requirement[], id: string): Requirement[] =>
  sortColumnByStatus(items.filter(i => i.parentId === id));

const STATUS_RANK: Record<ReqColumn, number> = { doing: 0, pool: 1, done: 2, abandoned: 3 };
const sortColumnByStatus = (list: Requirement[]): Requirement[] =>
  [...list].sort((a, b) => STATUS_RANK[a.column] - STATUS_RANK[b.column] || (a.createdAt < b.createdAt ? -1 : 1));

/** 从一张卡往上的父链(近的在前);父卡不在当前列表里就停(比如被归档了)。防环。 */
export function ancestorsOf(items: readonly Requirement[], item: Requirement): Requirement[] {
  const out: Requirement[] = [];
  const seen = new Set<string>([item.id]);
  let cur = item.parentId ? items.find(i => i.id === item.parentId) : undefined;
  while (cur && !seen.has(cur.id) && out.length < 5) {
    out.push(cur);
    seen.add(cur.id);
    cur = cur.parentId ? items.find(i => i.id === cur!.parentId) : undefined;
  }
  return out;
}

/** 子需求进度:优先用 Hub 给的计数(含不在当前筛选里的子需求);没有就按当前列表数。 */
export function subProgress(items: readonly Requirement[], item: Requirement): { done: number; total: number } {
  if (item.children) return item.children;
  // 废弃的子需求不算进度(Hub #2490 同口径)。
  const kids = items.filter(i => i.parentId === item.id && i.column !== 'abandoned');
  return { total: kids.length, done: kids.filter(k => k.column === 'done').length };
}

// ── 项目 ─────────────────────────────────────────────────────────────────

/** 可选的项目(未归档),按 sort、名字排。 */
export const activeProjects = (projects: readonly RequirementProject[]): RequirementProject[] =>
  projects.filter(p => !p.archived).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh'));

/** 能把任务放进去的项目:未归档、且不是「只看」授权(「仅相关任务」的成员,Hub 只收 can_edit 的项目或无项目)。 */
export const pickableProjects = (projects: readonly RequirementProject[]): RequirementProject[] => activeProjects(projects).filter(p => p.canEdit !== false);

/** 各项目的卡片数(按当前除项目以外的筛选算,左栏的数字才和点进去看到的一致)。 */
export function projectCounts(items: readonly Requirement[], f: BoardFilter): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of applyFilter(items, { ...f, project: '' })) {
    const key = item.projectId || NO_PROJECT;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** 新建时默认的项目:左栏 / 头部正选着一个(未归档的)项目就用它。 */
export function defaultProjectFor(f: BoardFilter, projects: readonly RequirementProject[]): string | null {
  if (!f.project || f.project === NO_PROJECT) return null;
  // 筛到一个只看的项目(scoped 成员)时不预选它 —— Hub 只收能编辑的项目或无项目。
  return projects.some(p => p.id === f.project && !p.archived && p.canEdit !== false) ? f.project : null;
}

export const PROJECT_COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#4b5563'] as const;

/** 改色:在调色板里轮到下一个。 */
export const nextProjectColor = (color: string): string => {
  const i = PROJECT_COLORS.indexOf(color as (typeof PROJECT_COLORS)[number]);
  return PROJECT_COLORS[(i + 1) % PROJECT_COLORS.length];
};

export function checkProjectName(name: string, projects: readonly RequirementProject[], except?: string): { ok: true; name: string } | { ok: false; message: string } {
  const n = name.replace(/\s+/g, ' ').trim();
  if (!n) return { ok: false, message: '先写项目名' };
  if (n.length > 40) return { ok: false, message: '项目名最多 40 个字' };
  if (projects.some(p => !p.archived && p.name === n && p.id !== except)) return { ok: false, message: '已经有同名的项目' };
  return { ok: true, name: n };
}

// ── 左栏:按节点 / 按 Agent 的收起 ─────────────────────────────────────────

/**
 * 网络里可能有几百个节点,几乎都没有任务(owner 0.2.141 截图:~300 行 0)。左栏只把有任务的放出来
 * (按数目降序),其余收进「更多节点」,展开后可以搜。
 */
export function splitByCount<T extends { name: string; count: number }>(rows: readonly T[], query = ''): { shown: T[]; more: T[] } {
  const shown = rows.filter(r => r.count > 0).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
  const q = query.trim().toLocaleLowerCase();
  const more = rows.filter(r => r.count === 0 && (!q || r.name.toLocaleLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  return { shown, more };
}

export const applyFilter = (items: readonly Requirement[], f: BoardFilter, at: DueAt = {}): Requirement[] => {
  // 「已逾期」按同一个「现在」判整批(不在逐张卡之间跨过午夜)。
  const when = f.overdue && at.now === undefined ? { ...at, now: Date.now() } : at;
  return items.filter(item => matchesFilter(item, f, when));
};

/** 多选筛选里点一项:有就去掉,没有就加上。 */
export function toggleIn<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value];
}

/** 看板三列:先筛再分组,列里的数就是筛过之后的数(与看到的卡片一致)。 */
/** 看板的列 / 手机列表的分组:按状态筛了就只留选中的列(剩下的列平分宽度)。 */
export const boardColumns = (items: readonly Requirement[], f: BoardFilter, at: DueAt = {}) =>
  columnsOf(applyFilter(items, f, at)).filter(col => (!f.statuses?.length || f.statuses.includes(col.column)) && (col.column !== 'abandoned' || abandonedShown(f)));

/**
 * 当前筛选下被藏起来的废弃卡数(#724):看板收起的那一列、列表「显示废弃」开关上的数字。
 * 与展开后看到的张数同源(同一个 applyFilter,只多一个 showAbandoned)。已经显示时为 0。
 */
export function hiddenAbandonedCount(items: readonly Requirement[], f: BoardFilter, at: DueAt = {}): number {
  if (abandonedShown(f)) return 0;
  if (f.statuses?.length) return 0; // 选了具体状态且没选废弃:用户要的就是那几列,不提示
  return applyFilter(items, { ...f, showAbandoned: true }, at).filter(i => i.column === 'abandoned').length;
}

// ── 桌面左栏:全部 / 我负责的 / 我参与的 / 按节点 ─────────────────────────────

export type SidebarScope = 'all' | 'mine' | 'participating' | 'unassigned' | `node:${string}`;

/** 左栏的一项对应的负责人筛选(与头部「负责人」筛选是同一份状态)。 */
export function ownersForScope(scope: SidebarScope, meId: string | null): string[] {
  if (scope === 'all' || scope === 'participating') return [];
  if (scope === 'mine') return meId ? [personKey({ kind: 'user', id: meId })] : [];
  if (scope === 'unassigned') return [UNASSIGNED];
  return [scope];
}

/**
 * 点左栏一项后的整份筛选:换负责人和参与人两格,其余(优先级、项目、状态…)保留。
 * 「我参与的」= 参与人里有我、负责人不限;其余各项都清掉参与人。
 */
export function filterForScope(f: BoardFilter, scope: SidebarScope, meId: string | null): BoardFilter {
  const participant = scope === 'participating' && meId ? personKey({ kind: 'user', id: meId }) : '';
  return { ...f, owners: ownersForScope(scope, meId), participant };
}

/** 当前负责人 / 参与人筛选对应左栏哪一项;多选或混合时一个都不亮(null)。 */
export function scopeOf(owners: readonly string[], meId: string | null, participant = ''): SidebarScope | null {
  if (participant) return owners.length === 0 && meId && participant === personKey({ kind: 'user', id: meId }) ? 'participating' : null;
  if (owners.length === 0) return 'all';
  if (owners.length !== 1) return null;
  const only = owners[0];
  if (only === UNASSIGNED) return 'unassigned';
  if (meId && only === personKey({ kind: 'user', id: meId })) return 'mine';
  if (only.startsWith('node:')) return only as SidebarScope;
  return null;
}

// ── 快捷筛选:我负责 / 我参与 / 已逾期(#493)─────────────────────────────────
// 头部一排开关胶囊(桌面在工具栏,手机在横向滑动的筛选行)。「我负责」「我参与」就是左栏的同名两项
// (同一份 owners / participant 状态,两边永远一致,也和左栏一样互斥);「已逾期」是独立的一格,
// 和其余所有筛选(负责人 / 优先级 / 项目 / 状态 / 标签 / 搜索)取交集。

export const QUICK_FILTERS = ['mine', 'participating', 'overdue'] as const;
export type QuickFilter = (typeof QUICK_FILTERS)[number];

export function quickFilterOn(f: BoardFilter, key: QuickFilter, meId: string | null): boolean {
  if (key === 'overdue') return !!f.overdue;
  return scopeOf(f.owners, meId, f.participant) === key;
}

/** 点一下快捷胶囊:开着就关(回到「全部」负责人 / 关掉逾期),关着就开;其余筛选原样保留。 */
export function toggleQuickFilter(f: BoardFilter, key: QuickFilter, meId: string | null): BoardFilter {
  if (key === 'overdue') return { ...f, overdue: !f.overdue };
  if (!meId) return f;
  return filterForScope(f, quickFilterOn(f, key, meId) ? 'all' : key, meId);
}

export interface OwnerCount { key: string; ref: RequirementPersonRef | null; name: string; count: number }

/**
 * 负责人列表(头部筛选弹层、桌面左栏「按节点」用):有卡片的负责人在前按数目降序,同数按名字;
 * 名字从 Hub 的 people 里取,取不到就用 id。未分配单独一项放最后。
 */
export function ownerCounts(items: readonly Requirement[], people: readonly RequirementPerson[]): OwnerCount[] {
  const counts = new Map<string, OwnerCount>();
  let none = 0;
  for (const item of items) {
    const refs = [item.owner, item.agentOwner].filter((r): r is RequirementPersonRef => !!r);
    if (!refs.length) { none += 1; continue; }
    for (const ref of refs) {
      const key = personKey(ref);
      const row = counts.get(key);
      if (row) row.count += 1;
      else counts.set(key, { key, ref: { kind: ref.kind, id: ref.id }, name: personName(ref, people), count: 1 });
    }
  }
  const rows = [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
  return [...rows, { key: UNASSIGNED, ref: null, name: '未分配', count: none }];
}

/**
 * 头部「负责人」筛选的分段:「人」(我排第一)、「Agent」、最后「未分配」。
 * 负责人和负责 Agent 都能筛(roleKeysOf),但混在一张按数目排的表里时「我」常沉到底、人和节点分不清(任务页审计 M8)。
 * 空段不返回。
 */
export function ownerFilterSections<T extends { key: string; ref: RequirementPersonRef | null }>(rows: readonly T[], meKey: string): { kind: 'people' | 'agents' | 'none'; rows: T[] }[] {
  const people = rows.filter(r => r.ref?.kind === 'user');
  const sections = [
    { kind: 'people' as const, rows: [...people.filter(r => r.key === meKey), ...people.filter(r => r.key !== meKey)] },
    { kind: 'agents' as const, rows: rows.filter(r => r.ref?.kind === 'node') },
    { kind: 'none' as const, rows: rows.filter(r => !r.ref) },
  ];
  return sections.filter(s => s.rows.length > 0);
}

/** 短 id(未知成员时附在后面,方便认):取最后 6 位。 */
export const shortId = (id: string): string => (id.length > 6 ? id.slice(-6) : id);

/**
 * 人 / 节点的显示名。成员表里找不到(已退出、成员表没读到…)时是「未知成员（…末 6 位）」——
 * 永远不把裸 id(n_e06d936d / u_a4944afaa30b)当名字显示(owner 0.2.141 截图)。
 */
export function personDisplay(ref: RequirementPersonRef, people: readonly RequirementPerson[]): { name: string; known: boolean } {
  const hit = people.find(p => personKey(p) === personKey(ref));
  if (hit?.name) return { name: hit.name, known: true };
  return { name: `未知成员（${shortId(ref.id)}）`, known: false };
}

export function personName(ref: RequirementPersonRef, people: readonly RequirementPerson[]): string {
  return personDisplay(ref, people).name;
}

/** 卡片 / 列表上的参与人头像:最多 3 个,其余「+N」。 */
/** 我在参与人里就排到最前(第 4 位以后会被折进「+N」,卡片上就看不出我在不在)。其余保持原顺序。 */
export function participantsMeFirst(refs: readonly RequirementPersonRef[] | undefined, meKey?: string | null): RequirementPersonRef[] {
  const list = [...(refs ?? [])];
  const i = meKey ? list.findIndex(r => personKey(r) === meKey) : -1;
  if (i > 0) list.unshift(...list.splice(i, 1));
  return list;
}

/** meKey = 当前用户的 personKey;那一个头像 me=true(卡片上画强调色描边)。 */
export function participantStack(refs: readonly RequirementPersonRef[] | undefined, people: readonly RequirementPerson[], max = 3, meKey?: string | null): { shown: { key: string; name: string; known: boolean; kind: 'user' | 'node'; me: boolean }[]; more: number; all: string } {
  const list = participantsMeFirst(refs, meKey).map(r => ({ key: personKey(r), kind: r.kind, me: !!meKey && personKey(r) === meKey, ...personDisplay(r, people) }));
  return { shown: list.slice(0, max), more: Math.max(0, list.length - max), all: list.map(p => `${p.name}（${p.me ? '我' : p.kind === 'user' ? '人类' : 'Agent'}）`).join('、') };
}

/** 卡片 / 列表上的负责人文字:负责人在前、负责 Agent 在后。旧 Hub(owner undefined)显示旧的 assignee 文本。 */
export function ownerLabel(item: Pick<Requirement, 'owner' | 'assignee' | 'agentOwner'>, people: readonly RequirementPerson[]): string {
  if (item.owner === undefined) return item.assignee || '未分配';
  const names = [item.owner, item.agentOwner].filter((r): r is RequirementPersonRef => !!r).map(r => personName(r, people));
  return names.length ? names.join(' · ') : '未分配';
}

/** 卡片上的头像:人类在前、Agent 在后(没有的那个不画)。 */
export function roleAvatars(item: Pick<Requirement, 'owner' | 'agentOwner'>, people: readonly RequirementPerson[]): { role: 'owner' | 'agent'; ref: RequirementPersonRef; name: string }[] {
  const out: { role: 'owner' | 'agent'; ref: RequirementPersonRef; name: string }[] = [];
  if (item.owner) out.push({ role: 'owner', ref: item.owner, name: personName(item.owner, people) });
  if (item.agentOwner) out.push({ role: 'agent', ref: item.agentOwner, name: personName(item.agentOwner, people) });
  return out;
}

// ── 列表视图排序 ─────────────────────────────────────────────────────────

export type SortKey = 'seq' | 'title' | 'owner' | 'priority' | 'due' | 'status' | 'project' | 'created' | 'updated';
export interface SortSpec { key: SortKey; dir: 'asc' | 'desc' }
export const DEFAULT_SORT: SortSpec = { key: 'status', dir: 'asc' };

const PRIORITY_RANK: Record<ReqPriority, number> = { high: 0, normal: 1, low: 2, lowest: 3 };
const COLUMN_RANK: Record<ReqColumn, number> = { pool: 0, doing: 1, done: 2, abandoned: 3 };

/** 点表头:同一列再点一次反向,换列从升序开始。 */
export const nextSort = (cur: SortSpec, key: SortKey): SortSpec =>
  cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' };

/**
 * 列表排序。空期限永远在最后(不论升降序);同值按看板里的顺序(优先级 → 期限 → 新建时间)兜底,
 * 所以排序稳定、刷新不跳行。
 */
export function sortRows(items: readonly Requirement[], sort: SortSpec, people: readonly RequirementPerson[] = [], projects: readonly RequirementProject[] = []): Requirement[] {
  const projectRank = (id: string | null | undefined): number => {
    if (!id) return Number.MAX_SAFE_INTEGER;
    const i = activeProjects(projects).findIndex(p => p.id === id);
    return i < 0 ? Number.MAX_SAFE_INTEGER - 1 : i;
  };
  const sign = sort.dir === 'asc' ? 1 : -1;
  const base = (a: Requirement, b: Requirement) =>
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || dueCmp(a.due, b.due)
    || (a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const primary = (a: Requirement, b: Requirement): number => {
    switch (sort.key) {
      case 'created': case 'updated': {
        // 「更新时间」按卡片上显示的那个时刻排:Hub 给 last_event(评论比 updated_at 新)就用它(#506)。
        const av = sort.key === 'created' ? taskTimestamp(a.createdAt) : activityTime(a);
        const bv = sort.key === 'created' ? taskTimestamp(b.createdAt) : activityTime(b);
        if (av === null || bv === null) return av === bv ? 0 : av === null ? 1 : -1;
        return (av - bv) * sign;
      }
      case 'seq': return seqCmp(a, b, sign);
      case 'title': return a.name.localeCompare(b.name, 'zh') * sign;
      case 'owner': {
        const an = a.owner || a.agentOwner || (a.owner === undefined && a.assignee) ? ownerLabel(a, people) : '';
        const bn = b.owner || b.agentOwner || (b.owner === undefined && b.assignee) ? ownerLabel(b, people) : '';
        if (an === bn) return 0;
        if (!an) return 1;
        if (!bn) return -1;
        return an.localeCompare(bn, 'zh') * sign;
      }
      case 'priority': return (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) * sign;
      case 'due': {
        if (!a.due || !b.due) return a.due === b.due ? 0 : !a.due ? 1 : -1;
        return dueCmp(a.due, b.due) * sign;
      }
      case 'status': return (COLUMN_RANK[a.column] - COLUMN_RANK[b.column]) * sign;
      case 'project': {
        const ra = projectRank(a.projectId), rb = projectRank(b.projectId);
        if (ra === rb) return 0;
        // 没有项目的永远在最后(同空期限)
        if (!a.projectId) return 1;
        if (!b.projectId) return -1;
        return (ra - rb) * sign;
      }
    }
  };
  return [...items].sort((a, b) => primary(a, b) || base(a, b));
}

// ── 期限 ─────────────────────────────────────────────────────────────────

/** 本地日期 YYYY-MM-DD(不是 UTC:北京时间早上 7 点的「今天」在 UTC 还是昨天)。 */
export function localToday(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const dayNumber = (ymd: string): number => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

export type DueTone = 'none' | 'overdue' | 'today' | 'tomorrow' | 'normal';

/** 两个期限比先后:全天 = 本地那天结束,时刻按真实时刻;空的永远在后。 */
export function dueCmp(a: string, b: string, clock: Clock = systemClock): number {
  const ka = dueInstant(a, clock) ?? Number.POSITIVE_INFINITY;
  const kb = dueInstant(b, clock) ?? Number.POSITIVE_INFINITY;
  return ka === kb ? 0 : ka < kb ? -1 : 1;
}

/**
 * 期限的显示:文字 + 色调 + 完整值(悬停提示)。已完成的卡片不算逾期(做完了就不再催)。
 * 到期提示(due-marker.ts,#493):今天到期 / 明天到期 / 已逾期 N 天(全天按本地日期;时刻按真实时刻,不足一天写小时 / 分钟)。
 * 时刻在今天 / 明天时带上本地时刻:「今天 18:30 到期」。其余显示日期:全天「10月5日」,时刻「10-05 09:00」。
 */
export function dueInfo(due: string, today: string, column: ReqColumn = 'pool', now: number = Date.now(), clock: Clock = systemClock): { label: string; tone: DueTone; full: string } {
  if (!due || !dueOk(due)) return { label: '', tone: 'none', full: '' };
  const full = formatDueFull(due, clock);
  const marker = dueMarker({ due, column }, { now, clock, today });
  let hm = '';
  let plain: string;
  if (isDateTime(due)) {
    const local = dueToLocal(due, clock)!;
    const [y, m, d] = local.date.split('-').map(Number);
    hm = formatTime(local.time!);
    const dayDiff = dayNumber(local.date) - dayNumber(today);
    plain = dayDiff === 0 ? `今天 ${hm}` : dayDiff === 1 ? `明天 ${hm}`
      : y === Number(today.slice(0, 4)) ? `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ${hm}` : `${local.date} ${hm}`;
  } else {
    const [y, m, d] = due.split('-').map(Number);
    plain = y === Number(today.slice(0, 4)) ? `${m}月${d}日` : `${y}年${m}月${d}日`;
  }
  if (marker.kind === 'none') return { label: plain, tone: 'normal', full };
  return { label: dueMarkerLabel(marker, hm), tone: marker.kind, full };
}

// ── 拖动(只在桌面:鼠标)──────────────────────────────────────────────────

export const DRAG_THRESHOLD = 5;

export type DragState =
  | { phase: 'idle' }
  | { phase: 'pressing'; id: string; from: ReqColumn; x0: number; y0: number }
  | { phase: 'dragging'; id: string; from: ReqColumn; x: number; y: number; over: ReqColumn | null };

export type DragEvent =
  | { type: 'down'; id: string; from: ReqColumn; x: number; y: number }
  | { type: 'move'; x: number; y: number; over: ReqColumn | null }
  | { type: 'up'; over?: ReqColumn | null }
  | { type: 'cancel' };

export interface DragStep {
  state: DragState;
  /** 松手落到另一列:调用方把卡片移过去(乐观更新 + PATCH)。 */
  commit?: { id: string; from: ReqColumn; to: ReqColumn };
  /** 这次按下变成了拖动:松手后那一下点击不能再打开详情。 */
  swallowClick?: boolean;
}

export const DRAG_IDLE: DragState = { phase: 'idle' };

/**
 * 按下 → 移动超过 5px 才算拖(否则是点击)→ 松手。落在原列、落在列外、Esc 都是取消,不写 Hub。
 */
export function dragReduce(state: DragState, ev: DragEvent): DragStep {
  switch (ev.type) {
    case 'down':
      return { state: { phase: 'pressing', id: ev.id, from: ev.from, x0: ev.x, y0: ev.y } };
    case 'move':
      if (state.phase === 'pressing') {
        if (Math.hypot(ev.x - state.x0, ev.y - state.y0) < DRAG_THRESHOLD) return { state };
        return { state: { phase: 'dragging', id: state.id, from: state.from, x: ev.x, y: ev.y, over: ev.over } };
      }
      if (state.phase === 'dragging') return { state: { ...state, x: ev.x, y: ev.y, over: ev.over } };
      return { state };
    case 'up': {
      if (state.phase !== 'dragging') return { state: DRAG_IDLE };
      const over = ev.over === undefined ? state.over : ev.over;
      if (!over || over === state.from) return { state: DRAG_IDLE, swallowClick: true };
      return { state: DRAG_IDLE, commit: { id: state.id, from: state.from, to: over }, swallowClick: true };
    }
    case 'cancel':
      return { state: DRAG_IDLE, swallowClick: state.phase === 'dragging' };
  }
}

/** 拖到某列时,卡片会落在那列(按看板排序)的第几个位置 —— 落点指示线画在这里。 */
export function dropIndex(target: readonly Requirement[], dragged: Requirement, to: ReqColumn): number {
  const moved = { ...dragged, column: to };
  const rest = target.filter(item => item.id !== dragged.id);
  const sorted = columnsOf([...rest, moved]).find(c => c.column === to)!.items;
  return sorted.findIndex(item => item.id === dragged.id);
}

/** 键盘换列:Shift+← / Shift+→(到头不动)。 */
/** 键盘 Shift+←/→ 换列只在 需求池 / 进行中 / 完成 之间走;废弃要显式选(旧 Hub 上也不会误写它)。 */
const FLOW: readonly ReqColumn[] = ['pool', 'doing', 'done'];
export function neighbourColumn(column: ReqColumn, dir: -1 | 1): ReqColumn | null {
  const at = FLOW.indexOf(column);
  if (at < 0) return null;
  const i = at + dir;
  return i >= 0 && i < FLOW.length ? FLOW[i] : null;
}

// ── 乐观移动 ─────────────────────────────────────────────────────────────

/** 先在本地换列(列里的数立刻变),Hub 回来再以 Hub 为准。 */
export const applyMove = (items: readonly Requirement[], id: string, to: ReqColumn): Requirement[] =>
  items.map(item => (item.id === id ? { ...item, column: to } : item));

/** Hub 拒绝:只在卡片还停在我们移过去的那列时退回(期间别处又改过就不覆盖)。 */
export const revertMove = (items: readonly Requirement[], id: string, from: ReqColumn, to: ReqColumn): Requirement[] =>
  items.map(item => (item.id === id && item.column === to ? { ...item, column: from } : item));

/** 换列只发 {column}:不带别的字段,旧 Hub 也认。 */
export const statusPatch = (to: ReqColumn): { column: ReqColumn } => ({ column: to });

// ── 新建 ─────────────────────────────────────────────────────────────────

export interface CreateDraft {
  name: string;
  priority: ReqPriority;
  due: string;
  /** 负责人。分两个角色的 Hub 上只能是人类;旧 Hub 上是唯一的负责人(人类或 Agent)。 */
  owner: RequirementPersonRef | null;
  /** 负责 Agent(只在分两个角色的 Hub 上有)。 */
  agentOwner: RequirementPersonRef | null;
  /** 参与人(只能是人类;只在认识参与人的 Hub 上发,空 = 不发)。 */
  participants?: RequirementPersonRef[];
  /** 项目(只在有项目的 Hub 上发)。 */
  projectId: string | null;
  /** 父需求(建子需求时预填)。 */
  parentId?: string | null;
  /** 标签(只在有 tags 的 Hub 上发;空 = 不发)。 */
  tags?: string[];
  column: ReqColumn;
}

export const emptyDraft = (column: ReqColumn = 'pool'): CreateDraft => ({ name: '', priority: 'normal', due: '', owner: null, agentOwner: null, projectId: null, column });

/** 两个角色各自能选哪一种人:负责人 = 人类,负责 Agent = 节点;旧 Hub 的单一负责人两种都行。 */
export const roleKinds = (role: 'owner' | 'agent', twoRoles: boolean): ('user' | 'node')[] =>
  !twoRoles ? ['user', 'node'] : role === 'owner' ? ['user'] : ['node'];

export type DraftCheck =
  | { ok: true; name: string; due: string }
  | { ok: false; field: 'name' | 'due'; message: string };

export function checkDraft(d: Pick<CreateDraft, 'name' | 'due'>): DraftCheck {
  const name = d.name.trim();
  if (!name) return { ok: false, field: 'name', message: '先写任务标题' };
  if (name.length > 80) return { ok: false, field: 'name', message: '标题最多 80 个字' };
  const due = d.due.trim();
  if (!dueOk(due)) return { ok: false, field: 'due', message: '日期写成 2026-10-01,或留空' };
  return { ok: true, name, due };
}

/** 开始日期的校验(同期限的形状);合法或留空 = null。 */
export const startError = (start: string): string | null => (dueOk(start.trim()) ? null : '日期写成 2026-10-01,或留空');

/**
 * 发给 POST /api/requirements 的字段。负责人只带稳定身份 {kind,id}(#484):显示名不是身份,
 * 旧的 assignee 文本永远是空串。
 */
export function createInput(d: CreateDraft, twoRoles = false): { name: string; priority: ReqPriority; assignee: ''; due: string; column: ReqColumn; owner?: RequirementPersonRef; agentOwner?: RequirementPersonRef; participants?: RequirementPersonRef[]; projectId?: string; parentId?: string; tags?: string[] } | null {
  const c = checkDraft(d);
  if (!c.ok) return null;
  // 分两个角色的 Hub 上,种类不对的一侧不发(Hub 会 400);旧 Hub 没有负责 Agent。
  const owner = d.owner && (!twoRoles || d.owner.kind === 'user') ? d.owner : null;
  const agent = twoRoles && d.agentOwner && d.agentOwner.kind === 'node' ? d.agentOwner : null;
  // 参与人:人类和 Agent({kind:'node',id})都收,按 personKey 去重,只带 {kind,id}。
  const participants = [...new Map((d.participants ?? []).filter(r => (r.kind === 'user' || r.kind === 'node') && r.id).map(r => [personKey(r), { kind: r.kind, id: r.id }] as const)).values()];
  return {
    name: c.name,
    priority: REQ_PRIORITIES.includes(d.priority) ? d.priority : 'normal',
    assignee: '',
    due: c.due,
    column: d.column,
    ...(owner ? { owner: { kind: owner.kind, id: owner.id } } : {}),
    ...(agent ? { agentOwner: { kind: agent.kind, id: agent.id } } : {}),
    ...(participants.length ? { participants } : {}),
    ...(d.projectId ? { projectId: d.projectId } : {}),
    ...(d.parentId ? { parentId: d.parentId } : {}),
    ...(d.tags?.length ? { tags: [...d.tags] } : {}),
  };
}

// ── 详情编辑 ─────────────────────────────────────────────────────────────

export interface EditDraft { name: string; priority: ReqPriority; due: string; start: string; owner: RequirementPersonRef | null; agentOwner: RequirementPersonRef | null; description: string; projectId: string | null; parentId: string | null }

export const editDraftOf = (item: Requirement): EditDraft => ({
  name: item.name,
  priority: item.priority,
  due: item.due,
  start: item.start ?? '',
  owner: item.owner ? { kind: item.owner.kind, id: item.owner.id } : null,
  agentOwner: item.agentOwner ? { kind: item.agentOwner.kind, id: item.agentOwner.id } : null,
  description: item.description ?? '',
  projectId: item.projectId ?? null,
  parentId: item.parentId ?? null,
});

/** PATCH 请求体(字段名就是线上的名字)。 */
export type EditPatch = { tags?: string[]; issues?: { url: string; title?: string }[]; name?: string; priority?: ReqPriority; due?: string; start?: string; owner?: RequirementPersonRef | null; agent_owner?: RequirementPersonRef | null; description?: string; checklist?: ChecklistItem[]; project_id?: string | null; parent_id?: string | null };

/**
 * 只提交改过的字段;没改返回 null(保存按钮不可用)。旧 Hub(owner undefined)不提交负责人 ——
 * 那里没有稳定身份,写进去 Hub 也不认。
 */
export function editPatch(item: Requirement, d: EditDraft): EditPatch | null {
  const patch: EditPatch = {};
  const name = d.name.trim();
  if (name !== item.name) patch.name = name;
  if (d.priority !== item.priority) patch.priority = d.priority;
  const due = d.due.trim();
  if (due !== item.due) patch.due = due;
  // 开始(甘特图):只有带 start 字段的 Hub(capability start_date)才发;旧 Hub 行里没有这个字段。
  if (item.start !== undefined && d.start.trim() !== item.start) patch.start = d.start.trim();
  if (item.owner !== undefined) {
    const before = item.owner ? personKey(item.owner) : '';
    const after = d.owner ? personKey(d.owner) : '';
    if (before !== after) patch.owner = d.owner ? { kind: d.owner.kind, id: d.owner.id } : null;
  }
  if (item.agentOwner !== undefined) {
    const before = item.agentOwner ? personKey(item.agentOwner) : '';
    const after = d.agentOwner ? personKey(d.agentOwner) : '';
    if (before !== after) patch.agent_owner = d.agentOwner ? { kind: d.agentOwner.kind, id: d.agentOwner.id } : null;
  }
  // 描述跟标题一起走「保存修改」;旧 Hub(没有 description 字段)不发。
  if (item.description !== undefined && d.description.replace(/\r\n?/g, '\n') !== item.description) patch.description = d.description.replace(/\r\n?/g, '\n');
  if (item.projectId !== undefined && (d.projectId ?? null) !== (item.projectId ?? null)) patch.project_id = d.projectId ?? null;
  // 母任务:旧 Hub(行里没有 parent_id)不发。
  if (item.parentId !== undefined && (d.parentId ?? null) !== (item.parentId ?? null)) patch.parent_id = d.parentId ?? null;
  return Object.keys(patch).length ? patch : null;
}

/**
 * Hub 回来的那一行有没有真的带上我们改的字段。更老的 Hub 会忽略不认识的字段、照样回 200 ——
 * 那不是「保存成功」,要告诉用户这个 Hub 还不能改。
 */
export function patchApplied(row: Requirement, patch: EditPatch): boolean {
  if (patch.tags !== undefined && JSON.stringify(row.tags) !== JSON.stringify(patch.tags)) return false;
  if (patch.issues !== undefined && JSON.stringify(row.issues?.map(i => `https://github.com/${i.repo}/issues/${i.number}`)) !== JSON.stringify(patch.issues.map(i => i.url))) return false;
  if (patch.name !== undefined && row.name !== patch.name) return false;
  if (patch.priority !== undefined && row.priority !== patch.priority) return false;
  if (patch.due !== undefined && row.due !== patch.due) return false;
  if (patch.start !== undefined && row.start !== patch.start) return false;
  if (patch.owner !== undefined) {
    const want = patch.owner ? personKey(patch.owner) : '';
    const got = row.owner ? personKey(row.owner) : '';
    if (want !== got) return false;
  }
  if (patch.agent_owner !== undefined) {
    const want = patch.agent_owner ? personKey(patch.agent_owner) : '';
    const got = row.agentOwner ? personKey(row.agentOwner) : '';
    if (want !== got) return false;
  }
  if (patch.description !== undefined && row.description !== patch.description) return false;
  if (patch.project_id !== undefined && (row.projectId ?? null) !== patch.project_id) return false;
  if (patch.parent_id !== undefined && (row.parentId ?? null) !== patch.parent_id) return false;
  if (patch.checklist !== undefined && JSON.stringify(row.checklist?.map(i => i.id)) !== JSON.stringify(patch.checklist.map(i => i.id))) return false;
  return true;
}

// ── 子任务 ───────────────────────────────────────────────────────────────
// 勾选走单项接口(setChecklistItemOnHub);增、删、排序改整张清单(PATCH {checklist})。
// 上限与 Hub 一致:最多 100 项,每项 1–500 字。

export const CHECKLIST_MAX_ITEMS = 100;
export const CHECKLIST_TEXT_MAX = 500;
export const DESCRIPTION_MAX = 20_000;

/** 这个 Hub 有没有描述 / 子任务(行里带这两个字段)。 */
export const hasDetails = (item: Pick<Requirement, 'description' | 'checklist'>): boolean => item.description !== undefined && item.checklist !== undefined;

export function checklistProgress(list: readonly ChecklistItem[] | undefined): { done: number; total: number; ratio: number } {
  const total = list?.length ?? 0;
  const done = list?.filter(i => i.done).length ?? 0;
  return { done, total, ratio: total ? done / total : 0 };
}

export const newChecklistId = (rand: () => number = Math.random): string =>
  `ck_${Array.from({ length: 16 }, () => Math.floor(rand() * 16).toString(16)).join('')}`;

/** 加一项(文字折成一行、去空白);空文字、超长、满 100 项 → null。 */
export function addChecklistItem(list: readonly ChecklistItem[], text: string, id: string = newChecklistId()): ChecklistItem[] | null {
  const t = text.replace(/[\r\n]+/g, ' ').trim();
  if (!t || t.length > CHECKLIST_TEXT_MAX || list.length >= CHECKLIST_MAX_ITEMS) return null;
  return [...list, { id, text: t, done: false }];
}

export const setChecklistDone = (list: readonly ChecklistItem[], id: string, done: boolean): ChecklistItem[] =>
  list.map(i => (i.id === id ? { ...i, done } : i));

export const removeChecklistItem = (list: readonly ChecklistItem[], id: string): ChecklistItem[] => list.filter(i => i.id !== id);

/** 把 from 位置的项挪到 to(拖动排序 / Alt+↑↓)。越界或不动 → 原样返回同一个数组。 */
export function moveChecklistItem(list: readonly ChecklistItem[], from: number, to: number): readonly ChecklistItem[] {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** 拖动排序:指针在第几行的上半 / 下半 → 落到第几个位置(按各行的上下沿算)。 */
export function checklistDropIndex(rows: readonly { top: number; bottom: number }[], y: number, from: number): number {
  let to = rows.length - 1;
  for (let i = 0; i < rows.length; i++) {
    const mid = (rows[i].top + rows[i].bottom) / 2;
    if (y < mid) { to = i > from ? i - 1 : i; return Math.max(0, Math.min(rows.length - 1, to)); }
  }
  return to;
}
