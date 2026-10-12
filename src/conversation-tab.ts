// 会话列表顶部的「全部 / 未读 N」(board #449,Vincent 2026-10-02 照飞书「消息 / 未读 52 / 标记 1」;「标记」暂缓)。
// 纯逻辑,无 RN 依赖 —— conversation-tab.test.ts 直接 import。
//
// 🔴 未读从哪来:不自己算。agent 的数是 agentUnreadCounts(托盘角标 / 「新消息」组同一个函数)给的那份,
//    人员是 peopleRows 已有的 unread;「标为未读」(conversation-flags)的行也算未读 —— 它在行上就是一个红点,
//    用户标它就是为了在未读里找到它(微信同款)。所以 N、未读视图里的行、行上的红点,是同一个判据。
//
// N = 有未读的**会话数**(不是消息总数):3 个会话各 10 条 → 未读 3。只数列表里真的会出现的会话
//     (visible 的 agent + 人员),已删掉 / 被隐藏的 alias 即使还挂着数也不进 N —— 否则 N 和点进去看到的行数对不上。
//
// 「读完就离开未读视图,但不能在用户正看着的时候把它抽走」:keep 里的会话(当前打开的那一个)照留,
// 离开它(选了别的 / 关掉)后下一次计算自然消失。手机上打开会话时列表本身不在屏上,回来时它已读 → 不在。

import { isWorking } from './agents-list';

export type ConversationTab = 'all' | 'unread' | 'working';

export const CONVERSATION_TABS: readonly ConversationTab[] = ['all', 'unread', 'working'];

/** 存储值 → tab。认不出的一律当「全部」(别因为一个坏值让用户以为会话都没了)。 */
export function parseConversationTab(raw: unknown): ConversationTab {
  return raw === 'unread' || raw === 'working' ? raw : 'all';
}

export type UnreadSource = {
  /** agentUnreadCounts 的结果:alias → 未读数(只含 > 0 的)。 */
  counts: Readonly<Record<string, number>>;
  /** 「标为未读」的 alias(conversation-flags.manualUnread)。 */
  manualUnread?: readonly string[];
};

export function isUnreadConversation(alias: string, src: UnreadSource): boolean {
  return (src.counts[alias] ?? 0) > 0 || !!src.manualUnread?.includes(alias);
}

/** 「未读 N」里的 N:列表里会出现的会话中,有未读的那些的个数。 */
export function unreadConversationCount(
  aliases: readonly string[],
  src: UnreadSource,
  people: readonly { unread: number }[] = [],
): number {
  let n = 0;
  const seen = new Set<string>();
  for (const a of aliases) {
    if (seen.has(a)) continue;
    seen.add(a);
    if (isUnreadConversation(a, src)) n++;
  }
  for (const p of people) if (p.unread > 0) n++;
  return n;
}

/** 分段里显示的数:0 不显示(只写「未读」),超过 99 写 99+(与行上的角标同一个上限)。 */
export function formatTabCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  return n > 99 ? '99+' : String(Math.floor(n));
}

/**
 * 按 tab 过滤 agent 会话。「全部」原样返回(同一个数组,不复制 —— 下游 useMemo 依赖不该因此变)。
 * 「未读」只留有未读的 + keep(正打开着的那一个,读完也不抽走)。
 */
export function applyConversationTab<T extends { alias: string; status?: string }>(
  rows: T[],
  tab: ConversationTab,
  src: UnreadSource,
  keep?: string | null,
): T[] {
  // Execution state comes from the live Hub status, never unread/queue/task text.
  // Unlike unread, an open idle conversation must not remain in this view.
  if (tab === 'working') return rows.filter(r => isWorking({ status: r.status ?? '' }));
  if (tab !== 'unread') return rows;
  return rows.filter(r => r.alias === keep || isUnreadConversation(r.alias, src));
}

/** 人员行同理:未读视图只留有私信未读的人 + 正打开着的那一个。 */
export function applyConversationTabToPeople<T extends { username: string; unread: number }>(
  rows: T[],
  tab: ConversationTab,
  keep?: string | null,
): T[] {
  if (tab === 'working') return [];
  if (tab !== 'unread') return rows;
  return rows.filter(p => p.unread > 0 || p.username === keep);
}
