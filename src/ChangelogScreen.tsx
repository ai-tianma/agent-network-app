// 设置 → 关于 → 更新日志(owner 2026-09-30「关于里面…看看我之前的更新日志…可以复制，方便我复制去发那个小红书
// 啊，或者发那个公众号推文」)。数据与格式在 changelog-model.ts / changelog-source.ts(纯逻辑、有测试),这里只画。
//
// 两套画法(桌面 ≠ 手机):
//   桌面(设置右栏里推进来的一页):顶上一条工具栏(全选 / 清除 · 已选 N 个 · 复制所选),下面每个版本一张卡片 ——
//     左边勾选框、版本号 + 日期、右边「复制」,卡片里按 新功能 / 提速 / 修复 分组列条目。复制 → 居中预览弹窗
//     (格式三选一 + 预览文字 + 复制)。
//   手机(微信式列表页):每个版本一张白色圆角卡片(标题行 v0.2.165 · 日期 · 复制),「选择多个版本」进入多选,
//     底部钉一条「复制所选(N)」;复制 → 整屏预览页,复制后出现「分享…」(系统分享面板)。
// 复制前一律先看预览:格式切换即时重排,复制的就是预览里那段字。
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-changelog';
import DialogFrame from './DialogFrame';
import { colors, onThemeChange, radius, spacing } from './theme';
import { elevated } from './elevation';
import { useModalSafePadding } from './safe-area-runtime';
import { withBasePadding } from './modal-safe-area';
import { APP_VERSION } from './version';
import { CHANGELOG_FORMATS, formatChangelog, isChangelogFormat, releaseDateLabel, type ChangelogEntry, type ChangelogFormat } from './changelog-model';
import { loadCachedChangelog, refreshChangelog } from './changelog-source';

const FORMAT_KEY = 'anet.changelog.format';
const TOAST_MS = 1600;

function readFormat(): ChangelogFormat {
  try {
    const v = (globalThis as any).localStorage?.getItem?.(FORMAT_KEY);
    return isChangelogFormat(v) ? v : 'xhs';
  } catch { return 'xhs'; }
}
function saveFormat(f: ChangelogFormat) {
  try { (globalThis as any).localStorage?.setItem?.(FORMAT_KEY, f); } catch { /* 本次有效 */ }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    // RN Web / 旧 WebView 没有原生剪贴板时退回浏览器 API(同 AccountRowActions copyAccountLine)
    try { await (globalThis as any).navigator?.clipboard?.writeText?.(text); return true; } catch { return false; }
  }
}

/** 系统分享面板:原生都有;网页只有浏览器支持 navigator.share 时才给。 */
const canShare = () => Platform.OS === 'android' || Platform.OS === 'ios' || typeof (globalThis as any).navigator?.share === 'function';

/** 缓存 + 内置先画出来,再联网刷新。 */
export function useChangelog() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [online, setOnline] = useState<boolean | null>(null); // null = 还在拉
  useEffect(() => {
    let alive = true;
    void loadCachedChangelog().then(list => { if (alive) setEntries(prev => (prev.length ? prev : list)); });
    void refreshChangelog().then(r => { if (!alive) return; if (r.entries.length) setEntries(r.entries); setOnline(r.online); })
      .catch(() => { if (alive) setOnline(false); });
    return () => { alive = false; };
  }, []);
  return { entries, online };
}

const formatLabel = (f: ChangelogFormat) => tr(`changelog.format.${f}`);
const dateOf = (e: ChangelogEntry) => releaseDateLabel(e.date);

