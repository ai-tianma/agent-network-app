// 节点列表的纯逻辑层(分组 / 过滤 / 排序)—— 无 RN 依赖,bun/node 可直跑。
// 从 App.tsx 的 AgentsScreen 抽出,配 agents-list.test.ts。
//
// 抽出的动机:这段逻辑决定 199 个节点在手机上以什么顺序、分到哪个组、
// 搜什么词能命中 —— 全是可以用纯数据钉住的行为,却混在一个 RN 组件的
// useMemo 里没法测。抽出来之后,排序改动才有可执行的断言。

import type { Session } from './api';

/** 组名 = 别名的团队前缀。逐字保留自 App.tsx 的原实现(#1094 分组)。 */
export function teamOf(alias: string): string {
  const a = (alias || '').trim();
  if (!a) return '其他';
  // explicit separator wins (e.g. "team/role" → "team")
  const seg = a.split(/[\s/_\-:|·]+/)[0];
  if (seg && seg !== a) return seg;
  // coarse team = leading 2 chars: the fleet's <team><role> aliases share a
  // 2-char team prefix (通信龙 / 通信N站马 / 通信测试牛 → 通信; 工程马 → 工程;
  // N站牛 → N站). Keeps groups few + findable rather than one-per-agent.
  return a.length <= 2 ? a : a.slice(0, 2);
}

export const isOffline = (s: Session) => s.status === 'offline';
export const isWorking = (s: Pick<Session, 'status'>) => s.status === 'working' || s.status === 'running';

export type AgentSection = {
  title: string;
  data: Session[];
  online: number;
  total: number;
};

/** 匹配器:默认按子串匹配;调用方可注入拼音匹配器替换它。 */
export type Matcher = (text: string, filter: string) => boolean;
export const substringMatch: Matcher = (text, filter) =>
  text.toLowerCase().includes(filter.toLowerCase());

/**
 * 组内排序键。
 *
 * 🔴 与 web `/nodes` 的关系:web 的比较器是
 *   `pin > online(SSE + 60s 迟滞) > lastActivityAt`
 * 三级的数据源在 web **全是浏览器本地状态**:
 *   - pin           = localStorage('anet_chat_pin_v1')
 *   - online        = SSE 实时态 + lastOnlineRef 的 60 秒迟滞 (R29)
 *   - lastActivityAt= useChatUnread(),**这台设备**最后看到消息的时间
 * App 一个都没有对应物,所以这里是**语义等价的移植,不是同一份数据**:
 *   - pinned        : 桌面端 localStorage('anet_chat_pin_v1')
 *   - online        : 用 status 判定,可由调用方注入 60s 迟滞(recentlyOnline)
 *   - recency       : 用**服务端** session.updated_at,语义 ≠ web 的本地活动时间
 * 不要在别处把这段写成"和 web 一致"——那会让人拿 web 的行为去推断 App 的。
 */
export type SortContext = {
  /** 桌面端注入持久化的置顶集合；移动端省略。 */
  pinned?: (alias: string) => boolean;
  /** R29 语义的迟滞:60s 内出现过在线即视为在线。默认只看当前 status。 */
  recentlyOnline?: (alias: string) => boolean;
  /**
   * 组内按行上显示的那个活动时间排序(agent-row-model.ts rowActivity:最后一条消息 /
   * 当前任务的派发时间),而不是 session.updated_at(心跳每次都会顶它)。
   * 只有 sortByActivity 为 true 且给了 activityAt 时才生效;组间顺序不受影响。
   */
  sortByActivity?: boolean;
  /** 行的活动时间(ms);0 = 没有活动数据,排在有活动的行之后。 */
  activityAt?: (alias: string) => number;
};

/**
 * 按活动时间排序 —— 已打开(owner 2026-09-26「就先根据那个时间进行活跃吧,然后也把这个时间显示出来」)。
 * 关掉只需改这一行:AgentsScreen 把它传给 SortContext.sortByActivity。
 */
export const SORT_BY_ACTIVITY = true;

const ts = (s: Session): number => {
  const t = Date.parse(s.updated_at ?? '');
  return Number.isFinite(t) ? t : 0;
};

/**
 * 组内比较器。
 *   sortByActivity 关:pinned > online > updated_at > 别名字母序(原规则)。
 *   sortByActivity 开:pinned > 有时间的行在前 > 活动时间新的在前 > online > 别名字母序。
 *     没有时间的行排在有时间的行之后,保持原规则去掉 updated_at 那一级(online > 别名)——
 *     updated_at 每次心跳都会动,留着它心跳就会让这些行来回跳。
 */
export function compareInTeam(a: Session, b: Session, ctx: SortContext = {}): number {
  const pin = (s: Session) => (ctx.pinned?.(s.alias) ? 1 : 0);
  const on = (s: Session) =>
    ctx.recentlyOnline ? (ctx.recentlyOnline(s.alias) ? 1 : 0) : (isOffline(s) ? 0 : 1);
  if (ctx.sortByActivity && ctx.activityAt) {
    // 没有时间 = 0,降序里天然排在所有有时间的行之后。
    const at = (s: Session) => { const v = ctx.activityAt!(s.alias); return Number.isFinite(v) && v > 0 ? v : 0; };
    return (
      pin(b) - pin(a) ||
      at(b) - at(a) ||
      on(b) - on(a) ||
      a.alias.localeCompare(b.alias)
    );
  }
  return (
    pin(b) - pin(a) ||
    on(b) - on(a) ||
    ts(b) - ts(a) ||
    a.alias.localeCompare(b.alias)
  );
}

export const NEW_MESSAGES_TITLE = '新消息';
export const PINNED_TITLE = '置顶';

