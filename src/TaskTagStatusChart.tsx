import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from './ui-text';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-tag-status';
import { colors, radius, spacing } from './theme';
import type { ReqColumn } from './requirements-model';
import { TAG_STATES, type TagSnapshot } from './task-tag-status';

export default function TaskTagStatusChart({ snapshot, phone, onPick }: { snapshot: TagSnapshot; phone: boolean; onPick: (tag: string | null, state: ReqColumn) => void }) {
  useTranslation();
  const [expanded, setExpanded] = useState(false);
  const buckets = expanded ? snapshot.buckets : snapshot.buckets.slice(0, 10);
  const tone = { pool: colors.blocked, doing: colors.running, done: colors.accent, abandoned: colors.textMuted };
  const max = Math.max(1, ...buckets.map(r => r.total));
  const title = (tag: string | null) => tag ?? t('tagStats.untagged');
  const stateTitle = (k: ReqColumn) => t(`tagStats.${k}`);
  return <View testID="dash-tag-status" style={{ gap: spacing.md }}>
    <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{t('tagStats.title')}</Text>
    <Text testID="dash-tag-scope" style={{ color: colors.textSecondary, fontSize: 12 }}>{t(snapshot.complete ? 'tagStats.full' : 'tagStats.partial', { n: snapshot.total })}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
      {TAG_STATES.map(k => <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: tone[k] }} /><Text style={{ color: colors.textSecondary, fontSize: 12 }}>{stateTitle(k)}</Text></View>)}
    </View>
    {!buckets.length ? <Text testID="dash-tag-empty" style={{ color: colors.textMuted }}>{t('tagStats.empty')}</Text> : null}
    <ScrollView horizontal={!phone} testID={phone ? 'dash-tag-horizontal' : 'dash-tag-columns'} contentContainerStyle={{ flexDirection: phone ? 'column' : 'row', gap: spacing.md, minWidth: '100%' }}>
      {buckets.map((r, i) => <View key={JSON.stringify(r.tag)} testID={`dash-tag-row-${i}`} style={{ width: phone ? '100%' : 118, gap: 6 }}>
        <Text testID={`dash-tag-name-${i}`} style={{ color: colors.text, fontSize: 12 }} selectable>{title(r.tag)}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{r.total}</Text>
        <View style={{ height: phone ? 32 : 180, flexDirection: phone ? 'row' : 'column-reverse', justifyContent: 'flex-start', backgroundColor: colors.subtleFill, borderRadius: radius.inline, overflow: 'hidden' }}>
          {TAG_STATES.filter(k => r[k] > 0).map(k => <Pressable key={k} testID={`dash-tag-bar-${i}-${k}`} accessibilityRole="button" accessibilityLabel={t('tagStats.open', { tag: title(r.tag), status: stateTitle(k), n: r[k] })} onPress={() => onPick(r.tag, k)} style={{ backgroundColor: tone[k], ...(phone ? { width: `${r[k] / max * 100}%` as `${number}%`, height: '100%' as const } : { height: `${r[k] / max * 100}%` as `${number}%`, width: '100%' as const }) }} />)}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
          {TAG_STATES.map(k => <Pressable key={k} testID={`dash-tag-count-${i}-${k}`} accessibilityRole="button" accessibilityLabel={t('tagStats.open', { tag: title(r.tag), status: stateTitle(k), n: r[k] })} onPress={() => onPick(r.tag, k)} style={{ minHeight: 36, paddingHorizontal: 4, justifyContent: 'center' }}><Text style={{ color: tone[k], fontSize: 12 }}>{stateTitle(k)} {r[k]}</Text></Pressable>)}
        </View>
      </View>)}
    </ScrollView>
    {snapshot.buckets.length > 10 ? <Pressable testID="dash-tag-expand" accessibilityRole="button" onPress={() => setExpanded(v => !v)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.accent }}>{t(expanded ? 'tagStats.collapse' : 'tagStats.expand', { n: snapshot.buckets.length })}</Text></Pressable> : null}
    <Text style={{ color: colors.textMuted, fontSize: 12 }}>{t('tagStats.note')}</Text>
  </View>;
}
