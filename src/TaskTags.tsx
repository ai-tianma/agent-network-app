import { useEffect, useRef, useState } from 'react';
import { ACCEPT_COLUMNS_HEADERS } from './requirement-columns';
import { Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { colors, radius } from './theme';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-task-tags';
import './i18n-tag-status';
import { normalizeTags } from './requirement-tags';
import type { Requirement } from './requirements-model';
import type { EditPatch } from './task-board-model';
import type { HubConfig } from './api';
import { appFetch } from './app-fetch';
import { noteTagsUsed, setManagingTags, setSideMenu, setTaskFilter, useTaskBoard } from './task-board-store';
import { pointerUi } from './pointer-ui';
import { canManageTags, catalogFromHub, localTagCounts, tagSuggestions } from './task-tag-catalog';

export function TaskTagFilter() {
  useTranslation();
  const [open, setOpen] = useState(false);
  const items = useTaskBoard(s => s.items), filter = useTaskBoard(s => s.filter);
  const tags = [...new Set(items.flatMap(item => item.tags ?? []))];
  const colorsOf = useTaskBoard(s => s.tagCatalog?.colors);
  const manage = useTaskBoard(s => canManageTags(s.capabilities, s.tagCatalog));
  return <View style={{ maxWidth: 260 }}>
    <Pressable testID="task-tags-filter" accessibilityRole="button" onPress={() => setOpen(!open)} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}><Text numberOfLines={1} style={{ color: filter.tag || filter.untagged ? colors.accent : colors.textMuted }}>{filter.untagged ? t('tagStats.untagged') : filter.tag || t('tags.title')}</Text></Pressable>
    {open ? <ScrollView horizontal style={{ maxHeight: 52 }} contentContainerStyle={{ gap: 6 }}>{['', ...tags].map(tag => <Pressable key={tag} testID={`task-tags-pick-${tag || 'all'}`} accessibilityRole="button" onPress={() => { setTaskFilter({ ...filter, tag, untagged: false }); setOpen(false); }} onLongPress={!pointerUi() ? (tag && manage ? e => { setOpen(false); setSideMenu({ kind: 'tag', key: tag, x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, touch: true }); } : undefined) : undefined} style={{ minHeight: 44, paddingHorizontal: 10, justifyContent: 'center', backgroundColor: colors.subtleFill, borderRadius: radius.control }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>{tag && colorsOf?.[tag] ? <View style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colorsOf[tag] }} /> : null}<Text style={{ color: colors.text }}>{tag || t('tags.all')}</Text></View></Pressable>)}
      {/* 手机没有左栏:「管理标签」放在标签筛选的最后(同「管理项目」在项目筛选里)。 */}
      {manage ? <Pressable testID="task-tags-manage" accessibilityRole="button" onPress={() => { setOpen(false); setManagingTags(true); }} style={{ minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' }}><Text style={{ color: colors.accent }}>{t('tags.manage')}</Text></Pressable> : null}
    </ScrollView> : null}
  </View>;
}

export function TaskTagChips({ tags }: { tags?: readonly string[] }) {
  // 设过颜色的标签带一个同色小点(颜色来自 Hub 的标签目录;没设 / 旧 Hub = 与原来一样的灰底)。
  const colorsOf = useTaskBoard(s => s.tagCatalog?.colors);
  return <View testID="task-tag-chips" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, maxWidth: '100%' }}>
    {tags?.map(tag => <View key={tag} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.subtleFill, borderRadius: radius.control, paddingHorizontal: 7, paddingVertical: 3, maxWidth: '100%' }}>{colorsOf?.[tag] ? <View style={{ width: 6, height: 6, borderRadius: radius.pill, backgroundColor: colorsOf[tag] }} /> : null}<Text numberOfLines={1} style={{ flexShrink: 1, color: colors.textSecondary, fontSize: 11 }}>{tag}</Text></View>)}
  </View>;
}

/**
 * 标签输入 + 补全(新建和详情共用):已有标签按「前缀 → 包含、用量多的在前」排,回车 / 点「添加」建新标签,
 * 点候选直接加上。choices 来自 Hub 的标签目录(没有就是当前列表里出现过的)。
 */
