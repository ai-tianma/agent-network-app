import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { checkDesktopUpdate, desktopUpdateFromManualCheck, desktopUpdateSnapshot, installDesktopUpdate, subscribeDesktopUpdates } from './desktop-updater';
import { colors, onThemeChange, spacing, themeMode, radius } from './theme';
import { desktopPromptView, desktopPromptVisible } from './update-prompt-model';
import { parseReleaseNotes } from './release-notes';
import { APP_VERSION } from './version';
import { useModalSafePadding } from './safe-area-runtime';
import { withBasePadding } from './modal-safe-area';
import { elevated, buttonStyle, buttonTextStyle } from './elevation';
import { heroBackground, ReleaseNoteGroups, tint, UpdateBrandMark } from './update-screen-parts';

// 下载中的状态不带说明;记住最近一次「有新版本」的那一份,点了更新之后说明不消失、卡片不跳。
// 在模块级订阅:状态可能在弹窗还没渲染时就从 available 走到 downloading。
let lastAvailableNotes = '';
subscribeDesktopUpdates(() => {
  const s = desktopUpdateSnapshot();
  if (s.kind === 'available') lastAvailableNotes = s.notes;
});

/**
 * 桌面「发现新版本」卡片(owner 2026-09-30「这是每次都要发社交媒体的」)。和安卓全屏页同一套视觉
 * (品牌图标 + 渐变头部 + 解析后的说明),但按桌面排:居中的窗口级卡片,头部横排,说明区单独滚动,
 * 底部一行固定 —— 左边一句签名校验、右边主按钮(下载中原地变成带 % 和 MB 的进度条)。
 * `manualOnly`:设置窗用 —— 不跑启动自动检查,只为本窗口里手动点出来的结果弹(见 desktopPromptMode)。
 */
