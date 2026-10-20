// Left navigation rail for the Android wide layout (unfolded foldable / tablet / phone in
// landscape). Same pattern as the desktop rail in App.tsx (DesktopWorkspace): brand mark on
// top, the destinations, 设置 pinned to the bottom, version under it, same rail colours —
// but sized and labelled for touch: there is no hover, so every item shows its label
// (the desktop shows it as a hover tooltip) and each hit box is 64×56 dp.
//
// The decision of *when* this shows lives in src/nav-chrome.ts (pure + tested).
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { BrandMark } from './brand-mark';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { colors, radius } from './theme';
import { APP_VERSION } from './version';
import ConnectivityIndicator from './ConnectivityIndicator';
import { railBadgeText, railIconFor } from './rail-nav';
import { badgeOffsetCentered, clampBadge, pillBadgeWidth } from './badge-anchor';
import { mobileRailItem, mobileRailWidth, railUnreadTotal } from './nav-chrome';
import { nodeRolesVersion, subscribeNodeRoles } from './daemon-node';
import { ds, listText, uiScale } from './ui-scale';
import { alignedRailLayout, denserRowPitch, listFirstRowTop, onListFirstRowTopChange } from './list-rail-align';
import { getUnreadSnapshot, subscribeUnread } from './unread-store';
import { agentUnreadCounts } from './agent-unread-counts';
import { useTranslation } from './i18n-react';
import { useTaskUnreadCount } from './task-unread-store';

export interface MobileNavTab {
  key: string;
  label: string;
  icon: string;
  iconActive: string;
}

interface Props {
  tabs: readonly MobileNavTab[];
  active: string;
  onSelect: (key: string) => void;
  /** Left safe-area inset (landscape cutout / 3-button nav bar on the left). */
  insetLeft: number;
  /** Bottom inset (gesture bar). The top is already padded by the app root. */
  insetBottom: number;
  showBrand: boolean;
}

/** Same count the tray and the list rows use (agentUnreadCounts), summed. */
function useAgentsUnreadTotal(): number {
  const [snap, setSnap] = useState(getUnreadSnapshot);
  useEffect(() => subscribeUnread(() => setSnap(getUnreadSnapshot())), []);
  // #692:守护节点不计未读 —— 名单变了也要重算。
  const roles = useSyncExternalStore(subscribeNodeRoles, nodeRolesVersion, nodeRolesVersion);
  return useMemo(() => railUnreadTotal(agentUnreadCounts(snap)), [snap, roles]);
}