export function TagInputField({ tags, choices, counts, disabled, onAdd, testPrefix }: {
  tags: readonly string[];
  choices: readonly string[];
  counts: Readonly<Record<string, number>>;
  disabled?: boolean;
  onAdd: (tag: string) => void;
  testPrefix: string;
}) {
  useTranslation();
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  const suggestions = tagSuggestions(choices, counts, tags, input, 8);
  const add = (tag: string) => { if (!tag.trim()) return; onAdd(tag); setInput(''); };
  return <View style={{ gap: 4 }}>
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <TextInput testID={`${testPrefix}-tag-input`} accessibilityLabel={t('tags.input')} placeholder={t('tags.input')} placeholderTextColor={colors.textMuted} value={input} onChangeText={setInput} editable={!disabled} onFocus={() => setFocused(true)} onBlur={() => setTimeout(() => setFocused(false), 150)} onSubmitEditing={() => add(input)} maxLength={20} style={{ flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 10, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, color: colors.text }} />
      <Pressable testID={`${testPrefix}-tag-add`} accessibilityRole="button" disabled={disabled || !input.trim()} onPress={() => add(input)} style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', opacity: disabled || !input.trim() ? 0.5 : 1 }}><Text style={{ color: colors.accent }}>{t('tags.add')}</Text></Pressable>
    </View>
    {(focused || input) && suggestions.length ? <View testID={`${testPrefix}-tag-options`} accessibilityLabel={t('tags.suggest')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {suggestions.map(tag => <Pressable key={tag} testID={`${testPrefix}-tag-option-${tag}`} accessibilityRole="button" disabled={disabled} onPress={() => add(tag)} style={{ minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, maxWidth: '100%' }}><Text numberOfLines={1} style={{ flexShrink: 1, color: colors.text }}>{tag}</Text>{counts[tag] ? <Text style={{ color: colors.textMuted, fontSize: 11 }}>{counts[tag]}</Text> : null}</Pressable>)}
    </View> : null}
  </View>;
}

/** 补全用的标签目录:Hub 的(含用量)优先,读不到就用当前列表里出现过的。 */
export function useTagChoices(): { choices: string[]; counts: Record<string, number> } {
  const catalog = useTaskBoard(s => s.tagCatalog);
  const items = useTaskBoard(s => s.items);
  if (catalog) return { choices: catalog.tags, counts: catalog.counts };
  const local = localTagCounts(items);
  return { choices: [...local.keys()], counts: Object.fromEntries(local) };
}

export default function TaskTags({ cfg, item, onSave }: { cfg: HubConfig; item: Requirement; onSave: (patch: EditPatch) => Promise<string | null> }) {
  useTranslation();
  const [fetched, setFetched] = useState<{ tags: string[]; counts: Record<string, number> } | null>(null);
  const [error, setError] = useState(''), [loadFailed, setLoadFailed] = useState(false), [saving, setSaving] = useState(false);
  const busy = useRef(false), live = useRef(true);
  const board = useTaskBoard(s => s.tagCatalog);
  const local = useTagChoices();
  useEffect(() => {
    live.current = true;
    // 看板已经读到了目录就不再单独读(详情单独打开时 —— 比如弹出窗口 —— 才读)。
    if (board || item.tags === undefined) return () => { live.current = false; };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    void appFetch(`${cfg.serverUrl}/api/requirements/tags${cfg.networkId ? `?network_id=${encodeURIComponent(cfg.networkId)}` : ''}`, { headers: { Authorization: `Bearer ${cfg.token}`, ...ACCEPT_COLUMNS_HEADERS }, signal: ctrl.signal })
      .then(async res => { if (!res.ok) throw new Error(); const cat = catalogFromHub(await res.json()); if (live.current) setFetched(cat ? { tags: cat.tags, counts: cat.counts } : { tags: [], counts: {} }); })
      .catch(() => { if (live.current) setLoadFailed(true); }).finally(() => clearTimeout(timer));
    return () => { live.current = false; ctrl.abort(); clearTimeout(timer); };
  }, [cfg.serverUrl, cfg.token, cfg.networkId, item.id, !!board]);
  const tags = item.tags ?? [];
  const choices = board ? board.tags : [...new Set([...(fetched?.tags ?? []), ...local.choices])];
  const counts = board ? board.counts : { ...local.counts, ...(fetched?.counts ?? {}) };
  const save = async (next: string[]) => {
    if (busy.current || item.tags === undefined) return;
    const valid = normalizeTags(next);
    if (!valid) { setError('tags.invalid'); return; }
    busy.current = true; setSaving(true); setError('');
    try {
      const failed = await onSave({ tags: valid });
      if (!live.current) return;
      if (failed) setError(failed === 'invalid_tags' ? 'tags.invalid' : 'tags.failed');
      else { noteTagsUsed(valid); setFetched(cur => (cur ? { ...cur, tags: [...new Set([...cur.tags, ...valid])] } : cur)); }
    } catch { if (live.current) setError('tags.failed'); }
    finally { busy.current = false; if (live.current) setSaving(false); }
  };
  return <View testID="req-tags" style={{ gap: 8 }}>
    <Text style={{ color: colors.textMuted, fontSize: 12 }}>{t('tags.title')}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{tags.map(tag => <Pressable key={tag} disabled={saving} accessibilityRole="button" accessibilityLabel={t('tags.remove', { tag })} onPress={() => void save(tags.filter(x => x !== tag))} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 10, borderRadius: radius.control, backgroundColor: colors.subtleFill, maxWidth: '100%' }}><Text numberOfLines={1} style={{ color: colors.text }}>{tag} ×</Text></Pressable>)}</View>
    {item.tags === undefined ? <Text style={{ color: colors.textMuted }}>{t('tags.unsupported')}</Text> : (
      <TagInputField tags={tags} choices={choices} counts={counts} disabled={saving} onAdd={tag => void save([...tags, tag])} testPrefix="req" />
    )}
    {loadFailed ? <Text style={{ color: colors.textMuted }}>{t('tags.loadingFailed')}</Text> : null}
    {saving ? <Text style={{ color: colors.textMuted }}>{t('tags.saving')}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: colors.failed }}>{t(error)}</Text> : null}
  </View>;
}
