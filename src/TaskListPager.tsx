import { Pressable, View } from 'react-native';
import { Text } from './ui-text';
import { useTranslation } from './i18n-react';
import { registerTranslations } from './i18n';
import { colors, radius, spacing } from './theme';
import type { taskListPage } from './task-list-pagination';

registerTranslations({
  'taskPaging.previous': ['上一页', 'Previous'],
  'taskPaging.next': ['下一页', 'Next'],
  'taskPaging.range': ['第 {first}–{last} 条 / 共 {total} 条 · {page}/{pages} 页', '{first}–{last} of {total} · Page {page}/{pages}'],
  'taskPaging.loadedRange': ['第 {first}–{last} 条 / 已加载 {total} 条 · {page}/{pages} 页', '{first}–{last} of {total} loaded · Page {page}/{pages}'],
});
export default function TaskListPager({ page, onPage, partial = false }: { page: ReturnType<typeof taskListPage>; onPage: (page: number) => void; partial?: boolean }) {
  const { t } = useTranslation();
  const button = (key: 'previous' | 'next', disabled: boolean, target: number) => <Pressable testID={`task-page-${key}`} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={() => onPage(target)}
    style={{ minHeight: 40, paddingHorizontal: spacing.md, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, opacity: disabled ? .4 : 1 }}>
    <Text style={{ color: colors.text }}>{t(`taskPaging.${key}`)}</Text>
  </Pressable>;
  return <View testID="task-list-pagination" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}>
    <Text testID="task-page-range" accessibilityLiveRegion="polite" style={{ color: colors.textMuted, flexShrink: 1 }}>{t(partial ? 'taskPaging.loadedRange' : 'taskPaging.range', { first: page.total ? page.start + 1 : 0, last: page.end, total: page.total, page: page.page + 1, pages: page.pages })}</Text>
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>{button('previous', page.page === 0, page.page - 1)}{button('next', page.page + 1 >= page.pages, page.page + 1)}</View>
  </View>;
}
