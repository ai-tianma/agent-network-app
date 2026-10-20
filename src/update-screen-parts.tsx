// 更新页(安卓全屏 / 桌面卡片)共用的三块:品牌图标、品牌色渐变底、解析后的「更新内容」。
// 只负责摆放;说明的解析(去英文标题、分节、只留比当前新的版本)在 release-notes.ts,有 ck 测试。
import type { ComponentProps } from 'react';
import { Image, Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { appIconRadius, colors, onThemeChange, radius, spacing, themeMode } from './theme';
import type { NoteGroup, NoteKind } from './release-notes';

/** 6 位 hex token + 透明度 → 8 位 hex(只用于装饰底色;文字颜色始终是 token 原值)。 */
export const tint = (hex: string, alpha: number): string =>
  /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0')}` : hex;

const KIND_ICON: Record<NoteKind, ComponentProps<typeof Ionicons>['name']> = { new: 'sparkles', speed: 'flash', fix: 'construct' };
const kindColor = (kind: NoteKind): string => (kind === 'fix' ? colors.running : kind === 'speed' ? colors.blocked : colors.accent);

/** App 图标(和桌面安装包、启动页同一张品牌图)。 */
export function UpdateBrandMark({ size }: { size: number }) {
  return (
    <View style={[styles.markShadow, { width: size, height: size, borderRadius: appIconRadius(size) }]}>
      <Image
        source={require('../assets/icon-ios.png')}
        style={{ width: size, height: size, borderRadius: appIconRadius(size) }}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

/** 两个 6 位 hex 按 t 混合(不透明结果:顶栏要盖住滚上去的内容)。 */
export const mix = (a: string, b: string, t: number): string => {
  const ch = (h: string, i: number) => Number.parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return a;
  return `#${[0, 1, 2].map(i => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t).toString(16).padStart(2, '0')).join('')}`;
};

// 图标里的品牌蓝(assets/icon.png 左下那颗),只在更新页头部做底色用。
const BRAND_BLUE = '#1b65db';

/** 头部渐变最上面那一档的实色 —— 顶栏用它,和头部接成一片。 */
export const heroTopColor = (ground: string): string => mix(ground, BRAND_BLUE, themeMode() === 'dark' ? 0.2 : 0.12);

/**
 * 品牌色渐变(图标里的蓝 → 强调青 → 地面),很淡 —— 只给头部一点颜色,不抢文字。
 * 原生(新架构)认 experimental_backgroundImage,web 认 backgroundImage;都不认时是顶部那一档的实色。
 */
export function heroBackground(ground: string): ViewStyle {
  const top = heroTopColor(ground);
  const mid = mix(ground, colors.accent, themeMode() === 'dark' ? 0.1 : 0.07);
  const gradient = `linear-gradient(180deg, ${top} 0%, ${mid} 55%, ${ground} 100%)`;
  const base: ViewStyle = { backgroundColor: top };
  return Platform.OS === 'web'
    ? ({ ...base, backgroundImage: gradient } as ViewStyle)
    : ({ ...base, experimental_backgroundImage: gradient } as ViewStyle);
}

/** 解析好的分组 → 一版一张卡片,卡片里按「新功能 / 提速 / 修复」分节,每条一行带小图标。 */
export function ReleaseNoteGroups({ groups, surface, testID }: { groups: NoteGroup[]; surface: string; testID?: string }) {
  return (
    <View style={styles.groups} testID={testID}>
      {groups.map((g, gi) => (
        <View key={g.version ?? gi} style={[styles.group, { backgroundColor: surface }]} testID={`update-notes-group-${gi}`}>
          <View style={styles.groupHead}>
            <Text style={styles.groupTitle}>{g.title}</Text>
            {gi === 0 && groups.length > 1 ? <Text style={styles.latestTag}>最新</Text> : null}
          </View>
          {g.sections.map(sec => (
            <View key={sec.kind} style={styles.section}>
              {g.sections.length > 1 || sec.kind !== 'new' ? (
                <View style={styles.sectionHead}>
                  <Ionicons name={KIND_ICON[sec.kind]} size={13} color={kindColor(sec.kind)} />
                  <Text style={[styles.sectionTitle, { color: kindColor(sec.kind) }]}>{sec.title}</Text>
                </View>
              ) : null}
              {sec.items.map((item, ii) => (
                <View key={ii} style={styles.item} testID="update-note-item">
                  <View style={[styles.itemDot, { backgroundColor: tint(kindColor(item.kind), 0.14) }]}>
                    <Ionicons name={item.kind === 'fix' ? 'checkmark' : item.kind === 'speed' ? 'flash' : 'add'} size={11} color={kindColor(item.kind)} />
                  </View>
                  <Text style={styles.itemText} selectable>{item.text}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    markShadow: Platform.select({
      web: { boxShadow: themeMode() === 'dark' ? '0 8px 24px rgba(29,108,240,0.35)' : '0 8px 24px rgba(16,24,40,0.18)' } as ViewStyle,
      default: { shadowColor: '#0b1f4d', shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
    }) as ViewStyle,
    groups: { gap: spacing.md },
    group: { borderRadius: radius.surface, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
    groupHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
    groupTitle: { color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: '600' },
    latestTag: { color: colors.accent, backgroundColor: colors.tonalBg, fontSize: 11, lineHeight: 16, fontWeight: '600', paddingHorizontal: 6, borderRadius: radius.mark, overflow: 'hidden' },
    section: { marginBottom: spacing.sm },
    sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: spacing.sm },
    sectionTitle: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
    item: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: spacing.md },
    // 圆点和正文第一行同一条中线:行高 22,圆点 18 → 上移 2。
    itemDot: { width: 18, height: 18, marginTop: 2, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
    itemText: { flex: 1, color: colors.text, fontSize: 15, lineHeight: 22 },
  });

// 模块级 StyleSheet 必须随主题重建(theme-restyle-coverage.test.ts)。
let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
