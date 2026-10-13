// 任务看板的省流读(2026-09-30,「连接较慢 · 数据可能稍有延迟」)。纯模块·可单测。
//
// 看板每 15 s 读一次整张需求表:生产 431 张卡 1 MB(gzip 243 KB),描述正文占 626 KB。Hub ≥ preview.75 给了两个能力:
//   - list_summary:view=summary 的列表不带描述正文和子任务条目(gzip 42 KB),打开一张卡再按 id 读全文;
//   - changes:changes=1&updated_since=… 只回之后改过的卡(含归档的)+ 删掉的 id + 下次用的 server_time。
// 只在 Hub 声明了能力时才用(capabilities 来自上一次列表响应);旧 Hub(.73 / .74)照旧每次读完整列表,一字不差。
//
// 口径与整读相同:
//   - 精简行并进来时,手里同一张卡、updatedAt 没变的全文(描述 / 子任务)原样留着 —— 卡没改过,全文就还是那份;
//   - 增量:按 id 覆盖、删掉 deleted 里的、归档了的移出看板、新的加进来,再按 Hub 列表的顺序(createdAt 新→旧,同刻按 id)排;
//     父卡的子需求计数 Hub 不会因为子卡变了而重发,这里按手里的整张表重算(整张表 = 没被截断,见 planBoardRead);
//   - 能力、权限这类增量表达不了的变化,靠每 BOARD_RESYNC_MS 整读一次兜底。
import type { ChecklistItem, Requirement } from './requirements-model';

/** 连续增量最多这么久,之后整读一次(看得见权限变化、子需求计数与 Hub 对齐)。 */
export const BOARD_RESYNC_MS = 10 * 60_000;

export type BoardSyncState = {
  /** 下次增量用的 updated_since(Hub 的 server_time,或整读结果里最新的 updatedAt);null = 只能整读。 */
  cursor: string | null;
  /** 最近一次整读成功的时刻(本机时钟,只用来算「多久没整读了」)。 */
  fullAt: number;
};

export type BoardReadPlan = { kind: 'changes'; since: string } | { kind: 'list'; summary: boolean };

/** 这一次怎么读。截断的表(Hub 一次最多给 500 张)不走增量:手里不是整张表,重算子需求计数会错。 */
export function planBoardRead(capabilities: readonly string[], truncated: boolean, sync: BoardSyncState, now: number): BoardReadPlan {
  const summary = capabilities.includes('list_summary');
  if (summary && capabilities.includes('changes') && !truncated && sync.cursor && now - sync.fullAt < BOARD_RESYNC_MS) {
    return { kind: 'changes', since: sync.cursor };
  }
  return { kind: 'list', summary };
}

const instant = (value: string | null | undefined): number => {
  if (!value) return Number.NaN;
  // 旧库里的「YYYY-MM-DD HH:MM:SS」是 UTC。
  return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value);
};

/** 整读之后的游标:表里最新的 updatedAt(Hub 的时钟)。之后改的卡 updatedAt 只会 ≥ 它(Hub 用 >=)。没有可用的时间 → null。 */
export function cursorAfterList(items: readonly Requirement[]): string | null {
  let best = Number.NaN;
  for (const item of items) {
    const t = instant(item.updatedAt ?? item.createdAt);
    if (Number.isFinite(t) && !(t <= best)) best = t;
  }
  return Number.isFinite(best) ? new Date(best).toISOString() : null;
}

/** 这张卡手里有没有全文(描述 + 子任务)。 */
export const hasFullText = (item: Requirement): boolean => item.description !== undefined && item.checklist !== undefined;

/** 精简行换进来:同一张卡、updatedAt 没变,就把手里的全文带上(并去掉 summary 标记)。 */
function carryFullText(prev: Requirement | undefined, next: Requirement): Requirement {
  if (!next.summary || !prev || !hasFullText(prev) || (prev.updatedAt ?? null) !== (next.updatedAt ?? null)) return next;
  const { summary: _s, hasDescription: _h, checklistCount: _c, ...rest } = next;
  return { ...rest, description: prev.description, checklist: prev.checklist };
}

// Poll responses are fresh JSON objects even when nothing changed. Compare all
// exposed data, not just updatedAt: permissions, comments and child counts may
// change without advancing that timestamp. Retain unchanged rows and the array
// so useSyncExternalStore subscribers do not redraw an idle board every poll.
function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every(key => Object.prototype.hasOwnProperty.call(b, key)
    && sameData((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

function retainRow(prev: Requirement | undefined, next: Requirement): Requirement {
  const carried = carryFullText(prev, next);
  return prev && sameData(prev, carried) ? prev : carried;
}

function retainList(prev: Requirement[], next: Requirement[]): Requirement[] {
  return prev.length === next.length && next.every((row, i) => row === prev[i]) ? prev : next;
}

/** 一整张列表(精简或完整)换进来。 */
export function mergeListRows(prev: Requirement[], incoming: readonly Requirement[]): Requirement[] {
  const byId = new Map(prev.map(item => [item.id, item]));
  return retainList(prev, incoming.map(next => retainRow(byId.get(next.id), next)));
}

/** Hub 列表的顺序:createdAt 新→旧,同刻按 id 降序。 */
function hubOrder(a: Requirement, b: Requirement): number {
  const ta = instant(a.createdAt), tb = instant(b.createdAt);
  if (ta !== tb && Number.isFinite(ta) && Number.isFinite(tb)) return tb - ta;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** 子需求计数按手里的整张表重算(与 Hub 同口径:未归档的子卡数 / 其中在「完成」列的)。 */
export function recountChildren(items: readonly Requirement[]): Requirement[] {
  const counts = new Map<string, { total: number; done: number }>();
  for (const item of items) {
    // 废弃的子卡不算进度(与 Hub #2490 同口径:total 里减掉)。
    if (!item.parentId || item.archived || item.column === 'abandoned') continue;
    const c = counts.get(item.parentId) ?? { total: 0, done: 0 };
    c.total += 1;
    if (item.column === 'done') c.done += 1;
    counts.set(item.parentId, c);
  }
  return items.map(item => {
    if (item.children === undefined) return item;
    const c = counts.get(item.id) ?? { total: 0, done: 0 };
    return item.children.total === c.total && item.children.done === c.done ? item : { ...item, children: c };
  });
}

/** 一次增量并进来。changed 里 archived 的卡 = 移出看板(平常的列表不含归档的卡)。 */
export function applyChanges(prev: Requirement[], changed: readonly Requirement[], deleted: readonly string[]): Requirement[] {
  const gone = new Set(deleted);
  const byId = new Map(prev.map(item => [item.id, item]));
  for (const next of changed) {
    if (next.archived) { byId.delete(next.id); continue; }
    byId.set(next.id, retainRow(byId.get(next.id), next));
  }
  for (const id of gone) byId.delete(id);
  return retainList(prev, recountChildren([...byId.values()].sort(hubOrder)));
}

/** 卡片上的子任务进度:有全文按条目算,精简行用 Hub 给的计数。 */
export function checklistCounts(item: Pick<Requirement, 'checklist' | 'checklistCount'>): { total: number; done: number } {
  if (item.checklist) return { total: item.checklist.length, done: item.checklist.filter((i: ChecklistItem) => i.done).length };
  return item.checklistCount ?? { total: 0, done: 0 };
}

/** 这张打开的卡要不要按 id 补读全文。 */
export const needsFullText = (item: Requirement | null | undefined): boolean => !!item && !!item.summary && !hasFullText(item);
