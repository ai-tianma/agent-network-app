import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './ui-text';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-tag-status';
import { colors, radius, spacing, themeMode } from './theme';
import type { ReqColumn } from './requirements-model';
import { TAG_STATES, type TagSnapshot } from './task-tag-status';

export default function TaskTagStatusChart({ snapshot, phone, onPick }: { snapshot: TagSnapshot; phone: boolean; onPick: (tag: string | null, state: ReqColumn) => void }) {
  useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState(0);
  const compact = phone || width < 600;
  const buckets = expanded ? snapshot.buckets : snapshot.buckets.slice(0, 10);
  // Shenming's reviewed chart palette: active work stands out, completed work
  // recedes. Status fills carry no text; neutral figures retain theme contrast.
  const dark = themeMode() === 'dark';
  const tone = dark ? { pool: '#c9944a', doing: '#6f9bcb', done: '#4a5563', abandoned: '#8e96a1' } : { pool: '#d9a55b', doing: '#4f7cac', done: '#aebbcb', abandoned: '#7c838d' };
  const max = Math.max(1, ...snapshot.buckets.map(r => r.total));
  const title = (tag: string | null) => tag ?? t('tagStats.untagged');
  const stateTitle = (k: ReqColumn) => t(`tagStats.${k}`);
  return <View testID="dash-tag-status" onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{ gap: spacing.sm }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }}>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{t('tagStats.title')}</Text>
      {!snapshot.complete ? <Text testID="dash-tag-scope" accessibilityLabel={t('tagStats.partial', { n: snapshot.total })} style={{ color: dark ? '#e8c77a' : '#8a6d24', backgroundColor: dark ? '#3a3222' : '#fbf3dd', fontSize: 11, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill }}>{t('tagStats.partialBadge', { n: snapshot.total })}</Text> : null}
    </View>
    {snapshot.complete ? <Text testID="dash-tag-scope" style={{ color: colors.textSecondary, fontSize: 12 }}>{t('tagStats.full', { n: snapshot.total })}</Text> : null}
    <Text style={{ color: colors.textMuted, fontSize: 11 }}>{t('tagStats.note')}</Text>
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
            <View testID={`dash-tag-fill-${i}-${k}`} style={{ height: 10, borderRadius: radius.mark, borderRightWidth: 1, borderRightColor: colors.card, backgroundColor: tone[k] }} />
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
  </View>;
}