export default function MobileNavRail({ tabs, active, onSelect, insetLeft, insetBottom, showBrand }: Props) {
  const { t } = useTranslation();
  // AppRoot is keyed by theme + 界面密度 (uiScaleKey), so this remounts on either change and rebuilds its styles.
  const s = useMemo(makeStyles, []);
  const unread = useAgentsUnreadTotal();
  const taskUnread = useTaskUnreadCount();
  const main = tabs.filter(tab => tab.key !== 'settings');
  const settings = tabs.find(tab => tab.key === 'settings');
  // 更紧凑: rail item n shares a band with agent-list row n (same top, same pitch) — see
  // list-rail-align.ts for what "aligned" means. Other densities keep the ordinary rail.
  const firstRowTop = useSyncExternalStore(onListFirstRowTopChange, listFirstRowTop, listFirstRowTop);
  const align = uiScale().listDense ? alignedRailLayout(firstRowTop, denserRowPitch(uiScale().denseFontMultiplier), ds(12) + (showBrand ? ds(40) : 0)) : null;
  // Free space above the indicator inside an item (items centre their content). At 更紧凑 the items abut, so this is
  // all the room a badge has before it runs into the label of the tab above (#429).
  const [indicatorTop, setIndicatorTop] = useState<number | null>(null);
  const badgeBox = (text: string) => {
    const d = uiScale().densityFactor;
    const h = Math.max(14, Math.min(18, Math.round(18 * d)));
    const font = h < 16 ? 9 : 10, pad = h < 16 ? 3 : 4;
    const off = clampBadge(badgeOffsetCentered(ds(52), ds(30), ds(24), h), pillBadgeWidth(text, font, h, pad, 2), {
      minTop: indicatorTop === null ? -Infinity : -indicatorTop,
      // the rail's ScrollView clips its sides: end 1 px inside the rail edge
      maxRight: (mobileRailWidth(d) + ds(52)) / 2 - 1,
    });
    return { box: { ...off, height: h, minWidth: h, paddingHorizontal: pad }, text: { fontSize: font } };
  };

  const item = (tab: MobileNavTab) => {
    const selected = active === tab.key;
    const badge = tab.key === 'agents' ? railBadgeText(unread) : tab.key === 'tasks' ? railBadgeText(taskUnread) : null;
    return (
      <Pressable
        key={tab.key}
        testID={`nav-rail-${tab.key}`}
        accessibilityRole="tab"
        accessibilityLabel={badge ? t(tab.key === 'tasks' ? 'nav.tasksUnread' : 'nav.unread', { label: t(tab.label), count: badge }) : t(tab.label)}
        accessibilityState={{ selected }}
        aria-selected={selected}
        onPress={() => onSelect(tab.key)}
        android_ripple={{ color: colors.railHover, borderless: true, radius: 30 }}
        style={({ pressed }) => [s.item, align && { height: align.itemHeight }, pressed && !selected && s.itemPressed]}
      >
        <View style={[s.indicator, selected && s.indicatorActive]} onLayout={tab.key === main[0]?.key ? e => setIndicatorTop(e.nativeEvent.layout.y) : undefined}>
          <Ionicons
            name={railIconFor(tab, active) as keyof typeof Ionicons.glyphMap}
            size={24 /* density-scaled by ./icons */}
            color={selected ? colors.accent : colors.textSecondary}
          />
          {badge ? (
            <View style={[s.badge, badgeBox(badge).box]} testID={`nav-rail-badge-${tab.key}`}><Text dense style={[s.badgeText, badgeBox(badge).text]}>{badge}</Text></View>
          ) : null}
        </View>
        <Text dense style={[s.label, selected && s.labelActive]} numberOfLines={1}>{t(tab.label)}</Text>
      </Pressable>
    );
  };

  return (
    <View
      style={[s.rail, { width: mobileRailWidth(uiScale().densityFactor) + insetLeft, paddingLeft: insetLeft, paddingBottom: 8 + insetBottom }]}
      testID="mobile-nav-rail"
      accessibilityRole="tablist"
    >
      {showBrand ? (
        <View style={s.brand}>
          {/* Same theme mark as the desktop rail (not the plated app icon). */}
          <BrandMark size={58} style={s.brandMark} />
        </View>
      ) : null}
      <ScrollView
        style={s.tabs}
        contentContainerStyle={[s.tabsContent, !showBrand && s.tabsCompact, align && { paddingTop: align.tabsPaddingTop, gap: align.gap }]}
        showsVerticalScrollIndicator={false}
        testID="mobile-nav-rail-tabs"
      >
        {main.map(item)}
      </ScrollView>
      {settings ? item(settings) : null}
      {/* 连接状态:版本号左边的小圆点(没有版本号的矮屏只画圆点,贴在底部留白里);悬停/点按看全文。 */}
      {showBrand
        ? <ConnectivityIndicator placement="rail" label={`v${APP_VERSION}`} labelStyle={s.versionText} style={s.version} />
        : <ConnectivityIndicator placement="rail" style={s.dotOnly} />}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  rail: {
    alignItems: 'center',
    // 连接状态提示条挂在 rail 右侧,要画在右边内容之上。
    zIndex: 10,
    paddingTop: ds(12),
    backgroundColor: colors.railBg,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
  },
  brand: { width: ds(40), height: ds(40), alignItems: 'center', justifyContent: 'center' },
  brandMark: { width: ds(58), height: ds(58) },
  tabs: { flex: 1, alignSelf: 'stretch' },
  tabsContent: { paddingTop: ds(14), gap: ds(6), alignItems: 'center' },
  tabsCompact: { paddingTop: 0 },
  item: {
    // 界面密度: 64×56 at 标准, 54×48 at 紧凑, 48×48 at 更紧凑 (never under 48 — mobileRailItem).
    width: mobileRailItem(uiScale().densityFactor).width,
    height: mobileRailItem(uiScale().densityFactor).height,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderRadius: radius.control,
  },
  itemPressed: { backgroundColor: colors.railHover },
  // Material 3 style active indicator: a pill behind the icon, label underneath.
  indicator: { width: ds(52), height: ds(30), borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  indicatorActive: { backgroundColor: colors.railActiveBg },
  // listText('railLabel'): 10 at 更紧凑 — the same size as the list's row time and group header; 11 otherwise.
  label: { color: colors.textSecondary, ...listText('railLabel'), fontWeight: '500', maxWidth: mobileRailItem(uiScale().densityFactor).width },
  labelActive: { color: colors.accent, fontWeight: '600' },
  badge: {
    // Left edge tucked just inside the glyph's top-right corner (badge-anchor.ts): 「99+」 grows outward — as far as the
    // rail item allows (badgeBox clamps it and scales it with 界面密度).
    position: 'absolute', ...badgeOffsetCentered(ds(52), ds(30), ds(24), 18), minWidth: 18, height: 18, borderRadius: radius.pill, paddingHorizontal: 4,
    backgroundColor: colors.failed, borderWidth: 2, borderColor: colors.railBg, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '600', lineHeight: 12 },
  version: { marginTop: 4 },
  versionText: { color: colors.textMuted, fontSize: 10, textAlign: 'center' },
  // 矮屏(不画品牌和版本号):圆点放进 rail 底部留白,绝对定位,不改 rail 的排布。
  dotOnly: { position: 'absolute', bottom: 0 },
});