/**
 * 「新消息」组的输入(Vincent 2026-09-25「有消息的那些节点,你要置顶」)。
 *
 * 🔴 count 必须来自 agent-unread-counts.ts 的 agentUnreadCounts —— 托盘角标用的同一个函数。
 *    这里只收一个查询函数,不自己算未读,免得列表和托盘数出两组会话。
 */
export type UnreadContext = {
  /** 该会话的未读数;> 0 即进「新消息」组。 */
  count: (alias: string) => number;
  /** 该会话最近一条消息的时间(ms);读不到(0/缺省)时退回 session.updated_at。 */
  lastMessageAt?: (alias: string) => number;
};

/** 「新消息」组内:最近一条消息新的在前 → 别名字母序(稳定,不随轮询抖动)。 */
export function compareNewMessages(a: Session, b: Session, u: UnreadContext): number {
  const at = (s: Session) => u.lastMessageAt?.(s.alias) || ts(s);
  return at(b) - at(a) || a.alias.localeCompare(b.alias);
}

/**
 * 用户正在列表上移动指针/滚动时,「新消息」组的输入先按住上一份,停手后再换成最新的 ——
 * 否则行会在光标底下跳走(点到的不是想点的那个)。没被按住或还没有上一份时直接用最新的。
 */
export function holdWhileActive<T>(prev: T | null, live: T, active: boolean): T {
  return active && prev !== null ? prev : live;
}

/**
 * 分组 + 过滤 + 排序。组间顺序保持原有规则(有人在线的团队优先 → 在线人数
 * 多者优先 → 组名字母序),只有**组内**顺序改用 compareInTeam。
 */
export function buildSections(
  sessions: Session[],
  query: string,
  opts: { match?: Matcher; sort?: SortContext; unread?: UnreadContext } = {},
): AgentSection[] {
  const q = query.trim();
  const match = opts.match ?? substringMatch;
  const filtered = q ? sessions.filter(s => match(s.alias, q)) : sessions.slice();
  // 「新消息」组:有未读的会话整体上浮到最顶(在「置顶」之上),**搬走**而不是复制;
  // 读完(未读→0)下一次计算时自然回到原来的组。搜索时不浮动,保持搜索结果原有的顺序。
  const floating = !q && opts.unread ? filtered.filter(s => opts.unread!.count(s.alias) > 0) : [];
  if (floating.length) floating.sort((a, b) => compareNewMessages(a, b, opts.unread!));
  const floatSet = new Set(floating.map(s => s.alias));
  const rest = floatSet.size ? filtered.filter(s => !floatSet.has(s.alias)) : filtered;
  const pinned = opts.sort?.pinned
    ? rest.filter(s => opts.sort!.pinned!(s.alias)).sort((a, b) => compareInTeam(a, b, opts.sort))
    : [];
  const unpinned = pinned.length ? rest.filter(s => !opts.sort!.pinned!(s.alias)) : rest;

  const groups = new Map<string, Session[]>();
  for (const s of unpinned) {
    const key = teamOf(s.alias);
    const bucket = groups.get(key);
    if (bucket) bucket.push(s);
    else groups.set(key, [s]);
  }

  const grouped = [...groups.entries()]
    .map(([title, items]) => {
      items.sort((a, b) => compareInTeam(a, b, opts.sort));
      const online = items.filter(s => !isOffline(s)).length;
      return { title, data: items, online, total: items.length };
    })
    .sort(
      (a, b) =>
        (b.online > 0 ? 1 : 0) - (a.online > 0 ? 1 : 0) ||
        b.online - a.online ||
        a.title.localeCompare(b.title),
    );
  const head: AgentSection[] = [];
  if (floating.length) head.push(sectionOf(NEW_MESSAGES_TITLE, floating));
  if (pinned.length) head.push(sectionOf(PINNED_TITLE, pinned));
  return head.length ? [...head, ...grouped] : grouped;
}

const sectionOf = (title: string, data: Session[]): AgentSection =>
  ({ title, data, online: data.filter(s => !isOffline(s)).length, total: data.length });

export const countShown = (sections: AgentSection[]): number =>
  sections.reduce((n, g) => n + g.data.length, 0);

// ── collapsible group headers (0.2.106) ──
//
// A header tap folds its group; the folded titles are persisted per device
// (agent-list-prefs.ts). Two groups never fold:
//   - 新消息: folding it would hide exactly the rows that want attention;
//   - any group while searching: a search shows every match, folded or not.

export type ShownSection = AgentSection & { collapsed: boolean; collapsible: boolean };

export const isCollapsible = (title: string): boolean => title !== NEW_MESSAGES_TITLE;

export function applyCollapsed(
  sections: AgentSection[],
  collapsed: readonly string[],
  query: string,
): ShownSection[] {
  const searching = query.trim() !== '';
  const folded = new Set(collapsed);
  return sections.map(s => {
    const collapsible = !searching && isCollapsible(s.title);
    const isFolded = collapsible && folded.has(s.title);
    return { ...s, data: isFolded ? [] : s.data, collapsed: isFolded, collapsible };
  });
}

/** Toggle one title in the folded set (returns a new array; order is not meaningful). */
export function toggleCollapsed(collapsed: readonly string[], title: string): string[] {
  return collapsed.includes(title) ? collapsed.filter(t => t !== title) : [...collapsed, title];
}

/** Persisted value → folded titles. Anything malformed reads as "nothing folded". */
export function parseCollapsed(raw: unknown): string[] {
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return []; }
  }
  return Array.isArray(v) ? [...new Set(v.filter((t): t is string => typeof t === 'string' && t !== ''))] : [];
}