export default function DesktopUpdatePrompt({ manualOnly = false }: { manualOnly?: boolean }) {
  const [installing, setInstalling] = useState(false);
  const update = useSyncExternalStore(subscribeDesktopUpdates, desktopUpdateSnapshot, desktopUpdateSnapshot);
  // 挂在 AppRoot 的 key={theme} 重挂树外面:弹窗开着时系统配色一变(跟随系统),模块级 styles
  // 已重建,但不订阅就不重画 —— 半边新主题半边旧主题。
  useSyncExternalStore(onThemeChange, themeMode, themeMode);
  useEffect(() => {
    if (manualOnly || !(globalThis as any).__TAURI_INTERNALS__) return;
    const timer = setTimeout(() => { void checkDesktopUpdate(); }, 2500);
    return () => clearTimeout(timer);
  }, [manualOnly]);

  const visible = desktopPromptVisible(update, { mode: manualOnly ? 'manual' : 'auto', fromManualCheck: desktopUpdateFromManualCheck() });
  // 当前版本 → 新版本、下载进度与大小。
  const view = desktopPromptView(update, APP_VERSION);
  const current = ('currentVersion' in update && update.currentVersion) || APP_VERSION;
  const next = 'version' in update ? update.version : undefined;
  const notes = update.kind === 'available' ? update.notes : lastAvailableNotes;
  const groups = useMemo(() => parseReleaseNotes(notes, { currentVersion: current, targetVersion: next }), [notes, current, next]);
  const safe = useModalSafePadding('fullScreen'); // 0 on desktop; the rule is uniform (modal-safe-area.ts)
  const progress = view?.progress;
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={[styles.backdrop, withBasePadding(safe, 24)]}>
        <View style={styles.card} testID="desktop-update-card">
          <View style={[styles.hero, heroBackground(colors.floatingBg)]} testID="desktop-update-hero">
            <UpdateBrandMark size={64} />
            <View style={styles.heroText} testID="desktop-update-versions">
              <Text style={styles.kicker}>发现新版本</Text>
              <Text style={styles.version}>{view?.versions.next ?? ''}</Text>
              {view?.versions.current ? <Text style={styles.meta}>当前 {view.versions.current}</Text> : null}
            </View>
          </View>
          {groups.length ? (
            // 说明单独滚动、能收缩;按钮行在滚动区外面,永远看得见。
            <ScrollView style={[styles.notesScroll, styles.noFocusRing]} contentContainerStyle={styles.notesContent} testID="desktop-update-notes">
              <ReleaseNoteGroups groups={groups} surface={colors.bg} testID="desktop-update-note-groups" />
            </ScrollView>
          ) : null}
          <View style={styles.footer} testID="desktop-update-footer">
            <View style={styles.trust}>
              <Ionicons name="shield-checkmark-outline" size={13} color={colors.textMuted} />
              <Text style={styles.trustText} numberOfLines={1}>更新包经签名校验，不会静默安装</Text>
            </View>
            {update.kind === 'downloading' ? (
              <View style={styles.progress} testID="desktop-update-progress" accessibilityRole="progressbar" accessibilityLabel={view?.progressLine}>
                {progress?.percent != null ? <View style={[styles.progressFill, { width: `${progress.percent}%` }]} /> : null}
                <View style={styles.progressLabel}>
                  {progress?.percent == null ? <ActivityIndicator color={colors.accent} size="small" /> : null}
                  <Text style={styles.progressText} numberOfLines={1}>{`正在下载 ${progress?.percent != null ? `${progress.percent}%` : ''}`.trim()}</Text>
                  {progress?.bytes ? <Text style={styles.progressBytes} numberOfLines={1}>{progress.bytes}</Text> : null}
                </View>
              </View>
            ) : (
              <Pressable
                style={[styles.button, installing && { opacity: 0.6 }]}
                testID="desktop-update-install"
                disabled={installing}
                accessibilityRole="button"
                accessibilityState={{ disabled: installing, busy: installing }}
                onPress={() => {
                  if (installing) return;
                  setInstalling(true);
                  void installDesktopUpdate().finally(() => setInstalling(false));
                }}
              >
                {installing ? <ActivityIndicator size="small" color={colors.onAccent} /> : null}
                <Text style={styles.buttonText}>{installing ? '更新中…' : '立即更新并重启'}</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: '#0009', alignItems: 'center', justifyContent: 'center', padding: 24 },
    card: { width: '100%', maxWidth: 560, maxHeight: '88%', borderRadius: radius.surface, backgroundColor: colors.card, overflow: 'hidden', ...elevated('floating') },
    hero: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingHorizontal: 28, paddingTop: 28, paddingBottom: 22 },
    heroText: { flex: 1 },
    kicker: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
    version: { color: colors.text, fontSize: 28, lineHeight: 34, fontWeight: '600', letterSpacing: 0.3 },
    meta: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
    // web 上可滚动的 div 会拿到焦点并画一圈白框(截图里像裂缝);键盘滚动不受影响。
    notesScroll: { flexGrow: 0, flexShrink: 1 },
    noFocusRing: (Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) as object,
    notesContent: { paddingHorizontal: 20, paddingBottom: spacing.lg },
    footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingHorizontal: 20, paddingVertical: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    trust: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
    trustText: { flexShrink: 1, color: colors.textMuted, fontSize: 12, lineHeight: 17 },
    button: { ...buttonStyle('primary'), flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 22 },
    buttonText: { ...buttonTextStyle('primary') },
    progress: { width: 240, height: 40, borderRadius: radius.control, backgroundColor: colors.tonalBg, overflow: 'hidden', justifyContent: 'center' },
    progressFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: tint(colors.accent, themeMode() === 'dark' ? 0.34 : 0.22) },
    progressLabel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
    progressText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
    progressBytes: { color: colors.textSecondary, fontSize: 12 },
  });

// 🔴 模块级 StyleSheet 是在 import 那一刻按当时的 colors 算死的。
// 不重建的话,这个文件永远停在 DARK —— 白色主题下侧栏/弹窗仍是黑的。
// 同 ServerScreen.tsx 的写法;有一道测试守着,见 theme-restyle-coverage.test.ts。
let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
