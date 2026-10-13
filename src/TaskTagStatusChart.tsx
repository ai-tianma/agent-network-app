import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './ui-text';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-tag-status';
import { colors, mixHex, radius, spacing } from './theme';
import type { ReqColumn } from './requirements-model';
import { TAG_STATES, type TagSnapshot } from './task-tag-status';

export default function TaskTagStatusChart({ snapshot, phone, onPick }: { snapshot: TagSnapshot; phone: boolean; onPick: (tag: string | null, state: ReqColumn) => void }) {
  useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState(0);
  const compact = phone || width < 680;
  const buckets = expanded ? snapshot.buckets : snapshot.buckets.slice(0, 10);
  // Keep saturated semantic colors for urgent controls; this chart uses quiet
  // theme-derived fills and neutral text. Recompute on render for theme changes.
  const tone = { pool: mixHex(colors.blocked, colors.card, 0.45), doing: mixHex(colors.accent, colors.card, 0.25), done: mixHex(colors.accent, colors.textMuted, 0.7), abandoned: mixHex(colors.textMuted, colors.card, 0.45) };
  const max = Math.max(1, ...snapshot.buckets.map(r => r.total));
  const title = (tag: string | null) => tag ?? t('tagStats.untagged');
  const stateTitle = (k: ReqColumn) => t(`tagStats.${k}`);
  return <View testID="dash-tag-status" onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{ gap: spacing.sm }}>
    <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{t('tagStats.title')}</Text>
    <Text testID="dash-tag-scope" style={{ color: colors.textSecondary, fontSize: 12 }}>{t(snapshot.complete ? 'tagStats.full' : 'tagStats.partial', { n: snapshot.total })}</Text>
    <View style={{ flexDirection: 'row', justifyContent: compact ? 'flex-start' : 'flex-end', paddingTop: spacing.sm }}>
      {TAG_STATES.map(k => <View key={k} style={{ width: compact ? undefined : 64, flex: compact ? 1 : undefined, flexDirection: 'row', alignItems: 'center', justifyContent: compact ? 'flex-start' : 'center', gap: 5 }}><View style={{ width: 6, height: 6, borderRadius: radius.pill, backgroundColor: tone[k] }} /><Text dense style={{ color: colors.textSecondary, fontSize: 11 }}>{stateTitle(k)}</Text></View>)}
    </View>
    {!buckets.length ? <Text testID="dash-tag-empty" style={{ color: colors.textMuted }}>{t('tagStats.empty')}</Text> : null}
    <View testID={phone ? 'dash-tag-horizontal' : 'dash-tag-columns'}>
      {buckets.map((r, i) => <View key={JSON.stringify(r.tag)} testID={`dash-tag-row-${i}`} style={{ flexDirection: compact ? 'column' : 'row', alignItems: compact ? 'stretch' : 'center', columnGap: spacing.md, paddingVertical: compact ? spacing.sm : 2, borderTopWidth: 1, borderTopColor: colors.border }}>
        <View style={{ width: compact ? '100%' : 148, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
          <Text testID={`dash-tag-name-${i}`} numberOfLines={1} style={{ color: colors.text, fontSize: 13, fontWeight: '500', flex: 1 }} selectable>{title(r.tag)}</Text>
          <Text testID={`dash-tag-total-${i}`} style={{ color: colors.textSecondary, fontSize: 12, fontVariant: ['tabular-nums'] }}>{r.total}</Text>
        </View>
        <View testID={`dash-tag-track-${i}`} style={{ flex: compact ? undefined : 1, minWidth: 0, height: 44, flexDirection: 'row', alignItems: 'center' }}>
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, height: 10, borderRadius: radius.inline, backgroundColor: colors.subtleFill }} />
          {TAG_STATES.filter(k => r[k] > 0).map(k => <Pressable key={k} testID={`dash-tag-bar-${i}-${k}`} accessibilityRole="button" accessibilityLabel={t('tagStats.open', { tag: title(r.tag), status: stateTitle(k), n: r[k] })} onPress={() => onPick(r.tag, k)} style={{ width: `${r[k] / max * 100}%` as `${number}%`, minWidth: 6, flexShrink: 1, height: 44, justifyContent: 'center' }}>
            <View testID={`dash-tag-fill-${i}-${k}`} style={{ height: 10, borderRadius: radius.inline, backgroundColor: tone[k] }} />
          </Pressable>)}
        </View>
        <View testID={`dash-tag-counts-${i}`} style={{ flexDirection: 'row', width: compact ? '100%' : 256 }}>
          {TAG_STATES.map(k => <Pressable key={k} testID={`dash-tag-count-${i}-${k}`} accessibilityRole="button" accessibilityLabel={t('tagStats.open', { tag: title(r.tag), status: stateTitle(k), n: r[k] })} onPress={() => onPick(r.tag, k)} style={({ pressed }) => ({ flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center', alignItems: compact ? 'flex-start' : 'center', borderRadius: radius.inline, backgroundColor: pressed ? colors.rowHover : 'transparent' })}>
            {compact ? <Text dense numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 10 }}>{stateTitle(k)}</Text> : null}
            <Text style={{ color: r[k] ? colors.text : colors.textMuted, fontSize: 13, fontWeight: r[k] ? '500' : '400', fontVariant: ['tabular-nums'] }}>{r[k]}</Text>
          </Pressable>)}
        </View>
      </View>)}
    </View>
    {snapshot.buckets.length > 10 ? <Pressable testID="dash-tag-expand" accessibilityRole="button" onPress={() => setExpanded(v => !v)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.accent }}>{t(expanded ? 'tagStats.collapse' : 'tagStats.expand', { n: snapshot.buckets.length })}</Text></Pressable> : null}
    <Text style={{ color: colors.textMuted, fontSize: 12 }}>{t('tagStats.note')}</Text>
  </View>;
}
