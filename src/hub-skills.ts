// Hub 级技能目录的**纯**展示逻辑（#1473 / #909）。
//
// 抽出来的理由不是好看：这批断言要能在没有 DOM / 没有网络的情况下跑。
// 三态必须分清 —— 不支持(404/501) ≠ 没权限(403) ≠ 真的空目录。
// 把「不支持」渲染成空列表，就等于告诉用户「这个 Hub 没有技能」，
// 而事实是这个 Hub 还没有这个接口；两者要修的机器完全不同。
import type { HubSkillRow, HubSkillsResult } from './api';

export type SkillsView =
  | { kind: 'loading' }
  | { kind: 'error'; text: string; retryable: boolean }
  | { kind: 'empty'; text: string }
  | { kind: 'list'; rows: HubSkillRow[] };

export const HUB_SKILLS_EMPTY = '这个网络还没有已发布的技能';
export const HUB_SKILLS_EMPTY_PENDING = '这个网络还没有已发布的技能（也没有待审提交）';

/** 把一次读取结果折成四态之一。`includePending` 只影响空态措辞：
 *  reviewer 打开了待审开关时，「空」的含义比默认更宽。 */
export function hubSkillsView(result: HubSkillsResult | null, includePending = false): SkillsView {
  if (result === null) return { kind: 'loading' };
  if (result.ok) {
    if (result.skills.length === 0) {
      const text = includePending && result.reviewer ? HUB_SKILLS_EMPTY_PENDING : HUB_SKILLS_EMPTY;
      // 普通成员即使请求了 includePending，服务端也不会给出 pending；
      // 所以这句话只在 reviewer 时才有意义。
      return { kind: 'empty', text };
    }
    return { kind: 'list', rows: result.skills };
  }
  return { kind: 'error', text: result.error, retryable: !result.unsupported };
}

/** 状态角标。pending 必须是**第三态**，不能和 published 共用一种颜色：
 *  待审技能还没有被任何人批准，把它渲染成「已上架」会让审核形同虚设。 */
export function hubSkillBadge(status: string): { text: string; tone: 'ok' | 'warn' | 'muted' } {
  if (status === 'published') return { text: '已发布', tone: 'ok' };
  if (status === 'pending') return { text: '待审', tone: 'warn' };
  if (status === 'rejected') return { text: '已驳回', tone: 'muted' };
  return { text: status || '未知', tone: 'muted' };
}

/** 一行副标题：版本 · 来源 · 更新时间。缺字段不补假值，直接省略。 */
export function hubSkillSubtitle(row: HubSkillRow): string {
  const parts: string[] = [];
  if (row.version) parts.push(`v${row.version}`);
  if (row.source_alias) parts.push(`来自 ${row.source_alias}`);
  else if (row.source_type) parts.push(row.source_type);
  if (row.updated_at) parts.push(String(row.updated_at).slice(0, 16));
  return parts.join(' · ');
}

/** reviewer 才显示「显示待审」开关；普通成员请求了也没用（服务端会拒绝降级）。 */
export function showPendingToggle(result: HubSkillsResult | null): boolean {
  return !!(result && result.ok && result.reviewer);
}