function FormatSegmented({ value, onChange, testID }: { value: ChangelogFormat; onChange: (f: ChangelogFormat) => void; testID: string }) {
  return (
    <View style={styles.segmented} accessibilityRole="radiogroup" accessibilityLabel={tr('changelog.format')} testID={testID}>
      {CHANGELOG_FORMATS.map(f => {
        const on = f === value;
        return (
          <Pressable
            key={f}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, checked: on }}
            testID={`changelog-format-${f}`}
            onPress={() => onChange(f)}
            style={({ pressed }) => [styles.segment, on && styles.segmentOn, pressed && !on && { opacity: 0.6 }]}
          >
            <Text style={[styles.segmentText, on && styles.segmentTextOn]} numberOfLines={1}>{formatLabel(f)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function PreviewText({ text }: { text: string }) {
  return (
    <View style={styles.previewBox} testID="changelog-preview-text-box">
      <Text style={styles.previewText} selectable testID="changelog-preview-text">{text}</Text>
    </View>
  );
}

/** 一个版本的条目(分组标题 + 圆点列表)。 */
function EntryBody({ entry, phone }: { entry: ChangelogEntry; phone: boolean }) {
  return (
    <View style={phone ? styles.bodyPhone : styles.bodyDesktop}>
      {entry.sections.map(s => (
        <View key={s.kind} style={styles.sectionBlock}>
          <Text style={styles.sectionTitle}>{s.title}</Text>
          {s.items.map((item, i) => (
            <View key={i} style={styles.itemRow}>
              <View style={styles.bullet} />
              <Text style={[styles.itemText, phone && styles.itemTextPhone]}>{item.text}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function Check({ on }: { on: boolean }) {
  return <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={on ? colors.accent : colors.textMuted} />;
}

type PreviewState = { versions: string[] } | null;

function usePicker(entries: ChangelogEntry[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [format, setFormatState] = useState<ChangelogFormat>(readFormat);
  const [preview, setPreview] = useState<PreviewState>(null);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);
  const setFormat = (f: ChangelogFormat) => { setFormatState(f); saveFormat(f); };
  const toggle = (v: string) => setSelected(prev => { const n = new Set(prev); if (n.has(v)) n.delete(v); else n.add(v); return n; });
  const previewEntries = useMemo(() => entries.filter(e => preview?.versions.includes(e.version)), [entries, preview]);
  const text = useMemo(() => formatChangelog(previewEntries, format), [previewEntries, format]);
  const doCopy = async (): Promise<boolean> => {
    const ok = await copyText(text);
    setToast(ok ? tr('changelog.copiedToast', { format: formatLabel(format) }) : tr('changelog.copyFailed'));
    return ok;
  };
  return { selected, setSelected, toggle, format, setFormat, preview, setPreview, text, doCopy, toast, previewEntries };
}

function Toast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <View style={styles.toastLayer} pointerEvents="none">
      <View style={styles.toast} accessibilityLiveRegion="polite" testID="changelog-toast"><Text style={styles.toastText}>{text}</Text></View>
    </View>
  );
}

function OfflineHint({ online, style }: { online: boolean | null; style?: any }) {
  if (online === false) return <Text style={[styles.hint, style]} testID="changelog-offline">{tr('changelog.offline')}</Text>;
  if (online === null) return <View style={[styles.loadingRow, style]}><ActivityIndicator size="small" color={colors.textMuted} /><Text style={styles.hint}>{tr('changelog.loading')}</Text></View>;
  return null;
}

// ── 桌面 ────────────────────────────────────────────────────────────────────────────────────

export function ChangelogDesktop({ entries, online }: { entries: ChangelogEntry[]; online: boolean | null }) {
  useTranslation();
  const pk = usePicker(entries);
  const n = pk.selected.size;
  const allOn = entries.length > 0 && n === entries.length;
  return (
    <View style={styles.desktopRoot} testID="changelog-desktop">
      <View style={styles.toolbar} testID="changelog-toolbar">
        <Pressable accessibilityRole="button" testID="changelog-select-all" onPress={() => pk.setSelected(allOn ? new Set() : new Set(entries.map(e => e.version)))} style={({ pressed, hovered }: any) => [styles.toolBtn, (pressed || hovered) && styles.hover]}>
          <Text style={styles.toolBtnText}>{allOn ? tr('changelog.clear') : tr('changelog.selectAll')}</Text>
        </Pressable>
        <Text style={styles.toolCount} testID="changelog-selected-count">{tr('changelog.selectedCount', { n })}</Text>
        <OfflineHint online={online} style={{ flexShrink: 1 }} />
        <Pressable
          accessibilityRole="button"
          disabled={n === 0}
          testID="changelog-copy-selected"
          onPress={() => pk.setPreview({ versions: [...pk.selected] })}
          style={({ pressed }) => [styles.primaryBtn, n === 0 && styles.disabled, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name="copy-outline" size={14} color={colors.onAccent} />
          <Text style={styles.primaryBtnText}>{tr('changelog.copySelected', { n })}</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.desktopScroll} contentContainerStyle={styles.desktopScrollContent} testID="changelog-desktop-scroll">
      {entries.map(e => {
        const on = pk.selected.has(e.version);
        return (
          <View key={e.version} style={[styles.cardDesktop, on && styles.cardOn]} testID={`changelog-card-${e.version}`}>
            <View style={styles.cardHead}>
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={tr('changelog.selectVersion', { v: e.version })} testID={`changelog-check-${e.version}`} onPress={() => pk.toggle(e.version)} hitSlop={6} style={styles.checkHit}>
                <Check on={on} />
              </Pressable>
              <Text style={styles.version} testID={`changelog-version-${e.version}`}>v{e.version}</Text>
              {e.version === APP_VERSION ? <View style={styles.badge}><Text style={styles.badgeText}>{tr('changelog.current')}</Text></View> : null}
              <Text style={styles.date} testID={`changelog-date-${e.version}`}>{dateOf(e)}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={tr('changelog.copyVersion', { v: e.version })} testID={`changelog-copy-${e.version}`} onPress={() => pk.setPreview({ versions: [e.version] })} style={({ pressed, hovered }: any) => [styles.copyBtn, (pressed || hovered) && styles.hover]}>
                <Ionicons name="copy-outline" size={13} color={colors.accent} />
                <Text style={styles.copyBtnText}>{tr('changelog.copy')}</Text>
              </Pressable>
            </View>
            <EntryBody entry={e} phone={false} />
          </View>
        );
      })}
      </ScrollView>
      {pk.preview ? (
        <DialogFrame
          title={tr('changelog.previewTitle')}
          closeLabel={tr('changelog.close')}
          onClose={() => pk.setPreview(null)}
          maxWidth={640}
          testID="changelog-preview"
          footer={(
            <View style={styles.dialogFooter}>
              <Pressable accessibilityRole="button" testID="changelog-preview-cancel" onPress={() => pk.setPreview(null)} style={({ pressed, hovered }: any) => [styles.secondaryBtn, (pressed || hovered) && styles.hover]}>
                <Text style={styles.secondaryBtnText}>{tr('changelog.cancel')}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" testID="changelog-preview-copy" onPress={() => { void pk.doCopy().then(ok => { if (ok) pk.setPreview(null); }); }} style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.8 }]}>
                <Ionicons name="copy-outline" size={14} color={colors.onAccent} />
                <Text style={styles.primaryBtnText}>{tr('changelog.copy')}</Text>
              </Pressable>
            </View>
          )}
        >
          <FormatSegmented value={pk.format} onChange={pk.setFormat} testID="changelog-format" />
          <Text style={styles.hint}>{tr('changelog.previewHint')}</Text>
          <PreviewText text={pk.text} />
        </DialogFrame>
      ) : null}
      <Toast text={pk.toast} />
    </View>
  );
}

function Card({ selecting, on, onPress, style, testID, children }: { selecting: boolean; on: boolean; onPress: () => void; style: any; testID: string; children: ReactNode }) {
  if (!selecting) return <View style={style} testID={testID}>{children}</View>;
  return <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={style} testID={testID}>{children}</Pressable>;
}

// ── 手机 ────────────────────────────────────────────────────────────────────────────────────

export function ChangelogPhone({ entries, online }: { entries: ChangelogEntry[]; online: boolean | null }) {
  useTranslation();
  const pk = usePicker(entries);
  const [selecting, setSelecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const safe = useModalSafePadding('fullScreen');
  const n = pk.selected.size;
  const openPreview = (versions: string[]) => { setCopied(false); pk.setPreview({ versions }); };
  return (
    <View style={styles.phoneRoot} testID="changelog-phone">
      <ScrollView contentContainerStyle={[styles.phoneContent, selecting && { paddingBottom: 96 }]} testID="changelog-phone-scroll">
        <View style={styles.phoneTopRow}>
          <OfflineHint online={online} style={{ flex: 1 }} />
          <Pressable accessibilityRole="button" testID="changelog-select-toggle" onPress={() => { setSelecting(s => !s); pk.setSelected(new Set()); }} hitSlop={8} style={styles.phoneTopBtn}>
            <Text style={styles.accentText}>{selecting ? tr('changelog.cancelSelect') : tr('changelog.selectMany')}</Text>
          </Pressable>
        </View>
        {entries.map(e => {
          const on = pk.selected.has(e.version);
          return (
            // 多选时整张卡片可点(勾选);平时卡片只是容器 —— 套一层 disabled 的 Pressable 会把里面的「复制」一起禁掉。
            <Card
              key={e.version}
              selecting={selecting}
              onPress={() => pk.toggle(e.version)}
              style={[styles.cardPhone, selecting && on && styles.cardOn]}
              on={on}
              testID={`changelog-card-${e.version}`}
            >
              <View style={styles.cardHeadPhone}>
                {selecting ? <View testID={`changelog-check-${e.version}`}><Check on={on} /></View> : null}
                <View style={styles.titleBox} testID={`changelog-titlestack-${e.version}`}>
                  <View style={styles.titleLine}>
                    <Text style={styles.versionPhone} testID={`changelog-version-${e.version}`}>v{e.version}</Text>
                    {e.version === APP_VERSION ? <View style={styles.badge}><Text style={styles.badgeText}>{tr('changelog.current')}</Text></View> : null}
                  </View>
                  {dateOf(e) ? <Text style={styles.date} testID={`changelog-date-${e.version}`}>{dateOf(e)}</Text> : null}
                </View>
                {selecting ? null : (
                  <Pressable accessibilityRole="button" accessibilityLabel={tr('changelog.copyVersion', { v: e.version })} testID={`changelog-copy-${e.version}`} onPress={() => openPreview([e.version])} hitSlop={6} style={({ pressed }) => [styles.copyBtnPhone, pressed && { opacity: 0.6 }]}>
                    <Ionicons name="copy-outline" size={15} color={colors.accent} />
                    <Text style={styles.copyBtnText}>{tr('changelog.copy')}</Text>
                  </Pressable>
                )}
              </View>
              <EntryBody entry={e} phone />
            </Card>
          );
        })}
      </ScrollView>
      {selecting ? (
        <View style={[styles.phoneBar, { paddingBottom: Math.max(safe.paddingBottom ?? 0, spacing.md) }]} testID="changelog-phone-bar">
          <Text style={styles.toolCount}>{tr('changelog.selectedCount', { n })}</Text>
          <Pressable accessibilityRole="button" disabled={n === 0} testID="changelog-copy-selected" onPress={() => openPreview([...pk.selected])} style={({ pressed }) => [styles.primaryBtn, styles.primaryBtnPhone, n === 0 && styles.disabled, pressed && { opacity: 0.8 }]}>
            <Text style={styles.primaryBtnText}>{tr('changelog.copySelected', { n })}</Text>
          </Pressable>
        </View>
      ) : null}
      <Modal visible={!!pk.preview} animationType="slide" onRequestClose={() => pk.setPreview(null)}>
        <View style={[styles.sheet, withBasePadding(safe, 0)]} testID="changelog-preview">
          <View style={styles.sheetHeader}>
            <Pressable accessibilityRole="button" testID="changelog-preview-cancel" onPress={() => pk.setPreview(null)} hitSlop={8} style={styles.sheetHeaderSide}>
              <Text style={styles.sheetHeaderBtn}>{tr('changelog.cancel')}</Text>
            </Pressable>
            <Text style={styles.sheetTitle} numberOfLines={1}>{tr('changelog.previewTitle')}</Text>
            <View style={styles.sheetHeaderSide} />
          </View>
          <View style={styles.sheetFormat}><FormatSegmented value={pk.format} onChange={f => { pk.setFormat(f); setCopied(false); }} testID="changelog-format" /></View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.sheetBody}>
            <Text style={[styles.hint, { paddingHorizontal: spacing.xs }]}>{tr('changelog.previewHint')}</Text>
            <PreviewText text={pk.text} />
          </ScrollView>
          <View style={styles.sheetFooter} testID="changelog-preview-footer">
            <Pressable accessibilityRole="button" testID="changelog-preview-copy" onPress={() => { void pk.doCopy().then(setCopied); }} style={({ pressed }) => [styles.primaryBtn, styles.sheetBtn, pressed && { opacity: 0.8 }]}>
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={colors.onAccent} />
              <Text style={styles.primaryBtnText}>{copied ? tr('changelog.copied') : tr('changelog.copy')}</Text>
            </Pressable>
            {copied && canShare() ? (
              <Pressable accessibilityRole="button" testID="changelog-preview-share" onPress={() => { void Share.share({ message: pk.text }).catch(() => undefined); }} style={({ pressed }) => [styles.secondaryBtn, styles.sheetBtn, pressed && { opacity: 0.7 }]}>
                <Ionicons name="share-outline" size={16} color={colors.text} />
                <Text style={styles.secondaryBtnText}>{tr('changelog.share')}</Text>
              </Pressable>
            ) : null}
          </View>
          {/* 复制成功由按钮本身变成「已复制」表示;小条只在失败时出现(贴在按钮条上方,不盖住按钮)。 */}
          {copied ? null : <View style={styles.sheetToast} pointerEvents="none"><Toast text={pk.toast} /></View>}
        </View>
      </Modal>
      {pk.preview ? null : <Toast text={pk.toast} />}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  // 桌面
  desktopRoot: { flex: 1, minHeight: 0 },
  desktopScroll: { flex: 1 },
  desktopScrollContent: { paddingBottom: spacing.xl * 2 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  toolBtn: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.control },
  toolBtnText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  toolCount: { color: colors.textSecondary, fontSize: 13, marginRight: 'auto' },
  hover: { backgroundColor: colors.subtleFill },
  cardDesktop: { marginHorizontal: spacing.xl, marginBottom: spacing.md, padding: spacing.lg, borderRadius: radius.surface, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  cardOn: { borderColor: colors.accent },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  checkHit: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  version: { color: colors.text, fontSize: 16, fontWeight: '600' },
  date: { color: colors.textMuted, fontSize: 13, marginRight: 'auto' },
  badge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.item, backgroundColor: colors.subtleFill },
  badgeText: { color: colors.accent, fontSize: 11, fontWeight: '600' },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border },
  copyBtnText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  bodyDesktop: { paddingLeft: 32, paddingTop: spacing.sm, gap: spacing.sm },
  bodyPhone: { paddingTop: spacing.sm, gap: spacing.sm },
  sectionBlock: { gap: 4 },
  sectionTitle: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  bullet: { width: 4, height: 4, borderRadius: radius.inline, backgroundColor: colors.textMuted, marginTop: 8 },
  itemText: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 20 },
  itemTextPhone: { fontSize: 15, lineHeight: 22 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.control, backgroundColor: colors.accent },
  primaryBtnText: { color: colors.onAccent, fontSize: 14, fontWeight: '600' },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  secondaryBtnText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.45 },
  dialogFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  segmented: { flexDirection: 'row', alignSelf: 'flex-start', padding: 2, borderRadius: radius.control, backgroundColor: colors.subtleFill, borderWidth: 1, borderColor: colors.border },
  segment: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.item, alignItems: 'center', justifyContent: 'center', minWidth: 64, borderWidth: 1, borderColor: 'transparent' },
  segmentOn: { backgroundColor: colors.card, borderColor: colors.border },
  segmentText: { color: colors.textSecondary, fontSize: 13 },
  segmentTextOn: { color: colors.text, fontWeight: '600' },
  previewBox: { borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, padding: spacing.md },
  previewText: { color: colors.text, fontSize: 14, lineHeight: 22 },
  hint: { color: colors.textMuted, fontSize: 12 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  accentText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  toastLayer: { position: 'absolute', left: 0, right: 0, bottom: spacing.xl, alignItems: 'center' },
  toast: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.control, backgroundColor: colors.text, ...elevated('floating') },
  toastText: { color: colors.card, fontSize: 13, fontWeight: '600' },
  // 手机
  phoneRoot: { flex: 1 },
  phoneContent: { paddingTop: spacing.sm, paddingBottom: spacing.xl * 2 },
  phoneTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: 32, minHeight: 40 },
  phoneTopBtn: { marginLeft: 'auto', paddingVertical: spacing.xs },
  cardPhone: { marginHorizontal: 16, marginBottom: spacing.md, paddingHorizontal: 16, paddingVertical: spacing.md, borderRadius: radius.surface, backgroundColor: colors.groupedRow, borderWidth: 1, borderColor: 'transparent', ...elevated('raised') },
  cardHeadPhone: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40 },
  titleBox: { flex: 1, minWidth: 0, gap: 2 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  versionPhone: { color: colors.text, fontSize: 17, fontWeight: '600' },
  copyBtnPhone: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.bubble, backgroundColor: colors.subtleFill },
  phoneBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: 16, paddingTop: spacing.md, backgroundColor: colors.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  primaryBtnPhone: { minHeight: 44, paddingHorizontal: spacing.lg },
  sheet: { flex: 1, backgroundColor: colors.bg },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.card },
  sheetHeaderSide: { width: 64 },
  sheetHeaderBtn: { color: colors.text, fontSize: 16 },
  sheetTitle: { flex: 1, textAlign: 'center', color: colors.text, fontSize: 17, fontWeight: '600' },
  sheetFormat: { paddingHorizontal: 16, paddingTop: spacing.md, alignItems: 'center' },
  sheetBody: { padding: 16, gap: spacing.sm },
  sheetFooter: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: 16, paddingTop: spacing.md, paddingBottom: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.card },
  sheetBtn: { flex: 1, minHeight: 48 },
  sheetToast: { position: 'absolute', left: 0, right: 0, bottom: 96, height: 60 },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });

/** 设置里挂的入口:进页才联网拉(不在打开设置时就拉)。 */
export function ChangelogPage({ phone }: { phone: boolean }) {
  const { entries, online } = useChangelog();
  return phone ? <ChangelogPhone entries={entries} online={online} /> : <ChangelogDesktop entries={entries} online={online} />;
}
