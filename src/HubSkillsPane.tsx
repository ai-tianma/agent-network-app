// Hub 服务器管理 → SKILLS（#1473 / #909）。
//
// 这一页以前是 `BackendPendingIntegration` 的演示面板：种子数据 + 内存里的
// 假保存，`hub-scope-demo.ts` 自己的注释就是「Hub 这些写接口还没接通」。
// 现在接真实的 GET /api/skills（服务端只回元数据，不回 SKILL.md 正文）。
//
// 四态显式渲染（loading / 不支持 / 没权限 / 空 / 列表）：
// 把「不支持」画成空列表，会让人以为这个 Hub 没有技能，而事实是它还没这个接口。
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { fetchHubSkills, type HubConfig, type HubSkillsResult } from './api';
import { hubSkillBadge, hubSkillSubtitle, hubSkillsView, showPendingToggle } from './hub-skills';
import { colors, onThemeChange, radius, spacing, type, weight } from './theme';

const makeStyles = () => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.xs,
  },
  title: { color: colors.text, fontSize: type.title, fontWeight: weight.strong },
  scroll: { flex: 1 },
  scrollInner: { padding: spacing.xl, gap: spacing.md },
  row: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: spacing.md, gap: spacing.xs, backgroundColor: colors.card },
  rowTitle: { color: colors.text, fontSize: type.body, fontWeight: weight.strong },
  sub: { color: colors.textSecondary, fontSize: type.small },
  desc: { color: colors.textSecondary, fontSize: type.small },
  badge: { fontSize: type.small, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.mark, overflow: 'hidden' },
  badgeOk: { color: colors.text, backgroundColor: colors.tonalBg },
  badgeWarn: { color: colors.text, backgroundColor: colors.border },
  badgeMuted: { color: colors.textSecondary, backgroundColor: colors.groupedRow },
  toggle: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  toggleText: { color: colors.accent, fontSize: type.small },
  error: { color: colors.text, fontSize: type.body },
  hint: { color: colors.textSecondary, fontSize: type.small },
  retry: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
});

export default function HubSkillsPane({ cfg }: { cfg: HubConfig }) {
  const [result, setResult] = useState<HubSkillsResult | null>(null);
  const [includePending, setIncludePending] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [, forceTheme] = useState(0);
  useEffect(() => onThemeChange(() => forceTheme(n => n + 1)), []);
  const styles = makeStyles();

  useEffect(() => {
    let cancel = false;
    setResult(null);
    void fetchHubSkills(cfg, { includePending }).then(r => { if (!cancel) setResult(r); });
    return () => { cancel = true; };
  }, [cfg.serverUrl, cfg.token, cfg.networkId, includePending, reloadKey]);

  const retry = useCallback(() => setReloadKey(k => k + 1), []);
  const view = hubSkillsView(result, includePending);

  return (
    <View testID="hub-skills-pane" style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>SKILLS</Text>
        <Text style={styles.hint}>Hub 上的技能目录。待审技能只有管理员能看到。</Text>
        {showPendingToggle(result) ? (
          <Pressable testID="hub-skills-pending-toggle" style={styles.toggle} onPress={() => setIncludePending(v => !v)}>
            <Text style={styles.toggleText}>{includePending ? '只看已发布' : '显示待审'}</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollInner}>
        {view.kind === 'loading' ? <ActivityIndicator testID="hub-skills-loading" /> : null}
        {view.kind === 'empty' ? <Text testID="hub-skills-empty" style={styles.sub}>{view.text}</Text> : null}
        {view.kind === 'error' ? (
          <View style={{ gap: spacing.sm }}>
            <Text testID="hub-skills-error" style={styles.error}>{view.text}</Text>
            {view.retryable ? (
              <Pressable testID="hub-skills-retry" style={styles.retry} onPress={retry}>
                <Text style={styles.toggleText}>重试</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {view.kind === 'list' ? view.rows.map(row => {
          const badge = hubSkillBadge(row.status);
          const badgeStyle = badge.tone === 'ok' ? styles.badgeOk : badge.tone === 'warn' ? styles.badgeWarn : styles.badgeMuted;
          return (
            <View key={row.skill_id} testID={`hub-skill-${row.slug}`} style={styles.row}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
                <Text style={styles.rowTitle}>{row.name || row.slug}</Text>
                <Text style={[styles.badge, badgeStyle]}>{badge.text}</Text>
              </View>
              {row.description ? <Text style={styles.desc}>{row.description}</Text> : null}
              <Text style={styles.sub}>{hubSkillSubtitle(row)}</Text>
            </View>
          );
        }) : null}
      </ScrollView>
    </View>
  );
}
