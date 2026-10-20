import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from './src/i18n-react';
import { clearConditionalReads } from './src/conditional-get';
import { installLanguageRuntime } from './src/i18n-runtime';
import './src/i18n-accounts';
import { ActivityIndicator, BackHandler, Image, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text, TextInput } from './src/ui-text';
import { Ionicons } from './src/icons';
import { BrandMark } from './src/brand-mark';
import { SafeAreaInsetsContext, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { SAFE_AREA_SIM, layoutOs, statusBarHeight } from './src/safe-area-runtime';
import { mainWindowTopPadding } from './src/modal-safe-area';
import { purgeLegacyAttachmentCache } from './src/AuthedThumb';
import { prefetchStatus, login, fetchHubNodes, fetchNetworkId, setNetworkIdPersister, HubConfig } from './src/api';
import { fetchAuthMe, registerHubAccount } from './src/user-admin-api';
import { clientLabelForLogin } from './src/login-sessions';
import { isWindowsTauriShell, popoutChatChrome, tauriShellPlatform } from './src/window-shell';
import DmChatScreen, { type GroupChatRef } from './src/DmChatScreen';
import { groupNameFor, rememberGroupName } from './src/group-chat-bus';
import type { Human } from './src/human-dm';
import { reconcileNetworkId, validateNewUser } from './src/user-admin';
import './src/i18n-users';
import { LOGIN_FAILURE_COPY, normalizeServerUrl, type LoginFailureKind } from './src/login-flow';
import { hydrateHubAvatars, initLocalAvatars } from './src/lib/avatars';
import { hydrateNodeRoles, isHostSupervisorAlias, nodeRolesVersion, subscribeNodeRoles } from './src/daemon-node';
import { usePoll } from './src/usePoll'; // R1 avatar 30s hydrate poll (main's App.tsx no longer imports it)
import ChatScreen, { clearChatConversationCache } from './src/ChatScreen';
import MessagesScreen from './src/MessagesScreen';
import ServerScreen from './src/ServerScreen';
import { maskedHubHost, maskUrlsInText } from './src/mask-hub-address';
import { agentListScreen, type AgentListFilter } from './src/server-stats';
import ServerSidebar, { isHubPendingSection, type ServerSection } from './src/ServerSidebar';
import HubPendingScreen from './src/HubPendingScreen';
import HubDaemonEntryScreen from './src/HubDaemonEntryScreen';
import type { PendingTab } from './src/backend-pending-ui';
import HubScopeScreen from './src/HubScopeScreen';
import HubTokenManagementScreen from './src/HubTokenManagementScreen';
import HubProviderManagementScreen from './src/HubProviderManagementScreen';
import HubSkillsPane from './src/HubSkillsPane';
import HubSecretsPane from './src/HubSecretsPane';
import HubScopeFixtureScreen, { readHubScopeFixture } from './src/HubScopeFixtureScreen';
import DaemonOverviewFixtureScreen, { readDaemonOverviewFixture } from './src/DaemonOverviewFixtureScreen';
import CloneNodeFixtureScreen, { readCloneNodeFixture } from './src/CloneNodeFixtureScreen';
import { hubSectionForScreen, screenForHubSection, type HubSection } from './src/hub-scope-demo';
import HostSupervisorPickerScreen from './src/HostSupervisorPickerScreen';
import CreateNodeWizardScreen from './src/CreateNodeWizardScreen';
import SettingsScreen from './src/SettingsScreen';
import { rememberSettingsCategory, requestSettingsDetail, settingsDetailFromQuery } from './src/settings-model';
import AgentsScreen from './src/AgentsScreen';
import TasksScreen from './src/TasksScreen';
import TaskFilterSidebar from './src/TaskFilterSidebar';
import TaskDetailScreen from './src/TaskDetailScreen';
import NodeDetailScreen from './src/NodeDetailScreen';
import LogsScreen from './src/LogsScreen';
import ScheduledTasksScreen from './src/ScheduledTasksScreen';
import type { ScheduleOpenRequest } from './src/node-schedules';
import ConnectivityIndicator from './src/ConnectivityIndicator';
import FatalBoundary, { FatalFixtureScreen, readFatalFixture } from './src/FatalBoundary';
import LastCrashChip from './src/LastCrashChip';
import WeakPasswordBanner from './src/WeakPasswordBanner';
import { weakPasswordFlags } from './src/weak-password-flag';
import type { HostSupervisorDaemon } from './src/api';
import { clearConfig, listHubProfiles, loadConfig, loadHubProfile, loadLocalAvatars, loadOutbox, loadForwardOperations, saveForwardOperations, loadThemeMode, loadUiScalePrefs, markHubProfileRequiresReauth, onDesktopThemeStorageChange, persistProfileNetworkId, onDesktopUiScaleStorageChange, removeHubProfile, saveConfig, saveLocalAvatars, saveOutbox, sessionIdOf, switchHubProfile, type HubProfile } from './src/storage';
import { clearProfileUnauthorized, isCurrentProfileCredential, onProfileUnauthorized, profileUnauthorizedReason } from './src/profile-auth-state';
import { initOutbox } from './src/outbox';
import { createForwardPersistence, initForwardController } from './src/forward-controller';
import { loadDesktopThemeMode } from './src/desktop-theme-storage';
import { loadDesktopUiScale } from './src/desktop-theme-storage';
import { onUiScaleChange, parseStoredUiScale, parseUiScaleSim, setOsFontScale, setUiScaleLayoutWide, setUiScaleLegacySim, setUiScalePrefs, ds, uiScale, uiScaleKey } from './src/ui-scale';
import { colors, onThemeChange, parseStoredThemePreference, setThemeMode, setThemePreference, spacing, themeMode, appIconRadius, radius } from './src/theme';
import { installSystemThemeFollower } from './src/system-color-scheme';
import { installWebScrollbarTheme } from './src/web-scrollbar';
import MacTitleStrip from './src/mac-title-strip';
import WinTitleBar from './src/win-title-bar';
import PopoutWindowControls from './src/popout-window-controls';
import { applyWindowBackground } from './src/window-background';
import DesktopWindowPin from './src/DesktopWindowPin';
import { styles } from './src/app-styles';
import { APP_VERSION } from './src/version';
import { railBadgeText, railIconFor, railSurface, railTooltipVisible } from './src/rail-nav';
import { useTaskUnreadCount, useTaskUnreadDriver } from './src/task-unread-store';
import { badgeOffsetCentered } from './src/badge-anchor';
import DesktopUpdatePrompt from './src/DesktopUpdatePrompt';
import { desktopPromptMode } from './src/update-prompt-model';
import AndroidUpdatePrompt from './src/AndroidUpdatePrompt';
import PreloginUpdateCheck from './src/PreloginUpdateCheck';
import DesktopMessageListener from './src/DesktopMessageListener';
import { requestOpenTask } from './src/task-open-request';
import DesktopNotifier from './src/DesktopNotifier';
import MobileNotifier from './src/MobileNotifier';
import { loadNotifySettings, mutedAgents, notifyProfileKey, saveNotifySettings, subscribeNotifySettings, toggleAgentMuted } from './src/notify-settings';
import { bindDesktopTray, dismissAllForConfig } from './src/desktop-tray';
import TrayPanel, { readTrayPanelRoute } from './src/TrayPanel';
import ImageViewerWindow from './src/ImageViewerWindow';
import { readImageWindowRoute } from './src/image-window-model';
import TaskWindow from './src/TaskWindow';
import { readTaskWindowRoute } from './src/task-window-model';
import { readDaemonSettingsWindow } from './src/daemon-settings-window';
import DaemonSettingsWindow from './src/DaemonSettingsWindow';
import { loadPinnedChats, requestedChatAlias, requestedChatProfileId, requestedWorkspaceProfileId, savePinnedChats } from './src/desktop-chat-menu';
import { SETTINGS_CATEGORY_EVENT, SETTINGS_SESSION_EVENT, closeSettingsWindow, followThemeInSettingsTitleBar, notifySessionChanged, openSettingsWindow, requestedSettingsCategory, requestedSettingsDetail, requestedSettingsWindow, settingsCategoryFromQuery } from './src/desktop-settings-window';
import { loadChatPins, saveChatPins, togglePinned } from './src/chat-pins';
import { ROW_MENU_EMPTY_HINT } from './src/agent-row-menu';
import { bindUnreadProfile } from './src/unread-store';
import { openRememberedChatWindow } from './src/desktop-chat-windows';
import { NEED_COMPOSER_NOTICE } from './src/voice-shortcut-model';
import { ShortcutToast } from './src/ShortcutToast';
import { activateHubProfile, LOCAL_HUB_PROFILE_ID, localHubStatus, startLocalHub } from './src/local-hub';
import UnreadBadgeFixtureScreen, { readWebFixture } from './src/UnreadBadgeFixtureScreen';
import NotifySettingsFixtureScreen, { readNotifyFixture } from './src/NotifySettingsFixtureScreen';
import UpdatePromptFixtureScreen, { readUpdatePromptFixture } from './src/UpdatePromptFixtureScreen';
import { chooseAppLayout, LIST_PANE_DEFAULT_WIDTH, paneSelectionFor, twoPaneListWidth } from './src/wide-layout';
import TwoPaneDivider from './src/TwoPaneDivider';
import { loadListPaneWidth, saveListPaneWidth } from './src/agent-list-prefs';
import { bumpLayoutGeneration } from './src/layout-handoff';
import MobileNavRail from './src/MobileNavRail';
import { comboFromEvent, shortcutAction, shortcutForCombo } from './src/shortcuts-model';
import { isMacKeyboard, requestAgentSearchFocus, shortcutBindings, shortcutCaptureActive } from './src/shortcuts-store';
import { contentWidthBesideRail, mobileRailWidth, navActiveKey, navChromeFor, phoneInPageLeaf, phoneSettingsBackTarget, railShowsBrand, screenForNavPress } from './src/nav-chrome';
import { elevated, buttonStyle, buttonTextStyle } from './src/elevation';

// #653 弱密码横幅在手机上出现的页面(各 tab 的首页)。
const PHONE_BANNER_SCREENS: ReadonlySet<string> = new Set(['agents', 'tasks', 'messages', 'server', 'scheduled']);

type Screen =
  | { name: 'login' }
  | { name: 'agents'; filter?: AgentListFilter }  // filter: 服务器页的状态卡片 / 分组行带过来的
  | { name: 'tasks' }
  | { name: 'scheduled'; open?: ScheduleOpenRequest; back?: Screen }  // open/back: 从节点页「定时任务」分区来 —— 落点 + 返回回节点页
  | { name: 'messages' }
  | { name: 'server' }
  | { name: 'serverPending'; tab: PendingTab }
  | { name: 'serverDaemon' }                // Hub 域集成 → Daemon：一台直接进管理页，多台先点选，点下去仍是 openDaemonFromHub
  | { name: 'serverNodes'; filter?: AgentListFilter }
  | { name: 'serverNodeDetail'; alias: string }
  | { name: 'settings' }
  | { name: 'chat'; alias: string; focusTaskId?: string; networkId?: string; daemonMgmt?: boolean }  // daemonMgmt: Hub 概览点机器进守护进程管理(角色未 hydrate 时也显示管理页)
  | { name: 'dm'; alias: string; userId: string; displayName?: string | null; avatarUrl?: string | null }  // 人与人私信(hub#2086);alias = 对方用户名
  | { name: 'group'; alias: string; groupName?: string }  // 群聊(RFC-042,Hub ≥ .93);alias = group_id
  | { name: 'nodeInfo'; alias: string; daemonMgmt?: boolean }
  | { name: 'taskDetail'; taskId: string }   // full-screen (no tab bar) — hardware back returns to /tasks list
  | { name: 'nodeDetail'; alias: string }  // issue #8 row 4 (V1) — 会话行菜单「节点详情」(以前是直接长按); back returns to agents
  | { name: 'logs' }                        // row 6 — network event stream leaf reached from Server tab; back returns to server
  | { name: 'hubSkills' }                   // 服务器管理侧栏 · Hub SKILLS（真实 GET /api/skills）
  | { name: 'hubTokens' }                   // 服务器管理侧栏 · Hub API 密钥库
  | { name: 'hubEnv' }                      // 服务器管理侧栏 · Hub 环境变量/密钥名（真实 GET /api/secrets；只显示名字）
  | { name: 'hubProviders' }                // 当前网络的真实 Hub Provider 配置及显式 Daemon 下发
  | { name: 'picker' }       // #338 RFC-026 §9.4 host_supervisor picker (modal-style, back returns to agents)
  | { name: 'wizard'; daemon: HostSupervisorDaemon; back?: Screen };  // back: 从某台 daemon 的管理页进来时,返回回到那一页

/** Hub 服务器概览点机器行:进该 daemon 的管理域(节点设置 + 虚拟机域设置)。 */
const openDaemonFromHub = (alias: string): Screen => ({ name: 'chat', alias, daemonMgmt: true });

const nodeInfoFromChat = (chat: Extract<Screen, { name: 'chat' }>): Screen =>
  ({ name: 'nodeInfo', alias: chat.alias, daemonMgmt: chat.daemonMgmt });

const chatBackFromNodeInfo = (info: Extract<Screen, { name: 'nodeInfo' }>): Screen =>
  ({ name: 'chat', alias: info.alias, daemonMgmt: info.daemonMgmt });

// 跟微信的学一学 (Vincent tg 807): icon over small label, active tint.
// Desktop keeps operational modules together and pins Settings to the bottom.
const DESKTOP_TABS = [
  { key: 'agents', label: 'nav.agents', icon: 'people-outline', iconActive: 'people' },
  { key: 'tasks', label: 'nav.tasks', icon: 'list-outline', iconActive: 'list' },
  { key: 'scheduled', label: 'nav.scheduled', icon: 'time-outline', iconActive: 'time' },
  { key: 'messages', label: 'nav.messages', icon: 'chatbubble-ellipses-outline', iconActive: 'chatbubble-ellipses' },
  { key: 'server', label: 'nav.server', icon: 'server-outline', iconActive: 'server' },
  { key: 'settings', label: 'nav.settings', icon: 'settings-outline', iconActive: 'settings' },
] as const;

// Vincent 2026-09-29 (Android phone): 「底部 tab 的 服务器 换成 任务」. #159 had hidden Tasks
// from the phone; the owner reversed that. 任务 sits next to Agent because dispatching and
// checking tasks happens every day while schedules are set up once in a while, and it keeps
// the same order as the unfolded rail below. 服务器 moves to a row at the top of 设置
// (PHONE_SETTINGS_SERVER_ENTRY in src/nav-chrome.ts), pushed as a leaf page with a back button.
const MOBILE_TABS = [
  { key: 'agents', label: 'nav.agents', icon: 'people-outline', iconActive: 'people' },
  { key: 'tasks', label: 'nav.tasks', icon: 'list-outline', iconActive: 'list' },
  { key: 'scheduled', label: 'nav.scheduled', icon: 'time-outline', iconActive: 'time' },
  { key: 'settings', label: 'nav.settings', icon: 'settings-outline', iconActive: 'settings' },
] as const;

// Vincent 2026-09-29 「左侧加回去」: the unfolded left rail has 任务 (list + board). It has room
// for 服务器 too, so the rail keeps it; only the phone bottom bar dropped it.
const MOBILE_RAIL_TABS = [
  ...MOBILE_TABS.slice(0, 3),
  { key: 'server', label: 'nav.server', icon: 'server-outline', iconActive: 'server' },
  MOBILE_TABS[3],
] as const;

const DESKTOP_MAIN_TABS = DESKTOP_TABS.filter(tab => tab.key !== 'settings');
const DESKTOP_SETTINGS_TAB = DESKTOP_TABS.find(tab => tab.key === 'settings')!;

export default function App() {
  useEffect(() => { installLanguageRuntime(); }, []);
  // 🔴 冷启动时用户存的主题原先只在一个 **await 了 loadConfig()/loadThemeMode() 的
  // useEffect** 里恢复(见下方 "Restore the saved session on cold start")——
  // 那意味着**首帧一定是默认 DARK**,存了 light 的用户每次冷启动都会闪一下深色。
  // 而桌面/web 的 `loadDesktopThemeMode()` 是**纯同步**的(localStorage.getItem),
  // 所以这一支可以在首帧之前就定下来。
  //
  // 同一个形状 Mac打包牛 在 UnreadBadgeFixtureScreen 里先撞到:用 useEffect 设主题
  // 太晚,截图截到的永远是默认 dark。那里的修法就是这条。
  //
  // ⚠️ 移动端仍会闪:它的持久化走 SecureStore.getItemAsync,拿不到同步值 ——
  // 这一半本条修不了,不假装修好。
  //
  // 0.2.101「跟随系统」:先同步读系统配色并订阅它的变化(幂等,每个窗口的 JS 上下文装一次),
  // 再同步读用户偏好。存储里没有值(新装)= 跟随系统;旧版存的 light/dark 原样沿用。
  // undefined = 不是桌面壳(移动端),偏好等下面异步的 loadThemeMode() 再定。
  installSystemThemeFollower({ subscribe: !((requestedSettingsWindow() || readDaemonSettingsWindow()) && isWindowsTauriShell()) });
  {
    const early = loadDesktopThemeMode();
    if (early !== undefined) setThemePreference(parseStoredThemePreference(early));
    // 字体大小 / 界面密度: same sync read on desktop, so the first frame is already at the saved scale.
    const earlyScale = loadDesktopUiScale();
    if (earlyScale !== undefined) setUiScalePrefs(parseStoredUiScale(earlyScale));
  }

  // One-time cleanup of attachment caches written before the download fix.
  // Versions before it wrote HTTP error bodies to the real filename, and a
  // non-empty error body is indistinguishable from a valid cached file, so
  // affected devices never retry and never recover on their own. Runs once
  // (guarded by a marker in the cache dir), fire-and-forget: a cache we
  // cannot clean is not a reason to block app start.
  useEffect(() => {
    purgeLegacyAttachmentCache().catch(() => {});
  }, []);

  // 0.2.82:`?tray=1` 的窗口是托盘面板 —— 无边框小窗,只画未读列表,不挂主界面/更新提示。
  if (readTrayPanelRoute()) {
    return (
      <SafeAreaProvider>
        <TrayPanel />
      </SafeAreaProvider>
    );
  }

  // `?imageViewer=1` 的窗口是「图片预览」独立窗口(桌面端点聊天里的图片打开)—— 只画看图页,
  // 不挂主界面/更新提示。图片列表经 Tauri 事件送来,URL 里没有图片也没有凭据(见 image-window-model.ts)。
  if (Platform.OS === 'web' && !!(globalThis as any).__TAURI_INTERNALS__ && readImageWindowRoute(String((globalThis as any).location?.search ?? ''))) {
    return (
      <SafeAreaProvider>
        <ImageViewerWindow />
      </SafeAreaProvider>
    );
  }

  // `?taskWindow=1` 的窗口是「在新窗口打开」的任务详情(桌面抽屉的 ⧉)—— 只画那一个任务,不挂主界面/更新提示。
  // 任务和账号经 Tauri 事件送来,URL 里没有任务也没有凭据(见 task-window-model.ts)。
  if (Platform.OS === 'web' && !!(globalThis as any).__TAURI_INTERNALS__ && readTaskWindowRoute(String((globalThis as any).location?.search ?? ''))) {
    return (
      <SafeAreaProvider>
        <TaskWindow />
      </SafeAreaProvider>
    );
  }

  if (Platform.OS === 'web' && !!(globalThis as any).__TAURI_INTERNALS__ && readDaemonSettingsWindow()) {
    return <SafeAreaProvider><DaemonSettingsWindow /></SafeAreaProvider>;
  }

  if (readFatalFixture()) {
    return (
      <SafeAreaProvider>
        <FatalFixtureScreen />
      </SafeAreaProvider>
    );
  }

  const notifyFixture = readNotifyFixture();
  if (notifyFixture) {
    return (
      <SafeAreaProvider>
        <NotifySettingsFixtureScreen fixture={notifyFixture} />
      </SafeAreaProvider>
    );
  }

  const updateFixture = readUpdatePromptFixture();
  if (updateFixture) {
    if (themeMode() !== updateFixture.theme) setThemeMode(updateFixture.theme);
    return (
      <SafeAreaProvider>
        <UpdatePromptFixtureScreen fixture={updateFixture} />
      </SafeAreaProvider>
    );
  }

  const daemonOverviewFixture = readDaemonOverviewFixture();
  if (daemonOverviewFixture) {
    if (themeMode() !== daemonOverviewFixture.theme) setThemeMode(daemonOverviewFixture.theme);
    return (
      <SafeAreaProvider>
        <DaemonOverviewFixtureScreen theme={daemonOverviewFixture.theme} mode={daemonOverviewFixture.mode} />
      </SafeAreaProvider>
    );
  }

  const cloneNodeFixture = readCloneNodeFixture();
  if (cloneNodeFixture) {
    if (themeMode() !== cloneNodeFixture.theme) setThemeMode(cloneNodeFixture.theme);
    return (
      <SafeAreaProvider>
        <CloneNodeFixtureScreen />
      </SafeAreaProvider>
    );
  }

  const hubFixture = readHubScopeFixture();
  if (hubFixture) {
    if (themeMode() !== hubFixture.theme) setThemeMode(hubFixture.theme);
    return (
      <SafeAreaProvider>
        <HubScopeFixtureScreen theme={hubFixture.theme} section={hubFixture.section} />
      </SafeAreaProvider>
    );
  }

  const fixture = readWebFixture();
  if (fixture) {
    // Before the first paint. useEffect was too late: the first frame stayed
    // on the default dark palette, which is the side this app already passes.
    if (themeMode() !== fixture.theme) setThemeMode(fixture.theme);
    return (
      <SafeAreaProvider>
        <UnreadBadgeFixtureScreen theme={fixture.theme} compact={fixture.compact} />
      </SafeAreaProvider>
    );
  }

  // 更新提示只在主窗口自动弹;分离出来的聊天窗(?chat=<alias>)不弹 —— 否则每个窗各弹一次
  // (Vincent 2026-09-06 截图:两个分离窗同时被同一份更新说明盖住)。
  // 应用多开的工作区窗口(?workspace=<profileId>)同理只让主窗口弹。
  // 设置窗(?settings=1)挂成 manual:只为在它里面手动点的检查弹 —— 不挂的话「发现新版本 · 点击查看并安装」
  // 点了没反应(0.2.145),检查结果只在设置窗自己的 JS 上下文里。见 update-prompt-model desktopPromptMode。
  const updatePromptMode = desktopPromptMode({
    tauri: Platform.OS === 'web' && !!(globalThis as any).__TAURI_INTERNALS__,
    chat: !!requestedChatAlias(),
    workspace: !!requestedWorkspaceProfileId(),
    settings: requestedSettingsWindow(),
  });
  return (
    <SafeAreaProvider>
      <SimulatedSafeArea>
        <View style={{ flex: 1 }}>
          <MacTitleStrip />
          <WinTitleBar />
          {/* 渲染期抛错:显示「出错了 · 重新加载」并记诊断,而不是整个 app 闪退(fatal-boundary.ts)。 */}
          <FatalBoundary>
            <AppRoot />
          </FatalBoundary>
          {/* 分离聊天窗(Windows):页头兼当标题栏,– □ × 浮在右上角 —— 见 src/popout-window-controls.tsx */}
          <PopoutWindowControls />
        </View>
        {updatePromptMode ? <DesktopUpdatePrompt manualOnly={updatePromptMode === 'manual'} /> : null}
        {Platform.OS === 'android' ? <AndroidUpdatePrompt /> : null}
      </SimulatedSafeArea>
    </SafeAreaProvider>
  );
}

// Web layout sweep only (src/safe-area-sim.ts): `?safeAreaSim=…` feeds simulated insets to every
// useSafeAreaInsets() below. On a device SAFE_AREA_SIM is null and this renders its children as-is.
function SimulatedSafeArea({ children }: { children: React.ReactNode }) {
  if (!SAFE_AREA_SIM) return <>{children}</>;
  return <SafeAreaInsetsContext.Provider value={SAFE_AREA_SIM}>{children}</SafeAreaInsetsContext.Provider>;
}

function AppRoot() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState<HubConfig | null>(null);
  // #552 —— 保存的网络过期了(登录时落的是个人网络,之后管理员把人拉进团队并授权 Agent):改内存里的 cfg、
  // 落到这个账号上(不切当前账号),并换一个新 cfg 对象让各页面按新网络重读。发送路径(api.ts sendTask)
  // 和下面的启动 / 切账号复核都走这里。
  const correctNetworkId = (target: HubConfig, networkId: string) => {
    target.networkId = networkId;
    void persistProfileNetworkId(target, networkId).catch(() => { /* 下次启动的复核会再改一次 */ });
    setCfg(prev => (prev && prev.serverUrl === target.serverUrl && prev.token === target.token ? { ...prev, networkId } : prev));
  };
  const correctNetworkIdRef = useRef(correctNetworkId);
  correctNetworkIdRef.current = correctNetworkId;
  useEffect(() => setNetworkIdPersister((target, networkId) => correctNetworkIdRef.current(target, networkId)), []);
  // 启动 / 切账号 / 登录后在后台复核一次(/api/auth/me 与其他页面共用,不多一次往返);读不到就不动。
  const revalidateNetworkId = (target: HubConfig | null) => {
    if (!target) return;
    void fetchAuthMe(target).then(me => {
      const next = reconcileNetworkId(me, target.networkId);
      if (next) correctNetworkIdRef.current(target, next);
    }).catch(() => { /* fail-open */ });
  };
  // app#168(手机端):会话置顶,按 profile/server 分、落盘;桌面端 DesktopWorkspace 自己管一份(localStorage)。
  const [mobilePins, setMobilePins] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    if (!cfg) { setMobilePins([]); return; }
    void loadChatPins(cfg).then(pins => { if (alive) setMobilePins(pins); });
    return () => { alive = false; };
  }, [cfg?.profileId, cfg?.serverUrl, cfg?.username]);
  const toggleMobilePin = (alias: string) => {
    if (!cfg) return;
    const next = togglePinned(mobilePins, alias);
    setMobilePins(next);
    void saveChatPins(next, cfg).catch(error => { console.warn('save chat pins failed', error); setMobilePins(mobilePins); });
  };
  const [screen, setScreen] = useState<Screen>({ name: 'login' });
  // 0.2.107 按 agent 的「消息免打扰」(系统通知不弹;消息照收)。按账号存,桌面和手机共用一份判据。
  const notifySettings = useSyncExternalStore(subscribeNotifySettings, loadNotifySettings, loadNotifySettings);
  const notifyKey = notifyProfileKey(cfg);
  const mutedAliases = mutedAgents(notifySettings, notifyKey);
  const toggleMute = (alias: string) => { saveNotifySettings(toggleAgentMuted(loadNotifySettings(), notifyKey, alias)); };
  const [booting, setBooting] = useState(true);
  const [reauthProfile, setReauthProfile] = useState<Pick<HubProfile, 'profileId' | 'serverUrl' | 'username' | 'displayName'> | null>(null);
  const [showRemoteLogin, setShowRemoteLogin] = useState(false);
  const [localHubStarting, setLocalHubStarting] = useState(false);
  const [localHubStage, setLocalHubStage] = useState<'preparing' | 'starting' | 'migrating' | null>(null);
  const [localHubError, setLocalHubError] = useState<string | null>(null);
  const initialChat = useMemo(() => requestedChatAlias(), []);
  const initialChatProfile = useMemo(() => requestedChatProfileId(), []);
  // 应用多开(Vincent 2026-09-07):?workspace=<profileId> 的窗口只「借用」那个账号,不动全局「当前账号」。
  const initialWorkspaceProfile = useMemo(() => requestedWorkspaceProfileId(), []);
  const borrowedProfile = initialWorkspaceProfile ?? initialChatProfile;
  // Keyed remount on theme switch: module-level styles were already
  // rebuilt by the onThemeChange listeners, the new key re-renders the tree.
  const [theme, setTheme] = useState(themeMode());
  // 字体大小 / 界面密度 (src/ui-scale.ts): part of the same keyed remount. The module-level styles were
  // already rebuilt by ui-scale's restyleAll() when this key changes.
  const scaleKey = useSyncExternalStore(onUiScaleChange, uiScaleKey, uiScaleKey);
  useEffect(() => {
    // 0.2.83:窗口自己的底色也跟主题走——Overlay 标题栏区域和 webview 未画出的那一帧露出来的是它,
    // 默认是白的(Vincent 2026-09-22 macOS 深色主题顶部白条)。失败不抛,底色只是保底。
    void applyWindowBackground(themeMode());
    return onThemeChange((m) => { setTheme(m); void applyWindowBackground(m); });
  }, []);
  // Scrollbars are painted by the browser, outside React Native's style
  // system, so they need the palette pushed to them explicitly.
  useEffect(() => installWebScrollbarTheme(), []);
  // 别的窗口改了偏好(localStorage 的 storage 事件):light / dark / system 都要认,
  // 否则在主窗选「跟随系统」,分离聊天窗不跟。
  useEffect(() => onDesktopThemeStorageChange(mode => {
    setThemePreference(parseStoredThemePreference(mode));
  }), []);
  useEffect(() => onDesktopUiScaleStorageChange(raw => setUiScalePrefs(parseStoredUiScale(raw))), []);
  // Mobile has no sync store: load the saved scale once (desktop already did it above, before the first frame).
  useEffect(() => {
    if (loadDesktopUiScale() !== undefined) return;
    let live = true;
    void loadUiScalePrefs().then(p => { if (live) setUiScalePrefs(p); });
    return () => { live = false; };
  }, []);
  // RN's SafeAreaView only covers iOS; Android edge-to-edge draws the
  // tab bar under the gesture bar (Vincent tg 802) — pad by the real inset.
  const insets = useSafeAreaInsets();
  // Safe-area rule 1 (src/modal-safe-area.ts): the main window's top inset is applied HERE, once.
  // Nothing rendered inside (screens, panes) pads the status bar again.
  const rootInset = { paddingTop: mainWindowTopPadding(layoutOs(), insets, statusBarHeight()) };
  const { width, height, fontScale } = useWindowDimensions();
  const tauriDesktop = Platform.OS === 'web' && !!(globalThis as any).__TAURI_INTERNALS__;
  // Layout choice lives in src/wide-layout.ts (pure + tested). Desktop is still exactly
  // `tauriDesktop && width >= 860`; Android at ≥ 700 dp (unfolded foldables, tablets) and
  // iPad in landscape (≥ 1024 pt, width > height) get list + detail; everything else is
  // the phone stack as before. Rotation changes width/height, so this follows the device.
  const layout = chooseAppLayout({
    os: Platform.OS,
    tauri: tauriDesktop,
    userAgent: Platform.OS === 'web' ? String((globalThis as any).navigator?.userAgent ?? '') : '',
    width,
    height,
    isPad: Platform.OS === 'ios' && Platform.isPad,
  });
  const desktop = layout === 'desktop';
  // Fold/unfold remounts the chat / node screens at a new tree position; bump the
  // handoff generation in this render (before their unmount cleanup runs) so the
  // unsent draft and the node tab are carried over. See src/layout-handoff.ts.
  // Only Android fold/unfold or iPad rotation (a switch into or out of 'twoPane') bumps: the desktop
  // ⇄ phone resize at 860 keeps its existing behaviour.
  const lastLayout = useRef(layout);
  if (lastLayout.current !== layout) {
    if (lastLayout.current === 'twoPane' || layout === 'twoPane') bumpLayoutGeneration();
    lastLayout.current = layout;
  }
  // 字体大小 / 界面密度 inputs: the wide two-pane defaults to 紧凑, and the OS font scale is composed
  // (capped) with the in-app choice. Layout effect → the re-keyed render happens before paint.
  // Web only: `?osFontScale=1.3` / `?uiScaleSim=legacy` simulate a device font scale for screenshots.
  const scaleSim = useMemo(() => (Platform.OS === 'web' ? parseUiScaleSim(String((globalThis as any).location?.search ?? '')) : parseUiScaleSim('')), []);
  useLayoutEffect(() => {
    setUiScaleLegacySim(scaleSim.legacy);
    setOsFontScale(scaleSim.osFontScale ?? fontScale ?? 1);
    setUiScaleLayoutWide(layout === 'twoPane');
  }, [layout, fontScale, scaleSim]);
  // A scale change remounts the whole tree (the key below). Carry the open chat's draft / node tab over
  // it exactly like a fold/unfold does (src/layout-handoff.ts): bump in the render that changes the key.
  const lastScaleKey = useRef(scaleKey);
  if (lastScaleKey.current !== scaleKey) {
    bumpLayoutGeneration();
    lastScaleKey.current = scaleKey;
  }
  const twoPaneSelection = layout === 'twoPane' ? paneSelectionFor(screen) : null;
  // Navigation chrome (src/nav-chrome.ts): the two-pane gets a left rail like the desktop
  // app (Vincent 0.2.100: 「下面那一栏放在左边会好一点」); the phone keeps its bottom tabs.
  // 设置的子页(手机)是二级页:收起底部 tab 栏(SettingsScreen onPhoneSubPageChange 报上来)。
  const [settingsSubPage, setSettingsSubPage] = useState(false);
  const inPageLeaf = phoneInPageLeaf(screen.name, settingsSubPage);
  const navChrome = navChromeFor(layout, screen.name, inPageLeaf);
  const navActive = navActiveKey(screen.name);
  const railShown = navChrome === 'rail';
  // Width to the right of the rail; the two panes split this, not the whole window.
  const paneAreaWidth = railShown ? contentWidthBesideRail(width, insets.left, insets.right, mobileRailWidth(uiScale().densityFactor)) : width;
  // 0.2.106: fixed 320 dp by default, dragged by the user (TwoPaneDivider), remembered per
  // device. listPaneWidth is the saved preference; twoPaneListWidth clamps it to 260–420 and
  // to what the current area leaves for the chat.
  const [listPaneWidth, setListPaneWidth] = useState(LIST_PANE_DEFAULT_WIDTH);
  useEffect(() => {
    let live = true;
    loadListPaneWidth().then(w => { if (live && w !== null) setListPaneWidth(w); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const onListPaneWidth = (w: number) => { setListPaneWidth(w); void saveListPaneWidth(w); };
  const paneListWidth = twoPaneListWidth(paneAreaWidth, listPaneWidth);
  const onNavPress = (key: string) => {
    const next = screenForNavPress(key, screen.name);
    if (next) setScreen(next as Screen);
  };
  const dedicatedChatWindow = tauriDesktop && !!initialChat;
  // Mac / Windows：设置是单独的窗口，不嵌进主窗口的三栏。
  const settingsWindow = tauriDesktop && requestedSettingsWindow();
  // #743:Windows 设置窗的原生标题栏跟 app 主题走(深色时不再是白条)。
  useEffect(() => (settingsWindow ? followThemeInSettingsTitleBar() : undefined), [settingsWindow]);
  const settingsCategoryBooted = useRef(false);
  if (settingsWindow && !settingsCategoryBooted.current) {
    settingsCategoryBooted.current = true;
    const category = requestedSettingsCategory();
    if (category) rememberSettingsCategory(category);
    const detail = requestedSettingsDetail();
    if (detail) requestSettingsDetail(detail);
  }
  const [settingsViewKey, setSettingsViewKey] = useState(0);
  // 0.2.76 系统栏托盘:只有主窗口接(分离聊天窗/工作区窗/设置窗不接,否则一个 app 多个托盘项)。
  // 托盘点某个 agent → 打开那个会话。
  const trayWindow = tauriDesktop && !initialChat && !initialWorkspaceProfile && !settingsWindow;
  // #429 任务 tab 的未读角标:主窗口 / 工作区窗口各数自己账号的;分离聊天窗、设置窗没有导航栏,不读。
  useTaskUnreadDriver(dedicatedChatWindow || settingsWindow ? null : cfg, screen.name === 'tasks' || screen.name === 'taskDetail');
  const taskUnread = railBadgeText(useTaskUnreadCount());
  useEffect(() => {
    if (!cfg || !trayWindow) return;
    return bindDesktopTray(
      alias => setScreen({ name: 'chat', alias }),
      () => { void dismissAllForConfig(cfg); },
      // #499 到期提醒的系统通知把任务编码进 alias(due-reminder-notify.taskOpenAlias):点它打开任务,不是会话。
      (requirementId, networkId) => openTaskRef(requirementId, networkId, cfg, setScreen),
    );
  }, [cfg?.profileId, cfg?.serverUrl, trayWindow]);
  const reloadMainSession = useRef<() => Promise<void>>(async () => {});
  reloadMainSession.current = async () => {
    const next = await loadConfig();
    await hydrateProfileLocalState(next);
    setCfg(next);
    setShowRemoteLogin(false);
    setReauthProfile(null);
    setScreen(next ? { name: 'agents' } : { name: 'login' });
  };
  useEffect(() => {
    if (!trayWindow) return;
    let dead = false;
    let unlisten: (() => void) | undefined;
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const stop = await listen(SETTINGS_SESSION_EVENT, () => { void reloadMainSession.current(); });
      if (dead) stop();
      else unlisten = stop;
    }).catch(() => {});
    return () => { dead = true; unlisten?.(); };
  }, [trayWindow]);
  useEffect(() => {
    if (!settingsWindow) return;
    let dead = false;
    let unlisten: (() => void) | undefined;
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const stop = await listen<{ category?: string; detail?: string }>(SETTINGS_CATEGORY_EVENT, (event) => {
        const category = settingsCategoryFromQuery(event.payload?.category ?? null);
        if (!category) return;
        rememberSettingsCategory(category);
        const detail = settingsDetailFromQuery(event.payload?.detail);
        if (detail) requestSettingsDetail(detail);
        setSettingsViewKey(n => n + 1);
      });
      if (dead) stop();
      else unlisten = stop;
    }).catch(() => {});
    return () => { dead = true; unlisten?.(); };
  }, [settingsWindow]);
  const tabBarInset = layoutOs() === 'android' ? insets.bottom : 0;
  // Bottom inset owner (rule 1): the tab bar when it shows; the chat composer pads itself
  // (ChatScreen composerInset) and so does the two-pane (panes below); any other full-screen
  // leaf gets it from navContent, so its last row is not under the gesture bar.
  const contentBottomInset = navChromeFor(layout, screen.name, inPageLeaf) === 'none' && screen.name !== 'chat' && screen.name !== 'dm' && screen.name !== 'group' && screen.name !== 'login' ? tabBarInset : 0;
  // Web layout sweep only: lets tests/test-layout-sweep/run.mjs open screens the phone has no
  // tab for (taskDetail, logs, wizard). Never set on a device (SAFE_AREA_SIM is web-only).
  useEffect(() => {
    if (!SAFE_AREA_SIM) return;
    (globalThis as any).__anetLayoutSweep = { setScreen: (next: Screen) => setScreen(next) };
    return () => { delete (globalThis as any).__anetLayoutSweep; };
  }, []);
  const workspaceKey = `${theme}:${scaleKey}:${cfg?.profileId ?? cfg?.serverUrl ?? 'login'}`;

  const hydrateProfileLocalState = async (profileCfg: HubConfig | null) => {
    const profileId = profileCfg?.profileId;
    const [localAvatars, outbox, forwards] = await Promise.all([loadLocalAvatars(profileId), loadOutbox(profileId), loadForwardOperations(profileId)]);
    initLocalAvatars(localAvatars, (map) => { void saveLocalAvatars(map, profileId); });
    initOutbox(outbox, (all) => { void saveOutbox(all, profileId); });
    initForwardController(forwards, createForwardPersistence(saveForwardOperations, profileId));
    // app#275:回复未读水位线按账号分 key(应用多开时两个账号窗口各算各的)。
    bindUnreadProfile(profileId);
  };

  const removeActiveProfile = async () => {
    clearChatConversationCache(cfg?.profileId, cfg?.serverUrl);
    clearConditionalReads();
    if (cfg?.profileId) await removeHubProfile(cfg.profileId);
    else await clearConfig();
    const next = await loadConfig();
    await hydrateProfileLocalState(next);
    setCfg(next);
    setScreen(next ? { name: 'agents' } : { name: 'login' });
    if (settingsWindow) {
      await notifySessionChanged();
      if (!next) await closeSettingsWindow();
    }
  };

  const finishLocalDataDeletion = async () => {
    clearConditionalReads();
    const next = await loadConfig();
    await hydrateProfileLocalState(next);
    setCfg(next);
    setShowRemoteLogin(false);
    setScreen(next ? { name: 'agents' } : { name: 'login' });
    if (settingsWindow) await notifySessionChanged();
  };

  const activateProfile = async (profileId: string, stay = false) => {
    // Local workspace:先启动本地 Hub(钥匙串凭据丢了会在这里自动恢复),再切 profile。
    // 工作区窗口里切账号只换这个窗口,不改主窗口的「当前账号」。
    // #467:条件 GET 记着的正文按账号分开,换账号时仍整个清掉(conditional-get.ts)。
    clearConditionalReads();
    const next = await activateHubProfile(profileId, { isDesktop: () => tauriDesktop, startLocalHub, switchHubProfile: initialWorkspaceProfile ? loadHubProfile : switchHubProfile });
    await hydrateProfileLocalState(next);
    setCfg(next);
    revalidateNetworkId(next);
    if (!stay) setScreen({ name: 'agents' });
    prefetchStatus(next);
    if (settingsWindow) await notifySessionChanged();
  };
  // 设置 →「编辑」改了当前账号的 Hub 地址:从存储重新读这个账号(新地址 + 原来的令牌)、按新地址重连,人留在设置里。
  const reloadEditedProfile = (profileId: string) => activateProfile(profileId, true);

  const requestProfileReauth = (profile: Pick<HubProfile, 'profileId' | 'serverUrl' | 'username' | 'displayName'>) => {
    clearChatConversationCache(profile.profileId, profile.serverUrl);
    clearConditionalReads();
    setReauthProfile(profile);
    setScreen({ name: 'login' });
  };

  // 手机 / 网页上迁移过来的账号 cfg 没有 profileId,它的 401 按 legacy 上报(api.ts authProfileId)——
  // 用 sessionIdOf 比,否则那些账号的登录过期永远没有人接,app 只是一直读失败。
  useEffect(() => onProfileUnauthorized(profileId => {
    if (!cfg || profileId !== sessionIdOf(cfg)) return;
    void (async () => {
      let superseded = false;
      try {
        superseded = !(await markHubProfileRequiresReauth(profileId, true, cfg.token));
      } finally {
        // Credential persistence can finish while this old callback is waiting.
        if (superseded || !isCurrentProfileCredential(profileId, cfg.token)) return;
        requestProfileReauth({ profileId, serverUrl: cfg.serverUrl, username: cfg.username ?? '', displayName: cfg.displayName });
      }
    })();
  }), [cfg]);

  // Restore the saved session on cold start — login survives app kills.
  // Desktop credential-store failures are not treated as "no session": keep
  // the app usable, log the diagnostic, and require a fresh login whose save
  // path now reports the error visibly.
  useEffect(() => {
    // 分离聊天窗 / 工作区窗都按窗口借用账号(以前聊天窗用 switchHubProfile,会把主窗口的「当前账号」一起切走)。
    Promise.all([borrowedProfile ? loadHubProfile(borrowedProfile).catch(() => loadConfig()) : loadConfig(), loadThemeMode()]).then(async ([stored, mode]) => {
      let saved = stored;
      if (tauriDesktop && stored?.profileId === LOCAL_HUB_PROFILE_ID) {
        const local = await startLocalHub();
        if (!local.session) throw new Error(local.error || '本地工作区启动后没有返回会话');
        saved = local.session;
      }
      // 移动端偏好在这里才读到(SecureStore 是异步的);null = 新装 → 跟随系统。
      setThemePreference(parseStoredThemePreference(mode));
      // R2 avatar: seed the per-device local echo layer + wire its writer, so
      // session-only aliases keep their user-set avatar across restarts.
      await hydrateProfileLocalState(saved);
      // PR3 判据C:恢复未送达 outbox(pending 一律恢复为 failed=命运未知按未送达),
      // 注入落盘写手——此后 提交即落盘/确认才删。
      if (saved) {
        setCfg(saved);
        revalidateNetworkId(saved);
        setScreen(initialChat ? { name: 'chat', alias: initialChat } : { name: 'agents' });
        // Fire the status request now so its RTT overlaps the boot→AgentsScreen
        // mount; AgentsScreen's first load consumes this in-flight promise.
        prefetchStatus(saved);
        // Vincent 2026-09-14:重启后不再自动把拆出去的聊天窗口全部重开(windows.json 仍记着,只是不再在启动时回放)。
      }
      setBooting(false);
    }).catch(error => {
      console.error('Failed to restore desktop session', error);
      setBooting(false);
    });
  }, [initialChat, borrowedProfile, initialWorkspaceProfile, tauriDesktop]);

  // R1 avatar (通信龙 07-31): hydrate the hub avatar layer from GET /api/nodes
  // so node-backed aliases render their cross-device avatar_url (Vincent changed
  // an avatar on web → phone should match, not the old pool image). Best-effort:
  // one immediate load when logged in, then a slow foreground poll to pick up
  // web-side changes. Failure just leaves pool avatars — never blocks/crashes.
  useEffect(() => {
    if (!cfg) return;
    let alive = true;
    // #692:同一份 /api/nodes 也告诉我们谁是守护节点(host_supervisor)—— 会话页换掉输入框、列表不画红点。
    fetchHubNodes(cfg).then(r => { if (alive) { hydrateHubAvatars(r.nodes); hydrateNodeRoles(r.nodes); } }).catch(() => {});
    return () => { alive = false; };
  }, [cfg]);
  usePoll(() => {
    if (cfg) fetchHubNodes(cfg).then(r => { hydrateHubAvatars(r.nodes); hydrateNodeRoles(r.nodes); }).catch(() => {});
  }, 30000, [cfg]);

  // System back (button or fullscreen gesture) navigates within the app
  // instead of exiting (Vincent tg 730). Agents/login fall through to
  // the default exit behavior.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // taskDetail is a full-screen leaf under the tasks tab — hardware
      // back should return to the tasks list, not skip past it back to
      // agents (that would lose the user's place in the task list).
      if (screen.name === 'taskDetail') {
        setScreen({ name: 'tasks' });
        return true;
      }
      // logs is a full-screen leaf under the Server tab — hardware back
      // returns to Server, not skipping past to Agents.
      if (screen.name === 'logs' || screen.name === 'serverDaemon') {
        setScreen({ name: 'server' });
        return true;
      }
      if (screen.name === 'nodeInfo') {
        setScreen(chatBackFromNodeInfo(screen));
        return true;
      }
      // Phone: 服务器 is pushed from 设置 (no bottom tab any more) — back returns there.
      if (phoneSettingsBackTarget(layout, screen.name)) {
        setScreen({ name: 'settings' });
        return true;
      }
      // 从节点页的「定时任务」分区点进来的:返回回到那个节点页,而不是跳回 Agents。
      if (screen.name === 'scheduled' && screen.back) {
        setScreen(screen.back);
        return true;
      }
      if (screen.name === 'wizard' && screen.back) {
        setScreen(screen.back);
        return true;
      }
      if (screen.name !== 'agents' && screen.name !== 'login') {
        setScreen({ name: 'agents' });
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [screen, layout]);

  // Phone bottom tab bar. The Android two-pane shows MobileNavRail instead (navChrome).
  const mobileTabBar = (activeName: string) => (
    <View style={[styles.tabBar, { paddingBottom: tabBarInset }]} testID="mobile-tab-bar">
      {MOBILE_TABS.map(tab => (
        <Pressable
          key={tab.key}
          style={styles.tab}
          accessibilityRole="tab"
          accessibilityLabel={tab.key === 'tasks' && taskUnread ? t('nav.tasksUnread', { label: t(tab.label), count: taskUnread }) : t(tab.label)}
          accessibilityState={{ selected: activeName === tab.key }}
          onPress={() => onNavPress(tab.key)}
          testID={`mobile-tab-${tab.key}`}
        >
          <View style={styles.tabIcon}>
            <Ionicons
              name={activeName === tab.key ? tab.iconActive : tab.icon}
              size={26}
              color={activeName === tab.key ? colors.accent : colors.textSecondary}
            />
            {tab.key === 'tasks' && taskUnread ? (
              <View style={styles.tabBadge} testID="mobile-tab-badge-tasks"><Text style={styles.tabBadgeText}>{taskUnread}</Text></View>
            ) : null}
          </View>
          <Text style={[styles.tabLabel, activeName === tab.key && styles.tabActive]}>
            {t(tab.label)}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  if (booting) {
    return (
      <SafeAreaView style={[styles.root, rootInset, styles.center, bootStyles.root]}>
        <BrandMark size={72} style={bootStyles.logo} />
        <Text style={bootStyles.title}>ANet</Text>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  // A window opened from the agent context menu is a WeChat-style detached
  // conversation: chat chrome only. Never mount DesktopWorkspace here, even
  // when the detached window is wide enough for the normal three-column UI.
  if (dedicatedChatWindow && cfg && (screen.name === 'chat' || screen.name === 'nodeInfo')) {
    const detachedAlias = screen.alias;
    // 页头兼当标题栏(Vincent 2026-09-30「上面那个还是挺多余的」):Windows 无原生标题栏、macOS 红黄绿灯进页头。
    const windowChrome = popoutChatChrome(Platform.OS);
    return (
      <SafeAreaView key={workspaceKey} style={[styles.root, rootInset]} testID="dedicated-chat-window">
        <StatusBar barStyle={theme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={colors.bg} />
        {screen.name === 'chat' ? (
          <ChatScreen
            cfg={cfg}
            alias={detachedAlias}
            daemonMgmt={screen.daemonMgmt}
            onBack={() => {}}
            onOpenNodeSettings={() => setScreen({ name: 'nodeInfo', alias: detachedAlias, daemonMgmt: screen.daemonMgmt })}
            onOpenManagedChat={managedAlias => setScreen({ name: 'chat', alias: managedAlias })}
            desktop
            windowChrome={windowChrome}
          />
        ) : (
          <NodeDetailScreen
            cfg={cfg}
            alias={detachedAlias}
            onBack={() => setScreen(chatBackFromNodeInfo(screen))}
            readOnly
            windowChrome={windowChrome}
          />
        )}
        <DesktopMessageListener cfg={cfg} />
        {/* On a chat the pin toggle is 聊天信息 → 窗口置顶; the header keeps a single ⋯. */}
        <DesktopWindowPin hidden={screen.name === 'chat'} />
      </SafeAreaView>
    );
  }

  if (settingsWindow && cfg && screen.name !== 'login') {
    return (
      <SafeAreaView key={workspaceKey} style={[styles.root, rootInset]} testID="dedicated-settings-window">
        <StatusBar barStyle={theme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={colors.bg} />
        <SettingsScreen
          key={settingsViewKey}
          cfg={cfg}
          // 独立设置窗不传 onClose:关窗走窗口自己的标题栏(Windows 原生 ×、macOS 红灯),
          // 侧栏左上角再画一个 ✕ 就是第二个关闭键(Vincent 2026-09-29「怎么有两个×」)。
          onLogout={removeActiveProfile}
          onLocalDataDeleted={finishLocalDataDeletion}
          onAddAccount={() => { setReauthProfile(null); setScreen({ name: 'login' }); }}
          onSwitchProfile={activateProfile}
          onReauthProfile={requestProfileReauth}
          onProfileEdited={reloadEditedProfile}
        />
      </SafeAreaView>
    );
  }

  if (desktop && cfg && screen.name !== 'login') {
    return (
      <SafeAreaView key={workspaceKey} style={[styles.root, rootInset]}>
        <StatusBar barStyle={theme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={colors.bg} />
        <DesktopWorkspace cfg={cfg} screen={screen} setScreen={setScreen} onLogout={removeActiveProfile} onLocalDataDeleted={finishLocalDataDeletion} onAddAccount={() => { setReauthProfile(null); setScreen({ name: 'login' }); }} onSwitchProfile={activateProfile} onReauthProfile={requestProfileReauth} onProfileEdited={reloadEditedProfile} />
        <DesktopMessageListener cfg={cfg} onOpenTask={id => openTaskNotice(id, cfg, setScreen)} />
        {trayWindow ? <DesktopNotifier onOpenChat={alias => setScreen({ name: 'chat', alias })} onOpenTask={(id, net) => openTaskRef(id, net, cfg, setScreen)} profileKey={notifyProfileKey(cfg)} /> : null}
        <LastCrashChip cfg={cfg} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView key={workspaceKey} style={[styles.root, rootInset]}>
      <StatusBar
        barStyle={theme === 'light' ? 'dark-content' : 'light-content'}
        backgroundColor={colors.bg}
      />
      {screen.name !== 'login' && cfg ? <DesktopMessageListener cfg={cfg} onOpenTask={id => openTaskNotice(id, cfg, setScreen)} /> : null}
      {/* 0.2.107 手机系统通知:登出(cfg=null)也要挂着,好让运行时停掉轮询和前台服务。 */}
      {Platform.OS === 'android' || Platform.OS === 'ios' ? <MobileNotifier cfg={cfg} onOpenChat={alias => setScreen({ name: 'chat', alias })} onOpenTask={taskId => setScreen({ name: 'taskDetail', taskId })} onOpenRequirement={(requirementId, networkId) => openTaskRef(requirementId, networkId, cfg, setScreen)} /> : null}
      {screen.name === 'login' || !cfg ? (
        tauriDesktop && !reauthProfile && !showRemoteLogin ? (
          <FirstRunScreen
            busy={localHubStarting}
            stage={localHubStage}
            error={localHubError}
            onStartLocal={async () => {
              setLocalHubStarting(true);
              setLocalHubStage('preparing');
              setLocalHubError(null);
              try {
                const status = await localHubStatus();
                setLocalHubStage(status.requiresMigration ? 'migrating' : 'starting');
                await new Promise(resolve => setTimeout(resolve, 0));
                const local = await startLocalHub();
                if (!local.session) throw new Error(local.error || '本地工作区启动后没有返回会话');
                await hydrateProfileLocalState(local.session);
                setCfg(local.session);
                setScreen({ name: 'agents' });
                prefetchStatus(local.session);
              } catch (error) {
                setLocalHubError(error instanceof Error ? error.message : String(error));
              } finally {
                setLocalHubStarting(false);
                setLocalHubStage(null);
              }
            }}
            onRemote={() => setShowRemoteLogin(true)}
          />
        ) : (
        <LoginScreen
          key={reauthProfile?.profileId ?? 'new-profile'}
          initialProfile={reauthProfile}
          onCancelReauth={reauthProfile ? async () => {
            const registry = await listHubProfiles();
            const fallback = registry.profiles.find(profile => profile.profileId !== reauthProfile.profileId && !profile.requiresReauth);
            if (!fallback) throw new Error('没有其他可用账号，请重新验证当前账号');
            setReauthProfile(null);
            await activateProfile(fallback.profileId);
          } : undefined}
          // 「添加账号」:当前账号还登录着(cfg 在)→ 可以取消,回到设置;登录成功时 saveConfig 新增账号、不动当前这个。
          onCancelAdd={cfg && !reauthProfile ? () => setScreen({ name: 'settings' }) : undefined}
          onLogin={async c => {
            const saved = await saveConfig(reauthProfile ? { ...c, profileId: reauthProfile.profileId, displayName: reauthProfile.displayName } : c);
            clearProfileUnauthorized(sessionIdOf(saved));
            setReauthProfile(null);
            await hydrateProfileLocalState(saved);
            setCfg(saved);
            setScreen(initialChat ? { name: 'chat', alias: initialChat } : { name: 'agents' });
            if (requestedSettingsWindow()) void notifySessionChanged();
          }}
        />
        )
      ) : (
        // One shell for phone and two-pane: [rail slot | content], then the bottom tab
        // slot. The rail and the tab bar are the only things that change on fold/unfold,
        // so a screen that renders the same in both layouts (定时任务 / 服务器 / 设置 …)
        // keeps its tree position and its state (scroll, inputs) across the switch.
        <>
          <View style={styles.navShell} testID="nav-shell">
            {railShown ? (
              <MobileNavRail
                tabs={MOBILE_RAIL_TABS}
                active={navActive}
                onSelect={onNavPress}
                insetLeft={insets.left}
                insetBottom={tabBarInset}
                showBrand={railShowsBrand(height)}
              />
            ) : null}
            <View style={[styles.navContent, railShown ? { paddingRight: insets.right } : { paddingLeft: insets.left, paddingRight: insets.right }, { paddingBottom: contentBottomInset }]}>
              {/* #653 弱密码横幅:只在各 tab 的首页(会话 / 设置 / 聊天页不放:聊天的键盘避让按「聊天是内容区第一个子节点」算)。 */}
              {PHONE_BANNER_SCREENS.has(screen.name) ? (
                <WeakPasswordBanner cfg={cfg} onOpen={() => { requestSettingsDetail('changePassword'); setScreen({ name: 'settings' }); }} />
              ) : null}
              {twoPaneSelection ? (
                // Android wide (unfolded foldable / tablet): phone-sized list on the left,
                // the same phone screens on the right. Navigation state is the same
                // `screen` value the phone stack uses, so folding back just re-reads it.
                // Safe-area insets: the rail takes the left one, navContent the right one.
                <View style={styles.twoPane} testID="android-two-pane">
                  <View style={[styles.twoPaneList, { width: paneListWidth, paddingBottom: tabBarInset }]} testID="two-pane-list">
                    <AgentsScreen
                      cfg={cfg}
                      filter={screen.name === 'agents' ? screen.filter : undefined}
                      selectedAlias={twoPaneSelection.selectedAlias}
                      onOpenChat={(alias, networkId) => setScreen({ name: 'chat', alias, networkId })}
                      onOpenPerson={p => setScreen(dmScreenFor(p))}
                      selectedPerson={screen.name === 'dm' ? screen.alias : undefined}
                      onOpenGroup={g => setScreen(groupScreenFor(g))}
                      selectedGroup={screen.name === 'group' ? screen.alias : undefined}
                      onOpenPicker={() => setScreen({ name: 'picker' })}
                      onOpenNodeDetail={alias => setScreen({ name: 'nodeDetail', alias })}
                      pinnedAliases={mobilePins}
                      onTogglePin={toggleMobilePin}
                      mutedAliases={mutedAliases}
                      onToggleMute={toggleMute}
                    />
                  </View>
                  <View style={[styles.twoPaneDetail, screen.name !== 'chat' && screen.name !== 'dm' && screen.name !== 'group' && { paddingBottom: tabBarInset }]} testID="two-pane-detail">
                    {screen.name === 'chat' ? (
                      <ChatScreen
                        key={`chat:${screen.alias}`}
                        cfg={cfg}
                        alias={screen.alias}
                        networkId={screen.networkId}
                        daemonMgmt={screen.daemonMgmt}
                        onBack={() => setScreen({ name: 'agents' })}
                        hideBack
                        onOpenNodeSettings={() => setScreen(nodeInfoFromChat(screen))}
                        onOpenVoiceSettings={() => { rememberSettingsCategory('voice'); setScreen({ name: 'settings' }); }}
                        onCreateNode={daemon => setScreen({ name: 'wizard', daemon, back: { name: 'chat', alias: screen.alias, networkId: screen.networkId, daemonMgmt: screen.daemonMgmt } })}
                        onOpenManagedChat={managedAlias => setScreen({ name: 'chat', alias: managedAlias, networkId: screen.networkId })}
                        onOpenTask={(id, net) => openTaskRef(id, net, cfg, setScreen)}
                        focusTaskId={screen.focusTaskId}
                        pinned={mobilePins.includes(screen.alias)}
                        onTogglePin={() => toggleMobilePin(screen.alias)}
                        muted={mutedAliases.includes(screen.alias)}
                        onToggleMute={() => toggleMute(screen.alias)}
                      />
                    ) : screen.name === 'dm' && cfg.networkId ? (
                      <DmChatScreen key={`dm:${screen.userId}`} cfg={cfg} networkId={cfg.networkId} peer={dmPeerOf(screen)} onBack={() => setScreen({ name: 'agents' })} onOpenTask={id => openTaskNotice(id, cfg, setScreen)} hideBack />
                    ) : screen.name === 'group' && cfg.networkId ? (
                      <DmChatScreen key={`group:${screen.alias}`} cfg={cfg} networkId={cfg.networkId} group={groupRefOf(screen)} onBack={() => setScreen({ name: 'agents' })} hideBack />
                    ) : screen.name === 'nodeInfo' ? (
                      <NodeDetailScreen key={`nodeInfo:${screen.alias}`} cfg={cfg} alias={screen.alias} onBack={() => setScreen(chatBackFromNodeInfo(screen))} readOnly layoutWidth={paneAreaWidth - paneListWidth} touch onOpenScheduled={open => setScreen({ name: 'scheduled', open, back: screen })} />
                    ) : screen.name === 'nodeDetail' ? (
                      <NodeDetailScreen key={`nodeDetail:${screen.alias}`} cfg={cfg} alias={screen.alias} onBack={() => setScreen({ name: 'agents' })} layoutWidth={paneAreaWidth - paneListWidth} touch onOpenScheduled={open => setScreen({ name: 'scheduled', open, back: screen })} />
                    ) : (
                      <View style={styles.twoPaneEmpty}>
                        <Ionicons name="chatbubbles-outline" size={52} color={colors.textMuted} />
                        <Text style={styles.twoPaneEmptyTitle}>{t('chat.empty')}</Text>
                        <Text style={styles.twoPaneEmptyHint}>{ROW_MENU_EMPTY_HINT}</Text>
                      </View>
                    )}
                  </View>
                  {/* Last child so it stacks above both panes; absolutely positioned over the border. */}
                  <TwoPaneDivider width={paneListWidth} areaWidth={paneAreaWidth} onWidth={onListPaneWidth} />
                </View>
              ) : screen.name === 'chat' ? (
                <ChatScreen
                  cfg={cfg}
                  alias={screen.alias}
                  networkId={screen.networkId}
                  daemonMgmt={screen.daemonMgmt}
                  onBack={() => setScreen({ name: 'agents' })}
                  onOpenNodeSettings={() => setScreen(nodeInfoFromChat(screen))}
                  onOpenVoiceSettings={() => { rememberSettingsCategory('voice'); setScreen({ name: 'settings' }); }}
                  onCreateNode={daemon => setScreen({ name: 'wizard', daemon, back: { name: 'chat', alias: screen.alias, networkId: screen.networkId, daemonMgmt: screen.daemonMgmt } })}
                  onOpenManagedChat={managedAlias => setScreen({ name: 'chat', alias: managedAlias, networkId: screen.networkId })}
                  onOpenTask={(id, net) => openTaskRef(id, net, cfg, setScreen)}
                  focusTaskId={screen.focusTaskId}
                  pinned={mobilePins.includes(screen.alias)}
                  onTogglePin={() => toggleMobilePin(screen.alias)}
                  muted={mutedAliases.includes(screen.alias)}
                  onToggleMute={() => toggleMute(screen.alias)}
                />
              ) : screen.name === 'dm' && cfg.networkId ? (
                <DmChatScreen key={`dm:${screen.userId}`} cfg={cfg} networkId={cfg.networkId} peer={dmPeerOf(screen)} onBack={() => setScreen({ name: 'agents' })} onOpenTask={id => openTaskNotice(id, cfg, setScreen)} />
              ) : screen.name === 'group' && cfg.networkId ? (
                // 手机:微信式推入的整页群聊,左上角返回会话列表。
                <DmChatScreen key={`group:${screen.alias}`} cfg={cfg} networkId={cfg.networkId} group={groupRefOf(screen)} onBack={() => setScreen({ name: 'agents' })} />
              ) : screen.name === 'nodeInfo' ? (
                <NodeDetailScreen cfg={cfg} alias={screen.alias} onBack={() => setScreen(chatBackFromNodeInfo(screen))} readOnly onOpenScheduled={open => setScreen({ name: 'scheduled', open, back: screen })} />
              ) : screen.name === 'nodeDetail' ? (
                // issue #8 row 4 (V1) — 会话行菜单(长按)里的「节点详情」
                // opens this. Back returns to agents. Rendered as its own screen
                // (not a tab) so the tab bar doesn't compete for the header slot.
                <NodeDetailScreen
                  cfg={cfg}
                  alias={screen.alias}
                  onBack={() => setScreen({ name: 'agents' })}
                  onOpenScheduled={open => setScreen({ name: 'scheduled', open, back: screen })}
                />
              ) : screen.name === 'picker' ? (
                // #338 RFC-026 §9.4 — modal-style screen, hides tab bar to keep
                // the wizard flow focused. System back / on-screen back returns
                // to the agents tab.
                <HostSupervisorPickerScreen
                  cfg={cfg}
                  onBack={() => setScreen({ name: 'agents' })}
                  // #338 wizard rest (Plan B) — replaces the previous Alert TODO
                  // with a real navigation into the create-node wizard.
                  onPicked={d => setScreen({ name: 'wizard', daemon: d })}
                />
              ) : screen.name === 'wizard' ? (
                // #338 wizard rest — multi-step create-node form. Back returns
                // to picker (to re-pick daemon); Exit (after done / cancel)
                // returns to Agents.
                <CreateNodeWizardScreen
                  cfg={cfg}
                  daemon={screen.daemon}
                  onBack={() => setScreen(screen.back ?? { name: 'picker' })}
                  onExit={() => setScreen(screen.back ?? { name: 'agents' })}
                />
              ) : screen.name === 'taskDetail' ? (
                // Task detail — full-screen (no tab bar), matches the mobile
                // two-level pattern: list → detail → back. Hardware back and
                // the on-screen chevron both return to the tasks tab.
                <TaskDetailScreen
                  cfg={cfg}
                  taskId={screen.taskId}
                  onBack={() => setScreen({ name: 'tasks' })}
                />
              ) : screen.name === 'logs' ? (
                // Row 6 — network event stream (SSE). Full-screen leaf reached
                // from the Server tab's "查看事件流" button. Same routing shape
                // as taskDetail. Back returns to Server.
                <LogsScreen
                  cfg={cfg}
                  onBack={() => setScreen({ name: 'server' })}
                  onOpenChat={(alias, focusTaskId) => setScreen({ name: 'chat', alias, focusTaskId })}
                  onOpenTask={taskId => setScreen({ name: 'taskDetail', taskId })}
                />
              ) : (
                <View style={{ flex: 1 }}>
                  {screen.name === 'tasks' ? (
                    <TasksScreen
                      cfg={cfg}
                      onOpenTask={taskId => setScreen({ name: 'taskDetail', taskId })}
                      onOpenVoiceSettings={() => { rememberSettingsCategory('voice'); setScreen({ name: 'settings' }); }}
                    />
                  ) : screen.name === 'scheduled' ? (
                    <ScheduledTasksScreen key={screen.open ? `scheduled:${screen.open.seq}` : 'scheduled'} cfg={cfg} open={screen.open} onOpenChat={(alias, focusTaskId) => setScreen({ name: 'chat', alias, focusTaskId })} />
                  ) : screen.name === 'messages' ? (
                    <MessagesScreen cfg={cfg} />
                  ) : screen.name === 'server' ? (
                    <ServerScreen
                      cfg={cfg}
                      onOpenLogs={() => setScreen({ name: 'logs' })}
                      onOpenAgents={filter => setScreen(agentListScreen(filter, 'mobile') as Screen)}
                      onOpenDaemon={alias => setScreen(openDaemonFromHub(alias))}
                      onOpenNodes={() => setScreen({ name: 'agents' })}
                      onCreateNode={() => setScreen({ name: 'picker' })}
                      onOpenScheduled={() => setScreen({ name: 'scheduled' })}
                      onOpenProviders={() => setScreen({ name: 'hubProviders' })}
                      onBack={phoneSettingsBackTarget(layout, screen.name) ? () => setScreen({ name: 'settings' }) : undefined}
                    />
                  ) : screen.name === 'hubProviders' || (screen.name === 'serverPending' && screen.tab === 'provider') ? (
                    <HubProviderManagementScreen cfg={cfg} onBack={() => setScreen({ name: 'server' })} />
                  ) : screen.name === 'serverDaemon' ? (
                    <HubDaemonEntryScreen
                      cfg={cfg}
                      onBack={() => setScreen({ name: 'server' })}
                      onOpenDaemon={alias => setScreen(openDaemonFromHub(alias))}
                    />
                  ) : screen.name === 'settings' ? (
                    <SettingsScreen
                      cfg={cfg}
                      onClose={() => setScreen({ name: 'agents' })}
                      onLogout={removeActiveProfile}
                      onAddAccount={() => { setReauthProfile(null); setScreen({ name: 'login' }); }}
                      onSwitchProfile={activateProfile}
                      onReauthProfile={requestProfileReauth}
                      onProfileEdited={reloadEditedProfile}
                      onLocalDataDeleted={finishLocalDataDeletion}
                      onPhoneSubPageChange={setSettingsSubPage}
                      onOpenServer={layout === 'phone' ? () => setScreen({ name: 'server' }) : undefined}
                    />
                  ) : (
                    <AgentsScreen
                      cfg={cfg}
                      filter={screen.name === 'agents' ? screen.filter : undefined}
                      onOpenChat={(alias, networkId) => setScreen({ name: 'chat', alias, networkId })}
                      onOpenPerson={p => setScreen(dmScreenFor(p))}
                      onOpenGroup={g => setScreen(groupScreenFor(g))}
                      onOpenPicker={() => setScreen({ name: 'picker' })}
                      onOpenNodeDetail={alias => setScreen({ name: 'nodeDetail', alias })}
                      pinnedAliases={mobilePins}
                      onTogglePin={toggleMobilePin}
                      mutedAliases={mutedAliases}
                      onToggleMute={toggleMute}
                    />
                  )}
                </View>
              )}
              {/* 连接状态(App战线①):手机上是内容区右上角一个小圆点(绝对定位,不推内容),点按看全文;
                  有左栏时它在左栏版本号旁边(MobileNavRail)。见 src/ConnectivityIndicator.tsx。 */}
              {railShown ? null : <ConnectivityIndicator placement="corner" />}
            </View>
          </View>
          {navChrome === 'bottomTabs' ? mobileTabBar(navActive) : null}
        </>
      )}
      {/* 上次异常退出:角落小提示,~8 秒自动隐藏(fatal-runtime / LastCrashChip)。 */}
      {screen.name !== 'login' && cfg ? <LastCrashChip cfg={cfg} /> : null}
    </SafeAreaView>
  );
}

export function FirstRunScreen({ busy, stage, error, onStartLocal, onRemote }: {
  busy: boolean;
  stage: 'preparing' | 'starting' | 'migrating' | null;
  error: string | null;
  onStartLocal: () => Promise<void>;
  onRemote: () => void;
}) {
  const entryStyles = useMemo(makeEntryStyles, []);
  const { width } = useWindowDimensions();
  const compact = width < 520;
  return (
    <View style={entryStyles.root} testID="first-run-local-hub">
      <ScrollView style={loginStylesShared.scrollView} contentContainerStyle={loginStylesShared.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={[entryStyles.card, compact && entryStyles.cardCompact]}>
        <BrandMark size={96} style={entryStyles.logo} />
        <Text style={entryStyles.title}>ANet</Text>
        <Text style={entryStyles.copy}>在这台电脑创建本地工作区，数据留在本机；也可以登录已有 Hub。</Text>
        {error ? <View style={entryStyles.errorBox}><Ionicons name="alert-circle-outline" size={17} color={colors.failed} /><Text style={entryStyles.error}>{maskUrlsInText(error)}</Text></View> : null}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          style={({ pressed }) => [entryStyles.primary, busy && entryStyles.disabled, pressed && entryStyles.pressed]}
          onPress={() => { void onStartLocal(); }}
        >
          {busy ? (
            <View style={entryStyles.busyRow} testID={`local-hub-stage-${stage ?? 'preparing'}`}>
              <ActivityIndicator color={colors.onAccent} />
              <Text style={entryStyles.primaryText}>{stage === 'migrating' ? '正在备份并迁移…' : stage === 'starting' ? '正在启动本地服务…' : '正在准备本地工作区…'}</Text>
            </View>
          ) : <Text style={entryStyles.primaryText}>创建本地工作区</Text>}
        </Pressable>
        <Pressable accessibilityRole="button" disabled={busy} style={({ pressed }) => [entryStyles.secondary, pressed && entryStyles.secondaryPressed]} onPress={onRemote}>
          <Ionicons name="globe-outline" size={17} color={colors.textSecondary} />
          <Text style={entryStyles.secondaryText}>使用已有 Hub 登录</Text>
        </Pressable>
        <PreloginUpdateCheck />
      </View>
      </ScrollView>
    </View>
  );
}

const makeEntryStyles = () => StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
  card: { width: '100%', maxWidth: 440, gap: 14, paddingHorizontal: 32, paddingVertical: 32, borderRadius: radius.surface, backgroundColor: colors.card, ...elevated('floating') },
  cardCompact: { paddingHorizontal: 22, paddingVertical: 26, borderRadius: radius.surface },
  logo: { width: 72, height: 72, borderRadius: appIconRadius(72), alignSelf: 'center' },
  title: { color: colors.text, fontSize: 24, lineHeight: 32, fontWeight: '600', letterSpacing: -0.2, textAlign: 'center' },
  copy: { color: colors.textSecondary, fontSize: 14, lineHeight: 22, textAlign: 'center', maxWidth: 390, alignSelf: 'center' },
  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 11, borderRadius: radius.control, backgroundColor: themeMode() === 'light' ? '#fff1f2' : '#291417', borderWidth: 1, borderColor: themeMode() === 'light' ? '#fecdd3' : '#552329' },
  error: { flex: 1, color: colors.failed, fontSize: 12, lineHeight: 18 },
  primary: { ...buttonStyle('primary') },
  disabled: { backgroundColor: colors.border },
  pressed: { transform: [{ scale: 0.99 }], opacity: 0.9 },
  primaryText: { ...buttonTextStyle('primary') },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  primaryTextDisabled: { color: colors.textMuted },
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  secondary: { ...buttonStyle('secondary'), flexDirection: 'row', gap: 8 },
  secondaryPressed: { backgroundColor: colors.border },
  secondaryText: { ...buttonTextStyle('secondary') },
});

const loginStylesShared = StyleSheet.create({
  scrollView: { width: '100%' },
  scrollContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 20 },
});

// #193 机制:模块级 StyleSheet 引用主题值必须随主题重建,否则冻在导入时的那套颜色。
const makeBootStyles = () => StyleSheet.create({
  root: { backgroundColor: colors.bg, gap: 14 },
  logo: { width: 96, height: 96, borderRadius: appIconRadius(96) },
  title: { color: colors.text, fontSize: 18, fontWeight: '600', letterSpacing: 0.3 },
});
let bootStyles = makeBootStyles();
onThemeChange(() => { bootStyles = makeBootStyles(); });

function DesktopWorkspace({ cfg, screen, setScreen, onLogout, onLocalDataDeleted, onAddAccount, onSwitchProfile, onReauthProfile, onProfileEdited }: {
  cfg: HubConfig;
  screen: Screen;
  setScreen: (screen: Screen) => void;
  onLogout: () => void | Promise<void>;
  onLocalDataDeleted: () => void | Promise<void>;
  onAddAccount: () => void;
  onSwitchProfile: (profileId: string) => void | Promise<void>;
  onReauthProfile: (profile: Pick<HubProfile, 'profileId' | 'serverUrl' | 'username' | 'displayName'>) => void;
  onProfileEdited: (profileId: string) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  // AppRoot is keyed by theme, so this component remounts after every theme
  // switch. Build desktop styles on that mount instead of freezing the dark
  // palette once at module import time.
  const desktopStyles = useMemo(makeDesktopStyles, []);
  // 导航栏悬停提示(微信/飞书式):只记当前悬停的 tab key,提示条挂在按钮右侧。
  const [railHover, setRailHover] = useState<string | null>(null);
  const taskUnread = useTaskUnreadCount();
  const [pinnedAliases, setPinnedAliases] = useState(() => loadPinnedChats(cfg.profileId));
  useEffect(() => setPinnedAliases(loadPinnedChats(cfg.profileId)), [cfg.profileId]);
  const togglePin = (alias: string) => setPinnedAliases(current => {
    const next = current.includes(alias) ? current.filter(item => item !== alias) : [alias, ...current];
    savePinnedChats(next, cfg.profileId);
    return next;
  });
  // 0.2.107:列表右键菜单里的「消息免打扰」(和手机会话页右上角的铃铛是同一份设置)。
  const notifySettings = useSyncExternalStore(subscribeNotifySettings, loadNotifySettings, loadNotifySettings);
  const notifyKey = notifyProfileKey(cfg);
  const mutedAliases = mutedAgents(notifySettings, notifyKey);
  const toggleMute = (alias: string) => { saveNotifySettings(toggleAgentMuted(loadNotifySettings(), notifyKey, alias)); };
  const serverWorkspace = ['server', 'serverPending', 'serverDaemon', 'serverNodes', 'serverNodeDetail', 'logs', 'picker', 'wizard', 'hubSkills', 'hubTokens', 'hubEnv', 'hubProviders'].includes(screen.name);
  const taskWorkspace = screen.name === 'tasks' || screen.name === 'taskDetail';
  useSyncExternalStore(subscribeNodeRoles, nodeRolesVersion, nodeRolesVersion);
  // Daemon management has its own navigation; unrelated conversations should
  // not take a second sidebar. Keep the rail so returning to Agents is one click.
  const daemonWorkspace = (screen.name === 'chat' || screen.name === 'nodeInfo')
    && (screen.daemonMgmt || isHostSupervisorAlias(screen.alias));
  // 设置 → 快捷键(src/shortcuts-model.ts):主窗口的全局键盘快捷键。组合可改,读的是最新存储;
  // 设置页正在录入新组合时不执行。⌘K:列表栏是服务器侧栏时先切回 Agents,再请求聚焦搜索框。
  const [shortcutToast, setShortcutToast] = useState<string | null>(null);
  useEffect(() => {
    if (!shortcutToast) return;
    const id = setTimeout(() => setShortcutToast(null), 2000);
    return () => clearTimeout(id);
  }, [shortcutToast]);
  const serverWorkspaceRef = useRef(serverWorkspace);
  // 任务页的左栏也不是会话列表(TaskFilterSidebar):⌘K 同样先切回 Agents —— 除非任务页自己的搜索框接走了
  // (列表 / 看板 / 甘特图上 ⌘K 聚焦任务搜索,RequirementBoard 在 window 捕获阶段 preventDefault;派发记录上照旧)。
  serverWorkspaceRef.current = serverWorkspace || taskWorkspace || daemonWorkspace;
  useEffect(() => {
    const doc = (globalThis as any).document;
    if (!doc?.addEventListener) return;
    const mac = isMacKeyboard();
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || shortcutCaptureActive()) return;
      const id = shortcutForCombo(shortcutBindings(), comboFromEvent(event, mac));
      if (!id) return;
      event.preventDefault();
      const action = shortcutAction(id);
      // 语音快捷键:会话页开着时 ChatScreen 在 window 捕获阶段已经接走(到不了这里);到了这里 = 没有输入框。
      if (action.kind === 'voice') {
        if (!event.repeat) setShortcutToast(NEED_COMPOSER_NOTICE);
        return;
      }
      if (action.kind === 'agentSearch') {
        if (serverWorkspaceRef.current) setScreen({ name: 'agents' });
        requestAgentSearchFocus();
        return;
      }
      if (action.kind === 'screen' && action.screen === 'settings') {
        void openSettingsWindow().then(opened => { if (!opened) setScreen({ name: 'settings' }); });
        return;
      }
      setScreen({ name: action.screen } as Screen);
    };
    // 捕获阶段:RN-web 的 TextInput 在自己的 keydown 里 stopPropagation,冒泡阶段的监听在焦点落在
    // 任何输入框(聊天输入框、agent 搜索框…)时一个键都收不到 —— 实测过:焦点在搜索框里按 Ctrl+2 不切页。
    doc.addEventListener('keydown', onKey, true);
    return () => doc.removeEventListener('keydown', onKey, true);
  }, [setScreen]);
  // With no back header on desktop, the rail must light up the page a detail belongs to (任务详情 → 任务).
  const active = serverWorkspace ? 'server' : ['chat', 'dm', 'group', 'nodeDetail', 'nodeInfo'].includes(screen.name) ? 'agents' : screen.name === 'taskDetail' ? 'tasks' : screen.name;
  const content = screen.name === 'chat' ? (
    <ChatScreen
      cfg={cfg}
      alias={screen.alias}
      networkId={screen.networkId}
      daemonMgmt={screen.daemonMgmt}
      onBack={() => setScreen({ name: 'agents' })}
      onOpenNodeSettings={() => setScreen(nodeInfoFromChat(screen))}
      onCreateNode={daemon => setScreen({ name: 'wizard', daemon, back: { name: 'chat', alias: screen.alias, networkId: screen.networkId, daemonMgmt: screen.daemonMgmt } })}
      onOpenManagedChat={managedAlias => setScreen({ name: 'chat', alias: managedAlias, networkId: screen.networkId })}
      onOpenVoiceSettings={() => { rememberSettingsCategory('voice'); void openSettingsWindow('voice').then(opened => { if (!opened) setScreen({ name: 'settings' }); }); }}
      onOpenTask={(id, net) => openTaskRef(id, net, cfg, setScreen)}
      focusTaskId={screen.focusTaskId}
      pinned={pinnedAliases.includes(screen.alias)}
      onTogglePin={() => togglePin(screen.alias)}
      muted={mutedAliases.includes(screen.alias)}
      onToggleMute={() => toggleMute(screen.alias)}
      desktop
    />
  ) : screen.name === 'dm' && cfg.networkId ? (
    <DmChatScreen key={`dm:${screen.userId}`} cfg={cfg} networkId={cfg.networkId} peer={dmPeerOf(screen)} onBack={() => setScreen({ name: 'agents' })} onOpenTask={id => openTaskNotice(id, cfg, setScreen)} desktop />
  ) : screen.name === 'group' && cfg.networkId ? (
    // 桌面:左边会话列表里点群,右边面板就是群聊(和私信同一个面板,没有返回键)。
    <DmChatScreen key={`group:${screen.alias}`} cfg={cfg} networkId={cfg.networkId} group={groupRefOf(screen)} onBack={() => setScreen({ name: 'agents' })} desktop />
  ) : screen.name === 'tasks' ? (
    <TasksScreen cfg={cfg} desktop onOpenTask={taskId => setScreen({ name: 'taskDetail', taskId })} onOpenVoiceSettings={() => { rememberSettingsCategory('voice'); void openSettingsWindow('voice').then(opened => { if (!opened) setScreen({ name: 'settings' }); }); }} />
  ) : screen.name === 'scheduled' ? <ScheduledTasksScreen key={screen.open ? `scheduled:${screen.open.seq}` : 'scheduled'} cfg={cfg} open={screen.open} onOpenChat={(alias, focusTaskId) => setScreen({ name: 'chat', alias, focusTaskId })} />
  : screen.name === 'messages' ? <MessagesScreen cfg={cfg} />
  : screen.name === 'server' ? (
    <ServerScreen
      cfg={cfg}
      onOpenLogs={() => setScreen({ name: 'logs' })}
      onOpenAgents={filter => setScreen(agentListScreen(filter, 'desktop') as Screen)}
      onOpenDaemon={alias => setScreen(openDaemonFromHub(alias))}
      onOpenNodes={() => setScreen({ name: 'serverNodes' })}
      onCreateNode={() => setScreen({ name: 'picker' })}
      onOpenScheduled={() => setScreen({ name: 'scheduled' })}
      onSwitchProfile={onSwitchProfile}
      onAddServer={onAddAccount}
    />
  )
  : screen.name === 'serverPending' ? <HubPendingScreen cfg={cfg} tab={screen.tab} />
  : screen.name === 'serverDaemon' ? <HubDaemonEntryScreen cfg={cfg} desktop onBack={() => setScreen({ name: 'server' })} onOpenDaemon={alias => setScreen(openDaemonFromHub(alias))} />
  : screen.name === 'serverNodes' ? <AgentsScreen cfg={cfg} filter={screen.filter} onOpenChat={alias => setScreen({ name: 'serverNodeDetail', alias })} onOpenPicker={() => setScreen({ name: 'picker' })} onOpenNodeDetail={alias => setScreen({ name: 'serverNodeDetail', alias })} />
  : screen.name === 'serverNodeDetail' ? <NodeDetailScreen cfg={cfg} alias={screen.alias} onBack={() => setScreen({ name: 'serverNodes' })} desktop onOpenScheduled={open => setScreen({ name: 'scheduled', open, back: screen })} />
  : screen.name === 'settings' ? <SettingsScreen cfg={cfg} onLogout={onLogout} onLocalDataDeleted={onLocalDataDeleted} onAddAccount={onAddAccount} onSwitchProfile={onSwitchProfile} onReauthProfile={onReauthProfile} onProfileEdited={onProfileEdited} />
  : screen.name === 'taskDetail' ? <TaskDetailScreen cfg={cfg} taskId={screen.taskId} onBack={() => setScreen({ name: 'tasks' })} desktop />
  : screen.name === 'nodeDetail' ? <NodeDetailScreen cfg={cfg} alias={screen.alias} onBack={() => setScreen({ name: 'agents' })} desktop onOpenScheduled={open => setScreen({ name: 'scheduled', open, back: screen })} />
  : screen.name === 'nodeInfo' ? <NodeDetailScreen cfg={cfg} alias={screen.alias} onBack={() => setScreen(chatBackFromNodeInfo(screen))} readOnly desktop onOpenScheduled={open => setScreen({ name: 'scheduled', open, back: screen })} />
  : screen.name === 'logs' ? <LogsScreen cfg={cfg} onBack={() => setScreen({ name: 'server' })} onOpenChat={(alias, focusTaskId) => setScreen({ name: 'chat', alias, focusTaskId })} onOpenTask={taskId => setScreen({ name: 'taskDetail', taskId })} desktop />
  : screen.name === 'picker' ? <HostSupervisorPickerScreen cfg={cfg} onBack={() => setScreen({ name: 'server' })} onPicked={d => setScreen({ name: 'wizard', daemon: d })} desktop />
  : screen.name === 'wizard' ? <CreateNodeWizardScreen cfg={cfg} daemon={screen.daemon} onBack={() => setScreen(screen.back ?? { name: 'picker' })} onExit={() => setScreen(screen.back ?? { name: 'serverNodes' })} desktop />
  : screen.name === 'hubSkills' ? <HubSkillsPane cfg={cfg} />
  : screen.name === 'hubEnv' ? <HubSecretsPane cfg={cfg} onOpenTokens={() => setScreen({ name: 'hubTokens' })} />
  : screen.name === 'hubProviders' ? <HubProviderManagementScreen cfg={cfg} />
  : screen.name === 'hubTokens' ? <HubTokenManagementScreen cfg={cfg} />
  : hubSectionForScreen(screen.name) ? <HubScopeScreen key={screen.name} section={hubSectionForScreen(screen.name)!} />
  : (
    <View style={desktopStyles.empty}>
      <Ionicons name="chatbubbles-outline" size={52} color={colors.textMuted} />
      <Text style={desktopStyles.emptyTitle}>{t('chat.empty')}</Text>
      <Text style={desktopStyles.emptyHint}>{t('chat.emptyHint')}</Text>
    </View>
  );

  return (
    <View style={desktopStyles.shell}>
      <View style={desktopStyles.rail} testID="desktop-rail">
        {/* The rail carries the theme mark, not the plated app icon. Scheme 16's
            plate is bright blue; at 36px it still reads as a tile and collides
            with the active-tab pill. mark-light / mark-dark are the stroke on
            transparency. The box stays oversized so the stroke matches the
            22px nav icons. */}
        <View style={desktopStyles.railBrand}>
          <BrandMark size={54} style={desktopStyles.railBrandMark} />
        </View>
        <View style={desktopStyles.railTabs}>
          {DESKTOP_MAIN_TABS.map(tab => (
            <RailButton
              key={tab.key}
              tab={tab}
              active={active === tab.key}
              hovered={railHover === tab.key}
              onHover={setRailHover}
              onPress={() => setScreen({ name: tab.key } as Screen)}
              styles={desktopStyles}
              badge={tab.key === 'tasks' ? taskUnread : null}
              badgeHint={tab.key === 'tasks' ? 'nav.tasksUpdated' : undefined}
            />
          ))}
        </View>
        <RailButton
          tab={DESKTOP_SETTINGS_TAB}
          active={active === DESKTOP_SETTINGS_TAB.key}
          hovered={railHover === DESKTOP_SETTINGS_TAB.key}
          onHover={setRailHover}
          onPress={() => { void openSettingsWindow().then(opened => { if (!opened) setScreen({ name: 'settings' }); }); }}
          styles={desktopStyles}
          extraStyle={desktopStyles.railSettings}
        />
        {/* 连接状态(App战线①):不再是顶部全宽横幅,是版本号左边一个小圆点,悬停/点按看全文(ConnectivityIndicator)。 */}
        <ConnectivityIndicator placement="rail" label={`v${APP_VERSION}`} labelStyle={desktopStyles.railVersionText} style={desktopStyles.railVersion} />
      </View>
      {!daemonWorkspace ? <View testID="desktop-workspace-sidebar" style={[desktopStyles.conversations, taskWorkspace && desktopStyles.taskSidebar]}>
        {taskWorkspace ? (
          // 任务页的左栏是筛选(全部 / 我负责的 / 按节点 / 派发记录),不是会话列表。
          <TaskFilterSidebar onNavigate={() => { if (screen.name !== 'tasks') setScreen({ name: 'tasks' }); }} />
        ) : serverWorkspace ? (
          <ServerSidebar cfg={cfg} active={serverSectionForScreen(screen)} onSelect={section => {
            if (section === 'overview') setScreen({ name: 'server' });
            else if (section === 'nodes') setScreen({ name: 'serverNodes' });
            else if (section === 'create') setScreen({ name: 'picker' });
            else if (section === 'logs') setScreen({ name: 'logs' });
            else if (isHubPendingSection(section)) setScreen({ name: 'serverPending', tab: section });
            else if (section === 'daemon') setScreen({ name: 'serverDaemon' });
            else {
              const hub = hubSectionForScreen(section);
              if (hub) openHubSection(hub, setScreen);
            }
          }} />
        ) : (
          <AgentsScreen cfg={cfg} compact selectedAlias={screen.name === 'chat' || screen.name === 'nodeInfo' ? screen.alias : undefined} pinnedAliases={pinnedAliases} onTogglePin={togglePin} mutedAliases={mutedAliases} onToggleMute={toggleMute} onOpenChatWindow={alias => { void openRememberedChatWindow(alias, cfg.profileId, cfg.username || maskedHubHost(cfg.serverUrl)); }} onOpenChat={(alias, networkId) => setScreen({ name: 'chat', alias, networkId })} onOpenPerson={p => setScreen(dmScreenFor(p))} selectedPerson={screen.name === 'dm' ? screen.alias : undefined} onOpenGroup={g => setScreen(groupScreenFor(g))} selectedGroup={screen.name === 'group' ? screen.alias : undefined} onOpenPicker={() => setScreen({ name: 'picker' })} onOpenNodeDetail={alias => setScreen({ name: 'nodeDetail', alias })} />
        )}
      </View> : null}
      <View style={desktopStyles.content}>
        {/* #653 弱密码横幅:右侧内容栏顶上;点了打开设置窗口的「修改密码」(没有桌面壳时嵌在主窗口)。 */}
        {screen.name !== 'settings' ? (
          <WeakPasswordBanner cfg={cfg} desktop onOpen={() => { void openSettingsWindow('account', 'changePassword').then(opened => { if (!opened) { requestSettingsDetail('changePassword'); setScreen({ name: 'settings' }); } }); }} />
        ) : null}
        {content}<ShortcutToast text={shortcutToast} />
      </View>
    </View>
  );
}

// 桌面左侧导航栏按钮:40×40 命中区、激活=淡 accent 底 + accent 图标、悬停/聚焦=浅底、
// 悬停时右侧弹出文字提示(触屏没有悬停,不显示)。角标是图标右上角的小圆标,不是行内文字。
function RailButton({ tab, active, hovered, onHover, onPress, styles, extraStyle, badge, badgeHint }: {
  tab: { key: string; label: string; icon: string; iconActive: string };
  active: boolean;
  hovered: boolean;
  onHover: (key: string | null) => void;
  onPress: () => void;
  styles: ReturnType<typeof makeDesktopStyles>;
  extraStyle?: object;
  badge?: number | null;
  /** 有角标时悬停提示的后半句(i18n 键,含 {count}),如「任务 · 3 个任务有新动态」;数字标红。 */
  badgeHint?: string;
}) {
  const badgeText = railBadgeText(badge);
  const { t } = useTranslation();
  const [hintBefore, hintAfter] = badgeText && badgeHint ? t(badgeHint, { count: '\u0000' }).split('\u0000') : [];
  return (
    <View style={[styles.railSlot, extraStyle]}>
      <Pressable
        accessibilityLabel={badgeText && badgeHint ? `${t(tab.label)}, ${t(badgeHint, { count: badgeText })}` : t(tab.label)}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        onPress={onPress}
        onHoverIn={() => onHover(tab.key)}
        onHoverOut={() => onHover(null)}
        style={state => {
          const surface = railSurface({ active, hovered: (state as { hovered?: boolean }).hovered, focused: (state as { focused?: boolean }).focused, pressed: state.pressed });
          return [styles.railButton, surface === 'active' && styles.railButtonActive, surface === 'hover' && styles.railButtonHover];
        }}
      >
        <Ionicons name={railIconFor(tab, active ? tab.key : '') as keyof typeof Ionicons.glyphMap} size={22} color={active ? colors.accent : colors.textSecondary} />
        {badgeText ? (
          <View style={styles.railBadge} testID={`desktop-rail-badge-${tab.key}`}><Text style={styles.railBadgeText}>{badgeText}</Text></View>
        ) : null}
      </Pressable>
      {railTooltipVisible(hovered ? tab.key : null, tab.key, true) ? (
        <View style={styles.railTooltip} pointerEvents="none">
          <Text style={styles.railTooltipText} numberOfLines={1}>
            {t(tab.label)}
            {hintAfter !== undefined ? <>{' · '}{hintBefore}<Text style={styles.railTooltipCount}>{badgeText}</Text>{hintAfter}</> : null}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function openHubSection(section: HubSection, setScreen: (screen: Screen) => void) {
  setScreen({ name: screenForHubSection(section) });
}

function serverSectionForScreen(screen: Screen): ServerSection {
  if (screen.name === 'serverPending') return screen.tab;
  if (screen.name === 'serverDaemon') return 'daemon';
  const hub = hubSectionForScreen(screen.name);
  if (hub) return screenForHubSection(hub);
  if (screen.name === 'serverNodes' || screen.name === 'serverNodeDetail') return 'nodes';
  if (screen.name === 'picker' || screen.name === 'wizard') return 'create';
  if (screen.name === 'logs') return 'logs';
  return 'overview';
}

const makeDesktopStyles = () => StyleSheet.create({
  shell: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  // 微信/飞书式 rail:64 宽、比列表深一档的底、右侧发丝线;按钮 40×40 等距 12;
  // 激活 = 10 圆角淡 accent 底;悬停/聚焦 = 浅底;提示条挂在右侧。
  rail: { width: ds(64), backgroundColor: colors.railBg, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border, alignItems: 'center', paddingTop: ds(14), paddingBottom: ds(10), zIndex: 10, overflow: 'visible' },
  railBrand: { width: ds(36), height: ds(36), alignItems: 'center', justifyContent: 'center' },
  railBrandMark: { width: ds(54), height: ds(54) },
  railTabs: { flex: 1, paddingTop: ds(18), gap: ds(12), alignItems: 'center' },
  railSlot: { width: ds(40), height: ds(40), alignItems: 'center', justifyContent: 'center' },
  railButton: { width: ds(40), height: ds(40), borderRadius: radius.control, alignItems: 'center', justifyContent: 'center' },
  railButtonActive: { backgroundColor: colors.railActiveBg },
  railButtonHover: { backgroundColor: colors.railHover },
  // 角标左缘锚在图标右上角内侧(badge-anchor.ts):数字变宽时向外长,不盖图标。
  railBadge: { position: 'absolute', ...badgeOffsetCentered(ds(40), ds(40), ds(22), 16), minWidth: 16, height: 16, borderRadius: radius.pill, paddingHorizontal: 4, backgroundColor: colors.failed, alignItems: 'center', justifyContent: 'center' },
  railBadgeText: { color: '#fff', fontSize: 9, fontWeight: '600', lineHeight: 12 },
  railTooltip: { position: 'absolute', left: ds(48), top: 8, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.item, backgroundColor: colors.railTooltipBg, zIndex: 20 },
  railTooltipText: { color: colors.railTooltipText, fontSize: 12, fontWeight: '500' },
  // 提示条在两套主题下都是深底:数字用浅红,深底上读得清(纯红 #dc2626 在深底上发闷)。
  railTooltipCount: { color: '#fca5a5', fontWeight: '600' },
  railSettings: { marginBottom: 0 },
  railVersion: { marginTop: 8 },
  railVersionText: { color: colors.textMuted, fontSize: 10, textAlign: 'center' },
  // 任务页左栏只是筛选,不需要会话列表那么宽:窄一些,看板三列拿到更多宽度。
  taskSidebar: { width: ds(220) },
  conversations: { width: ds(310), borderRightWidth: 1, borderRightColor: colors.border, backgroundColor: themeMode() === 'light' ? '#fafafb' : colors.bg },
  content: { flex: 1, minWidth: 0, backgroundColor: themeMode() === 'light' ? '#f2f4f7' : colors.bg },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  emptyTitle: { color: colors.textSecondary, fontSize: 16, fontWeight: '600' },
  emptyHint: { color: colors.textMuted, fontSize: 12 },
});

// 任务通知私信(meta.task_notice)→ 留条子给任务页(task-open-request.ts)再切过去:桌面是抽屉,手机是推入的详情页。
function openTaskNotice(requirementId: string, cfg: HubConfig, setScreen: (s: Screen) => void) {
  requestOpenTask({ requirementId, networkId: cfg.networkId ?? null });
  setScreen({ name: 'tasks' });
}
/** #499 系统通知点开的任务:通知里带了网络就用它(提醒可能来自别的网络),否则当前网络。 */
function openTaskRef(requirementId: string, networkId: string | null, cfg: HubConfig | null, setScreen: (s: Screen) => void) {
  requestOpenTask({ requirementId, networkId: networkId ?? cfg?.networkId ?? null });
  setScreen({ name: 'tasks' });
}

// 人员行 → 私信页;私信页 → DmChatScreen 要的对方。
const dmScreenFor = (p: Human) => ({ name: 'dm' as const, alias: p.username, userId: p.user_id, displayName: p.display_name ?? null, avatarUrl: p.avatar_url ?? null });
const dmPeerOf = (s: { alias: string; userId: string; displayName?: string | null; avatarUrl?: string | null }): Human => ({ user_id: s.userId, username: s.alias, display_name: s.displayName ?? null, avatar_url: s.avatarUrl ?? null });
// 群行 → 群聊页(alias = group_id,和私信一样走「详情」那一套导航:双栏右侧 / 手机推入 / 桌面右面板)。
const groupScreenFor = (g: { group_id: string; name: string }) => { rememberGroupName(g.group_id, g.name); return { name: 'group' as const, alias: g.group_id, groupName: g.name }; };
const groupRefOf = (s: { alias: string; groupName?: string }): GroupChatRef => ({ group_id: s.alias, name: s.groupName || groupNameFor(s.alias) || s.alias });

export function LoginScreen({ onLogin, initialProfile, onCancelReauth, onCancelAdd }: {
  onLogin: (cfg: HubConfig) => Promise<void>;
  initialProfile?: Pick<HubProfile, 'profileId' | 'serverUrl' | 'username'> | null;
  onCancelReauth?: () => Promise<void>;
  /** 切换账号 →「添加账号」:已经登录着一个账号时打开的登录页。给了就是添加模式,带一个返回当前账号的按钮。 */
  onCancelAdd?: () => void;
}) {
  const { t } = useTranslation();
  const [serverUrl, setServerUrl] = useState(initialProfile?.serverUrl ?? '');
  const [username, setUsername] = useState(initialProfile?.username ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  // hub 的登录闲置过期(401 token_expired):标题直接说「登录已过期，请重新登录」,而不是泛泛的「重新验证」。
  const expired = !!initialProfile && profileUnauthorizedReason(initialProfile.profileId) === 'token_expired';
  const clientLabel = clientLabelForLogin({ os: Platform.OS, shell: tauriShellPlatform(Platform.OS), version: APP_VERSION });
  // 多用户(hub#2084):登录页可切到「注册」—— POST /api/auth/register,成功后用返回的令牌按登录同一条路径进工作区。
  // 重新验证某个账号时不给注册入口。
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [displayName, setDisplayName] = useState('');
  const registering = mode === 'register' && !initialProfile;
  const entryStyles = useMemo(makeEntryStyles, []);
  const loginStyles = useMemo(makeLoginStyles, []);
  const { width } = useWindowDimensions();
  const compact = width < 520;

  // PR4:失败按 kind 分开渲染(凭据错/网络不可达/地址不对/服务器异常——用户下一步
  // 动作完全不同,不许合并成一句「登录失败」)。error=null 即无错。
  const [failKind, setFailKind] = useState<LoginFailureKind | null>(null);
  const [failDetail, setFailDetail] = useState('');

  const submit = async () => {
    setFailKind(null); setFailDetail(''); setError('');
    // 预检:URL 规范化(自动补 https://·去尾斜杠);不合法 → bad-url,不发网络请求。
    const norm = normalizeServerUrl(serverUrl);
    if (!norm.ok) { setFailKind('bad-url'); return; }
    if (registering) {
      const problem = validateNewUser({ username, password });
      if (problem) { setError(t(`users.err.${problem}`)); return; }
      setBusy(true);
      try {
        const created = await registerHubAccount(norm.url, { username: username.trim(), password, client_label: clientLabel, ...(displayName.trim() ? { display_name: displayName.trim() } : {}) });
        if (!created.token) throw new Error('register ok but no token in response');
        const cfg: HubConfig = { serverUrl: norm.url, token: created.token, username: username.trim() };
        cfg.networkId = await fetchNetworkId(cfg);
        await onLogin(cfg);
      } catch (registerError) {
        setError(`${t('login.registerFailed')}: ${registerError instanceof Error ? registerError.message : String(registerError)}`);
      }
      setBusy(false);
      return;
    }
    setBusy(true);
    const result = await login(norm.url, username.trim(), password, clientLabel);
    if (result.ok) {
      // #653:弱密码登录 → 记下来,顶部横幅提示去改;正常登录 → 清掉旧标记(在别处已经改过了)。
      await weakPasswordFlags.recordLogin(result.cfg, result.mustChangePassword);
      try {
        await onLogin(result.cfg);
      } catch (saveError) {
        setError(`无法保存登录状态：${saveError instanceof Error ? saveError.message : String(saveError)}`);
      }
    } else {
      setFailKind(result.kind); setFailDetail(result.error);
    }
    setBusy(false);
  };

  return (
    <KeyboardAvoidingView style={entryStyles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined} testID="login-screen">
      <ScrollView style={loginStyles.scrollView} contentContainerStyle={loginStyles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={[entryStyles.card, loginStyles.card, compact && entryStyles.cardCompact]}>
        <BrandMark size={96} style={entryStyles.logo} />
        <View style={loginStyles.heading}>
          <Text style={entryStyles.title} testID={expired ? 'login-expired-title' : onCancelAdd && !initialProfile && !registering ? 'login-add-account-title' : undefined}>{expired ? t('sessions.expiredTitle') : initialProfile ? '重新验证账号' : registering ? t('login.registerTitle') : onCancelAdd ? t('accounts.addTitle') : '连接你的工作区'}</Text>
          <Text style={entryStyles.copy}>{expired ? t('sessions.expiredCopy') : initialProfile ? '登录状态已失效。重新验证只会更新这个账号，其他工作区不会受到影响。' : registering ? t('login.registerCopy') : onCancelAdd ? t('accounts.addCopy') : '输入 Hub 和账号信息，继续与你的 Agent 协作。'}</Text>
        </View>
        <View style={loginStyles.form}>
          <View style={loginStyles.field}>
            <Text style={loginStyles.label}>Hub 地址</Text>
            <View style={loginStyles.inputShell}>
              <Ionicons name="server-outline" size={18} color={colors.textMuted} />
              <TextInput
                style={loginStyles.input}
                placeholder="https://your-hub.example.com"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                value={serverUrl}
                onChangeText={setServerUrl}
                accessibilityLabel="Hub 地址"
              />
            </View>
          </View>
          <View style={loginStyles.field}>
            <Text style={loginStyles.label}>用户名</Text>
            <View style={loginStyles.inputShell}>
              <Ionicons name="person-outline" size={18} color={colors.textMuted} />
              <TextInput
                style={loginStyles.input}
                placeholder="输入用户名"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                value={username}
                onChangeText={setUsername}
                accessibilityLabel="用户名"
              />
            </View>
          </View>
          <View style={loginStyles.field}>
            <Text style={loginStyles.label}>密码</Text>
            <View style={loginStyles.inputShell}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} />
              <TextInput
                style={loginStyles.input}
                placeholder={registering ? t('users.passwordHint') : '输入密码'}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                secureTextEntry={!passwordVisible}
                value={password}
                onChangeText={setPassword}
                accessibilityLabel="密码"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={passwordVisible ? '隐藏密码' : '显示密码'}
                hitSlop={8}
                onPress={() => setPasswordVisible(current => !current)}
                style={loginStyles.eyeButton}
              >
                <Ionicons name={passwordVisible ? 'eye-off-outline' : 'eye-outline'} size={19} color={colors.textSecondary} />
              </Pressable>
            </View>
          </View>
          {registering ? (
            <View style={loginStyles.field}>
              <Text style={loginStyles.label}>{t('login.displayName')}</Text>
              <View style={loginStyles.inputShell}>
                <Ionicons name="happy-outline" size={18} color={colors.textMuted} />
                <TextInput
                  style={loginStyles.input}
                  placeholderTextColor={colors.textMuted}
                  autoCorrect={false}
                  value={displayName}
                  onChangeText={setDisplayName}
                  accessibilityLabel={t('login.displayName')}
                  testID="register-display-name"
                />
              </View>
            </View>
          ) : null}
        </View>
      {/* 每种失败分开渲染:testID=login-error-<kind>(结构可断言·不耦合文案);
          文案=发生了什么+下一步做什么;服务器原始信息作小字辅助不当主文案。 */}
      {failKind ? (
        <View testID={`login-error-${failKind}`} style={loginStyles.errorBox} accessibilityRole="alert">
          <Ionicons name="alert-circle-outline" size={18} color={colors.failed} />
          <View style={loginStyles.errorCopy}>
          <Text style={loginStyles.errorTitle}>{LOGIN_FAILURE_COPY[failKind].what}</Text>
          <Text style={loginStyles.errorNext}>{LOGIN_FAILURE_COPY[failKind].next}</Text>
          {failDetail ? (
            <Text style={loginStyles.errorDetail} numberOfLines={2}>{maskUrlsInText(failDetail)}</Text>
          ) : null}
          </View>
        </View>
      ) : error ? (
        <View style={loginStyles.errorBox} accessibilityRole="alert"><Ionicons name="alert-circle-outline" size={18} color={colors.failed} /><Text style={loginStyles.errorTitle}>{maskUrlsInText(error)}</Text></View>
      ) : null}
      <Pressable
        style={({ pressed }) => [entryStyles.primary, (!serverUrl || !username || !password) && loginStyles.inactive, pressed && entryStyles.pressed]}
        onPress={submit}
        disabled={busy || !serverUrl || !username || !password}
        testID="login-submit"
      >
        {busy ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} testID="login-busy">
            <ActivityIndicator color={colors.onAccent} />
            <Text style={entryStyles.primaryText}>正在安全连接…</Text>
          </View>
        ) : (
          <Text style={[entryStyles.primaryText, (busy || !serverUrl || !username || !password) && entryStyles.primaryTextDisabled]}>{registering ? t('login.registerSubmit') : '登录工作区'}</Text>
        )}
      </Pressable>
      {!initialProfile ? (
        <Pressable
          style={entryStyles.secondary}
          accessibilityRole="button"
          onPress={() => { setMode(registering ? 'login' : 'register'); setError(''); setFailKind(null); }}
          testID="login-mode-toggle"
        >
          <Text style={entryStyles.secondaryText}>{registering ? t('login.haveAccount') : t('login.noAccount')}</Text>
        </Pressable>
      ) : null}
      {onCancelReauth ? (
        <Pressable style={entryStyles.secondary} onPress={() => { void onCancelReauth().catch(cancelError => setError(String(cancelError))); }}>
          <Text style={entryStyles.secondaryText}>暂不处理，切换其他账号</Text>
        </Pressable>
      ) : onCancelAdd ? (
        <Pressable testID="login-cancel-add" style={entryStyles.secondary} onPress={onCancelAdd}>
          <Text style={entryStyles.secondaryText}>{t('accounts.cancelAdd')}</Text>
        </Pressable>
      ) : null}
      {/* Version on the login page so device screenshots are
          unambiguous about which build is installed (tg 692). */}
      <PreloginUpdateCheck />
      </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeLoginStyles = () => StyleSheet.create({
  scrollView: { width: '100%' },
  scrollContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 20 },
  card: { maxWidth: 450, gap: 18 },
  heading: { gap: 7 },
  form: { gap: 13, marginTop: 1 },
  field: { gap: 7 },
  label: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginLeft: 2 },
  inputShell: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: radius.control, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border },
  input: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14, paddingVertical: 12, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}) },
  eyeButton: { width: 28, height: 34, alignItems: 'center', justifyContent: 'center' },
  inactive: { backgroundColor: colors.border },
  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 11, borderRadius: radius.control, backgroundColor: themeMode() === 'light' ? '#fff1f2' : '#291417', borderWidth: 1, borderColor: themeMode() === 'light' ? '#fecdd3' : '#552329' },
  errorCopy: { flex: 1 },
  errorTitle: { flex: 1, color: colors.failed, fontSize: 12, lineHeight: 18, fontWeight: '600' },
  errorNext: { color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 2 },
  errorDetail: { color: colors.textMuted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  securityNote: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 5, marginTop: -3 },
  version: { color: colors.textMuted, fontSize: 10 },
});
