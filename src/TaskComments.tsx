// 任务详情里的「评论」(#474,Hub ≥ preview.90):Agent 经 MCP requirements_comment、人经 REST 发的评论 / 进展,
// 存在 Hub 的任务动态里(GET /api/requirements/events?requirement_id=,kind = comment,正文 new.text)。
// 这里只读:按时间从旧到新,最多先显示最近 COMMENTS_SHOWN 条,更早的点一下展开。
// 旧 Hub 没有评论(或没有动态接口):读不到 / 没有评论就什么都不画,详情和以前一样。
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './ui-text';
import CommentBody from './comment-body';
import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-tasks';
import { colors, spacing, type as typeScale, weight } from './theme';
import type { HubConfig } from './api';
import type { RequirementPerson } from './requirement-people';
import { fetchRequirementEvents } from './requirements-hub';
import { parseEvents } from './task-activity-model';
import { cardComments, COMMENTS_SHOWN, type CardComment } from './task-comments-model';
import { personDisplay } from './i18n-task-presentation';
import { usePoll } from './usePoll';

/** 详情开着时多久再读一次(评论不改任务本身,看板的轮询带不回来)。 */
const COMMENTS_POLL_MS = 30_000;

export default function TaskComments({ cfg, requirementId, people, onLoadPeople }: { cfg: HubConfig; requirementId: string; people: readonly RequirementPerson[]; onLoadPeople?: () => unknown }) {
  useTranslation();
  const [comments, setComments] = useState<CardComment[]>([]);
  const [all, setAll] = useState(false);
  const load = useCallback(async () => {
    try {
      setComments(cardComments(parseEvents(await fetchRequirementEvents(cfg, { requirementId, limit: 200 })).events));
    } catch { /* 旧 Hub / 读不到:不画 */ }
  }, [cfg, requirementId]);
  usePoll(load, COMMENTS_POLL_MS, [load]);
  // 看板只在有卡带负责人时才读成员;没人负责的卡上,评论者会显示成「未知成员」。缺谁就补读一次(每次打开最多一次)。
  const askedPeople = useRef(false);
  const missing = comments.some(c => c.actor && !people.some(p => p.kind === c.actor!.kind && p.id === c.actor!.id));
  useEffect(() => {
    if (!missing || askedPeople.current || !onLoadPeople) return;
    askedPeople.current = true;
    void onLoadPeople();
  }, [missing, onLoadPeople]);
  if (!comments.length) return null;
  const hidden = all ? 0 : Math.max(0, comments.length - COMMENTS_SHOWN);
  return (
    <View style={{ gap: spacing.sm }} testID="req-comments">
      <Text style={{ color: colors.textSecondary, fontSize: typeScale.small, fontWeight: weight.medium }}>{tr('comments.title')}</Text>
      {hidden ? (
        <Pressable accessibilityRole="button" onPress={() => setAll(true)} hitSlop={6} testID="req-comments-earlier">
          <Text style={{ color: colors.accent, fontSize: typeScale.small }}>{tr('comments.earlier', { n: hidden })}</Text>
        </Pressable>
      ) : null}
      {comments.slice(hidden).map(c => {
        const who = c.actor ? personDisplay(c.actor, people).name : tr('act.unknown');
        return (
          <View key={c.id} style={{ gap: 2, paddingLeft: spacing.sm, borderLeftWidth: 2, borderLeftColor: colors.border }} testID={`req-comment-${c.id}`}>
            <Text style={{ color: colors.textSecondary, fontSize: typeScale.small }} numberOfLines={1}>
              {who}{c.actor?.kind === 'node' ? ` · ${tr('act.agent')}` : ''} · {c.at}
            </Text>
            <CommentBody text={c.text} testID={`req-comment-text-${c.id}`} />
          </View>
        );
      })}
    </View>
  );
}
