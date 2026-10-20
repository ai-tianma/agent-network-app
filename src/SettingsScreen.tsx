import ModalKeyboardAvoider from './ModalKeyboardAvoider';
import { maskedHubHost } from './mask-hub-address';
import { t as tr } from './i18n';
import './i18n-fatal';
import { fatalSummary } from './fatal-report';
import { copyLastFatal, useLastFatalReport } from './use-last-fatal';
import { useTranslation } from './i18n-react';
import { settingsText } from './i18n-settings';
import { localizedThemeSummary } from './i18n-settings-presentation';
import { Children, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ActivityIndicator, AppState, BackHandler, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { HubConfig } from './api';
import { DesktopStorageDiagnostics, HubProfile, getDesktopStorageDiagnostics, listHubProfiles, markHubProfileRequiresReauth, removeHubProfile, saveConfig, saveThemeMode, sessionIdOf } from './storage';
import AccountSwitcher from './AccountSwitcher';
import { ACCOUNT_TOAST_MS, AccountActionSheet, AccountEditDialog, AccountMoreMenu, AccountToast, accountName, copyAccountLine } from './AccountRowActions';
import { accountMenuItems, accountRowActions, type AccountMenuItem, type AccountRowAction } from './account-row-actions';
import { pointerUi } from './pointer-ui';
import './i18n-accounts';
import { THEME_PREFERENCES, THEME_PREFERENCE_LABEL, colors, onThemeChange, onThemePreferenceChange, setThemePreference, spacing, themeMode, themePreference, themePreferenceSummary, type ThemePreference, radius } from './theme';
import { APP_VERSION } from './version';
import { BrandMark } from './brand-mark';
import { checkDesktopUpdate, desktopUpdateLastCheckedAt, desktopUpdateSnapshot, subscribeDesktopUpdates } from './desktop-updater';
import { describeUpdateRow } from './update-check-state';
import { IOS_UPDATE_ROW, openTestFlight } from './ios-testflight';
import { androidUpdateLastCheckedAt, androidUpdateSnapshot, checkAndroidUpdate, subscribeAndroidUpdates } from './android-updater';
import { describeAndroidUpdateRow } from './android-update-core';
import { backupLocalHubData, deleteLocalHubData, LOCAL_HUB_PROFILE_ID, localHubStatus, openLocalHubLogs, restartLocalHub, stopLocalHub, type LocalHubResult } from './local-hub';
import { openWorkspaceWindow } from './desktop-chat-menu';
import { loadNotifySettings, mutedAgents, notifyProfileKey, saveNotifySettings, subscribeNotifySettings, toggleAgentMuted, type NotifySettings } from './notify-settings';
import { permissionOnUserAction, type PermissionStatus } from './mobile-notify-model';
import { dndAccessGranted, mobileNotificationsSupported, notificationPermission, openAppNotificationSettings, openDndAccessSettings, requestNotificationPermission } from './mobile-notifications';
import NotifyDiagnosticsPanel from './NotifyDiagnosticsPanel';
import { getNotifyDiagnostics, subscribeNotifyDiagnostics } from './notify-diagnostics';
import { keepAliveAvailable, keepAliveLastError, keepAliveRunning, subscribeKeepAlive } from './keep-alive';
import { refreshNotifyDiagnostics, sendTestNotification } from './notifier-runtime';
import XiaomiGuideModal from './XiaomiGuideModal';
import VoiceSettingsSection from './VoiceSettingsSection';
import UiScaleSettings from './UiScaleSettings';
import LanguageSettings from './LanguageSettings';
import ShortcutsSettings from './ShortcutsSettings';
import { ds } from './ui-scale';
import { playChime } from './chime';
import { SETTINGS_CATEGORIES, SETTINGS_DETAIL_TITLE, activeCategoryKey, clearPendingSettingsDetail, closeSettingsPage, peekPendingSettingsDetail, filterSettings, phoneRowLabel, phoneSettingsGroups, rememberSettingsCategory, rememberSettingsScroll, rememberedSettingsView, settingsBackTarget, settingsPlatform, visibleRowKeys, type SettingsCategoryKey, type SettingsDetailKey, type SettingsHeaderOverride, type SettingsPlatform } from './settings-model';
import SettingsPhonePage, { accountSubtitle, type PhonePagesCtx } from './SettingsPhonePages';
import { PHONE_SETTINGS_SERVER_ENTRY } from './nav-chrome';
import { SETTINGS_ROW_PAD_X, settingsRowMinHeight, SettingsAccountRow, SettingsActionRow, SettingsButton, SettingsCardContent, SettingsControlRow, SettingsGroup, SettingsRow, SettingsSwitchRow, settingsPageContentStyle } from './settings-kit';
import { useModalSafePadding } from './safe-area-runtime';

import { withBasePadding } from './modal-safe-area';
import { elevated, buttonStyle, buttonTextStyle } from './elevation';
import UserManagementPanel from './UserManagementPanel';
import AgentOrgScreen from './AgentOrgScreen';
import { ManageDepartmentPhone } from './ManageDepartment';
import { managedDepartmentIds } from './org-model';
import { canManageUsers, type AuthMe } from './user-admin';
import { useLoginSessions } from './useLoginSessions';
import { groupSubtitle, groupTestKey, memberSubtitle, sessionSubtitle, visibleSessions, SESSIONS_VISIBLE_DEFAULT, type DeviceKind, type LoginSession } from './login-sessions';
import { probeSavedSessions } from './saved-session-probe';
import { fetchAuthMe, forgetAuthMeFor } from './user-admin-api';
import { pooledHttpEnabled, setPooledHttpEnabled } from './app-fetch';
import { showPooledHttpDiagnostics, tapVersion, VERSION_TAPS_INITIAL } from './diagnostics-reveal';
import { ChangelogPage } from './ChangelogScreen';
import './i18n-password';
import ChangePasswordPanel from './ChangePasswordPanel';
import UserAvatarEditor from './UserAvatarEditor';
import { useChangePassword } from './useChangePassword';
import { useWeakPassword, weakPasswordFlags } from './weak-password-flag';
import { clearProfileUnauthorized, verifyProfileCredentialWith, profileAuthRevision } from './profile-auth-state';

/** 设置里居中确认框的遮罩色(有键盘避让的那个画在 ModalKeyboardAvoider 上)。 */
const MODAL_SCRIM = 'rgba(0,0,0,0.55)';

// Settings (Vincent tg 720): who am I, where am I connected, which network, which build —
// and the destructive actions live here instead of cluttering the agents list header.
//
// 0.2.83(Vincent 2026-09-20「设置改为这种样式和交互吧」,参照 Claude 桌面端):
//   左栏 = 搜索框 + 分类列表(图标 + 名字,当前项高亮);右栏 = 分类标题 + 「标签在左、控件在右」
//   的行,需要说明的行下面一句灰字;段与段之间细线。搜索按行标签跨分类筛。
//   分类与可搜行的**模型**在 settings-model.ts(纯逻辑、有测试);这里只负责把真实状态渲染进去。
//   0.2.80 的滚动修复保留:右栏是 ScrollView,padding 在 contentContainer 上。
//
// 手机窄屏(Vincent 2026-09-27「手机设置照微信的设置做」):不画左栏,改成单列分组列表 ——
//   浅灰地面上的白色行(标签 + 右侧值 + ›),小灰字组标题 通用 / 功能 / 帮助与关于,底部整宽「退出登录」。
//   点一行推入该分类的子页(左上返回箭头);安卓系统返回 / 网页 Esc 回到列表。
//   分组在 settings-model.ts 的 PHONE_SETTINGS_GROUPS。
//   子页(Vincent 2026-09-27「设置界面有点体验太差」)不再复用宽屏右栏的密排表单,改由
//   SettingsPhonePages.tsx 用 settings-kit 的卡片 / 行 / ✓ 单选 / 开关 / 整宽按钮画;要输入的东西在
//   三级编辑页(SettingsEditPages.tsx)。子页开着时 App 收起底部 tab 栏(onPhoneSubPageChange)。

interface Me {
  username?: string;
  networkName?: string;
  networkId?: string;
}

export default function SettingsScreen({
  cfg,
  onClose,
  onLogout,
  onLocalDataDeleted,
  onAddAccount,
  onSwitchProfile,
  onReauthProfile,
  onProfileEdited,
  notifyPreview,
  onPhoneSubPageChange,
  onOpenServer,
}: {
  cfg: HubConfig;
  /** 桌面端:左上角关闭按钮。不传就不画(手机端设置是一个 tab,没有「关闭」)。 */
  onClose?: () => void;
  onLogout: () => void | Promise<void>;
  onLocalDataDeleted: () => void | Promise<void>;
  onAddAccount: () => void;
  onSwitchProfile: (profileId: string) => void | Promise<void>;
  onReauthProfile: (profile: Pick<HubProfile, 'profileId' | 'serverUrl' | 'username' | 'displayName'>) => void;
  /** 「编辑」改了当前账号的 Hub 地址:按新地址重新连接,留在设置里。不传就退回 onSwitchProfile(会回到列表)。 */
  onProfileEdited?: (profileId: string) => void | Promise<void>;
  /** 只给 web 验收夹具用(NotifySettingsFixtureScreen):在浏览器里按手机平台渲染通知设置。 */
  notifyPreview?: NotifySettingsPreview;
  /** 手机:推入 / 退出子页时通知 App —— 子页是二级页,像微信一样不显示底部 tab 栏。 */
  onPhoneSubPageChange?: (open: boolean) => void;
  /** 手机:列表顶部的「服务器」行推进服务器页(底部 tab 的 服务器 换成了 任务,Vincent 2026-09-29)。不传就没有这一行。 */
  onOpenServer?: () => void;
}) {
  const { language } = useTranslation();
  const [me, setMe] = useState<Me>({});
  const [pooledHttp, setPooledHttp] = useState(pooledHttpEnabled);
  // #695 连点「版本」5 下揭开「诊断」组(本次打开有效,不落盘)。
  const [versionTaps, setVersionTaps] = useState(VERSION_TAPS_INITIAL);
  const onVersionTap = () => setVersionTaps(prev => tapVersion(prev, Date.now()));
  const onPooledHttpChange = (value: boolean) => { setPooledHttpEnabled(value); setPooledHttp(value); };
  const lastFatal = useLastFatalReport();
  // 多用户:auth/me 原样留一份,判断「用户管理」该不该出现(Hub 管理员 / 当前网络 owner、admin)。
  const [authMe, setAuthMe] = useState<AuthMe | null>(null);
  const [profiles, setProfiles] = useState<HubProfile[]>([]);
  const [removeTarget, setRemoveTarget] = useState<HubProfile | null>(null);
  const [profileError, setProfileError] = useState('');
  const [storageDiagnostics, setStorageDiagnostics] = useState<DesktopStorageDiagnostics | null>(null);
  const [localHub, setLocalHub] = useState<LocalHubResult | null>(null);
  const [localHubBusy, setLocalHubBusy] = useState(false);
  const [localBackupMessage, setLocalBackupMessage] = useState('');
  const [localDeleteVisible, setLocalDeleteVisible] = useState(false);
  const [localDeleteText, setLocalDeleteText] = useState('');
  const update = useSyncExternalStore(subscribeDesktopUpdates, desktopUpdateSnapshot, desktopUpdateSnapshot);
  // 安卓:GitHub release 里的 universal APK(桌面端的 latest.json 不含安卓,走 Tauri 那条路只会落到「不支持」)。
  const androidUpdate = useSyncExternalStore(subscribeAndroidUpdates, androidUpdateSnapshot, androidUpdateSnapshot);
  // web 验收夹具按安卓渲染时(notifyPreview.platform=android)也走安卓那一套更新行,截图才看得到真实形状。
  const isAndroid = Platform.OS === 'android' || notifyPreview?.platform === 'android';
  // iOS 走 TestFlight,应用内没有自更新:那一行写「通过 TestFlight 更新 ›」,点了打开 TestFlight(不是「当前环境不支持自动更新」)。
  const isIOS = !isAndroid && (notifyPreview ? notifyPreview.platform === 'ios' : Platform.OS === 'ios');
  // 0.2.76 通知设置(桌面端落 localStorage)
  const notify = useSyncExternalStore(subscribeNotifySettings, loadNotifySettings, loadNotifySettings);
  // 偏好从「深色」换成「跟随系统(当前深色)」时生效主题没变,App 不会重挂 —— 这一行要自己订阅才会刷新。
  const themeKey = useSyncExternalStore(onThemePreferenceChange, themeSnapshotKey, themeSnapshotKey);
  const themeSnap = useMemo(() => {
    const [pref, mode] = themeKey.split('|') as [ThemePreference, 'light' | 'dark'];
    return { pref, mode };
  }, [themeKey]);
  // 0.2.107 手机系统通知:权限状态、「后台保持连接」的真实状态(不是设置值)、小米指引弹窗、测试通知结果。
  const nativeNotify = notifyPreview ? true : mobileNotificationsSupported();
  const notifyKey = notifyProfileKey(cfg);
  const muted = mutedAgents(notify, notifyKey);
  const [permission, setPermission] = useState<{ status: PermissionStatus; canAskAgain: boolean } | null>(null);
  const refreshPermission = () => {
    if (notifyPreview) { setPermission(notifyPreview.permission); return; }
    if (nativeNotify) void notificationPermission().then(setPermission).catch(() => {});
  };
  useEffect(refreshPermission, [nativeNotify]);
  const liveKeepAlive = useSyncExternalStore(subscribeKeepAlive, keepAliveSnapshot, keepAliveSnapshot);
  const keepAliveState = notifyPreview?.keepAlive ?? liveKeepAlive;
  // 起服务是异步的(onStartCommand 稍后才跑):开关拨动后 1.5 s 再读一次真实状态。
  const [, bumpKeepAlive] = useState(0);
  const [guideVisible, setGuideVisible] = useState(!!notifyPreview?.guideOpen);
  const [testMessage, setTestMessage] = useState('');
  const saveNotify = (next: NotifySettings) => { saveNotifySettings(next); };
  // 0.2.109「免打扰时仍然提醒」:勿扰权限的真实读数(从系统页回来要重读)。
  const notifyDiag = useSyncExternalStore(subscribeNotifyDiagnostics, getNotifyDiagnostics, getNotifyDiagnostics);
  useEffect(() => {
    if (!isAndroid || notifyPreview) return;
    void refreshNotifyDiagnostics().catch(() => {});
    const sub = AppState.addEventListener('change', st => { if (st === 'active') void refreshNotifyDiagnostics().catch(() => {}); });
    return () => sub.remove();
  }, [isAndroid, notifyPreview]);
  const dndAccess = notifyPreview ? null : notifyDiag.dndAccess;
  const ensurePermission = async (): Promise<boolean> => {
    if (!nativeNotify) return true;
    const current = await notificationPermission();
    const action = permissionOnUserAction(current.status, current.canAskAgain);
    if (action === 'none') { setPermission(current); return true; }
    if (action === 'open-settings') { await openAppNotificationSettings(); refreshPermission(); return false; }
    const status = await requestNotificationPermission();
    refreshPermission();
    return status === 'granted';
  };
  const [quietStart, setQuietStart] = useState(notify.quiet.start);
  const [quietEnd, setQuietEnd] = useState(notify.quiet.end);
  const [query, setQuery] = useState('');
  // 切主题会整棵重挂(App.tsx key={theme}),分类与滚动位置从模块级记忆恢复,不回到「账号」。
  const [category, setCategoryState] = useState<SettingsCategoryKey>(() => rememberedSettingsView().category);
  const setCategory = (key: SettingsCategoryKey) => { rememberSettingsCategory(key); setWideChangelog(false); setWidePassword(false); setCategoryState(key); setWideDevices(false); };
  // 手机:当前推入的子页(null = 在分组列表上)。同样走模块级记忆 —— 在「外观」子页里切主题整棵重挂后仍停在外观。
  const [page, setPage] = useState<SettingsCategoryKey | null>(() => rememberedSettingsView().page);
  const openPage = (key: SettingsCategoryKey) => { setCategory(key); setPage(key); };
  // 从设置外面要求直接打开的三级页(#653 弱密码横幅 → 修改密码);挂载后清掉,只用一次。
  const [initialDetail] = useState(() => peekPendingSettingsDetail());
  useEffect(() => { clearPendingSettingsDetail(); }, []);
  // 手机三级页(API Key、高级 / 旧版控制台、免打扰时段、管理账号)。
  // 本地工作区账号没有「修改密码」(canChangePassword):从外面带进来的这个三级页请求直接丢掉,不落在一个有标题没内容的页上。
  const [detail, setDetail] = useState<SettingsDetailKey | null>(initialDetail === 'changePassword' && cfg.profileId === LOCAL_HUB_PROFILE_ID ? null : initialDetail);
  // 三级页接管的顶栏(成员页的「保存」、它推入的选择页)。onBack 放 ref:返回键的监听不因它重注册。
  const [headerOverride, setHeaderOverrideState] = useState<SettingsHeaderOverride | null>(null);
  const headerBackRef = useRef<(() => void) | undefined>(undefined);
  const setHeaderOverride = (h: SettingsHeaderOverride | null) => { headerBackRef.current = h?.onBack; setHeaderOverrideState(h); };
  const scrollPaneTop = () => paneScrollRef.current?.scrollTo({ y: 0, animated: false });
  const closePage = () => { closeSettingsPage(); setPage(null); setDetail(null); setHeaderOverride(null); };
  const openDetail = (key: SettingsDetailKey) => { setDetail(key); scrollPaneTop(); };
  const closeDetail = () => { setDetail(null); setHeaderOverride(null); scrollPaneTop(); };
  // 返回箭头 / 安卓返回键 / 网页 Esc 都走这里:三级页推入的页先退,再退三级页,再退子页。
  const goBack = () => {
    const target = settingsBackTarget(page, detail);
    if (target === 'detail' && headerBackRef.current) headerBackRef.current();
    else if (target === 'detail') closeDetail();
    else closePage();
  };
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  // 切换账号面板(手机底部面板 / 宽屏对话框)。
  const [switcherOpen, setSwitcherOpen] = useState(false);
  // 每行账号的「复制」「编辑」(Vincent 2026-09-30「账号 支持一下复制 编辑」):编辑弹窗、手机的动作面板、「已复制」小条。
  const [editTarget, setEditTarget] = useState<HubProfile | null>(null);
  const [sheetTarget, setSheetTarget] = useState<HubProfile | null>(null);
  const [menuFor, setMenuFor] = useState<{ profile: HubProfile; anchor: { x: number; y: number; w: number; h: number } } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), ACCOUNT_TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);
  // 登录设备:手机是账号子页里的三级页(detail = loginDevices);宽屏是账号右栏里推进去的一页。
  const sessions = useLoginSessions(cfg);
  const [wideDevices, setWideDevices] = useState(false);
  // 宽屏「更新日志」:关于右栏里推进去的一页(手机是关于子页里的三级页 detail = changelog)。
  const [wideChangelog, setWideChangelog] = useState(false);
  // 修改密码(#653):手机是账号子页里的三级页(detail = changePassword);宽屏是账号右栏里推进去的一页。
  const [widePassword, setWidePassword] = useState(initialDetail === 'changePassword');
  const weakPassword = useWeakPassword(cfg);
  // hub 改密码成功会吊销这次请求用的令牌、另发一个新的(change-password-api.ts):先把新令牌存进这个账号,
  // 再按存储重新载入(onProfileEdited:人留在设置里;桌面设置窗会通知主窗口重读)。其他设备上的登录被 hub 退掉了。
  const onPasswordChanged = async (token: string | undefined) => {
    await weakPasswordFlags.clear(cfg);
    if (token && token !== cfg.token) {
      await saveConfig({ ...cfg, token });
      // 万一在换令牌前已经有一次 401 被记下(不该发生:旧令牌的 401 在 profile-auth-state 里被忽略),也清掉。
      clearProfileUnauthorized(sessionIdOf(cfg));
      const id = sessionIdOf(cfg);
      if (id) await Promise.resolve((onProfileEdited ?? onSwitchProfile)(id));
    }
    setWidePassword(false);
    if (detail === 'changePassword') { setDetail(null); setHeaderOverride(null); }
    setToast(tr('password.done'));
  };
  const password = useChangePassword(cfg, onPasswordChanged);
  const openPassword = (wide: boolean) => {
    password.reset();
    if (wide) { setWidePassword(true); if (searching) setQuery(''); paneScrollRef.current?.scrollTo({ y: 0, animated: false }); }
    else openDetail('changePassword');
  };
  // 本地工作区的账号是本机自动建的,没有给人记的密码 —— 不出现「修改密码」。
  const canChangePassword = cfg.profileId !== LOCAL_HUB_PROFILE_ID;
  const paneScrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    const { scrollY } = rememberedSettingsView();
    if (scrollY > 0) requestAnimationFrame(() => paneScrollRef.current?.scrollTo({ y: scrollY, animated: false }));
  }, []);
  const { width } = useWindowDimensions();
  const dialogSafe = useModalSafePadding('fullScreen'); // the two confirm dialogs (safe-area rule 2)
  const compact = width < 640;
  const subPage = compact ? page : null;
  useEffect(() => {
    onPhoneSubPageChange?.(!!subPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subPage]);
  // 离开设置(比如点通知进了会话)时把 tab 栏还回去。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => onPhoneSubPageChange?.(false), []);
  // 子页的返回:安卓系统返回键/手势走 BackHandler(比 App.tsx 的返回处理晚注册 ⇒ 先被调用,
  // 同 ScheduledTasksScreen 的窄屏详情);网页(验收用的 web 导出)没有返回键,听 Esc。
  // 弹窗开着时让弹窗自己的 onRequestClose 处理(安卓的 Modal 会先吞掉返回键;网页的 Esc 两边都会收到)。
  const dialogOpen = !!removeTarget || localDeleteVisible || guideVisible || logoutConfirm || switcherOpen || !!sessions.confirm || !!editTarget || !!sheetTarget || !!menuFor;
  useEffect(() => {
    if (!subPage || dialogOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { goBack(); return true; });
    const win = Platform.OS === 'web' && typeof window !== 'undefined' ? window : null;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); goBack(); } };
    win?.addEventListener('keydown', onKey);
    return () => { sub.remove(); win?.removeEventListener('keydown', onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subPage, dialogOpen, detail]);

  useEffect(() => {
    let live = true;
    void Promise.all([listHubProfiles(), getDesktopStorageDiagnostics()]).then(async ([registry, diagnostics]) => {
      if (!live) return;
      setProfiles(registry.profiles);
      setStorageDiagnostics(diagnostics);
      const current = sessionIdOf(cfg);
      if (current && registry.profiles.some(p => p.profileId === current && p.requiresReauth)) {
        await verifyProfileCredentialWith(current, cfg.token, async () => {
          // A cached60-second identity answer is not proof the token is still valid.
          forgetAuthMeFor(cfg);
          const proof = await fetchAuthMe(cfg);
          return live && typeof proof?.user?.username === 'string' && proof.user.username === cfg.username;
        }, async revision => {
          if (!live) return false;
          const cleared = await markHubProfileRequiresReauth(current, false, cfg.token, revision);
          if (!cleared || !live || profileAuthRevision(current) !== revision) return false;
          clearProfileUnauthorized(current);
          const next = await listHubProfiles();
          if (live && profileAuthRevision(current) === revision) setProfiles(next.profiles);
          return true;
        });
      }
      if (!live) return;
      // 切换账号面板打开时顺手验一下别的已保存账号:登录已过期 / 被「退出其他设备」踢掉的,
      // 在面板里就显示「需要重新登录」,而不是点过去才发现是坏的。
      if (switcherOpen) {
        void probeSavedSessions(registry.profiles, sessionIdOf(cfg)).then(changed => {
          if (changed && live) void listHubProfiles().then(next => { if (live) setProfiles(next.profiles); }).catch(() => {});
        });
      }
    }).catch(error => { if (live) setProfileError(String(error)); });
    return () => { live = false; };
  }, [cfg.profileId, cfg.serverUrl, cfg.username, cfg.token, switcherOpen]);

  useEffect(() => {
    if (cfg.profileId !== LOCAL_HUB_PROFILE_ID && !profiles.some(profile => profile.profileId === LOCAL_HUB_PROFILE_ID)) return;
    void localHubStatus().then(setLocalHub).catch(error => setProfileError(String(error)));
  }, [cfg.profileId, profiles]);

  useEffect(() => {
    (async () => {
      try {
        const d: any = await fetchAuthMe(cfg);
        const net =
          d?.networks?.find((n: any) => n.network_id === cfg.networkId) ?? d?.networks?.[0];
        setAuthMe(d ?? null);
        setMe({
          username: d?.user?.username,
          networkName: net?.network_name,
          networkId: net?.network_id,
        });
      } catch {
        /* rows fall back to stored config */
      }
    })();
  }, [cfg]);

  const tauriDesktop = !!(globalThis as any).__TAURI_INTERNALS__;
  const platform = notifyPreview?.platform ?? settingsPlatform(Platform.OS, tauriDesktop);
  const usersAvailable = canManageUsers(authMe, me.networkId);
  // 部门负责人(RFC-040,Hub ≥ .91):手机设置列表最上面一组「管理本部门」(电脑在侧栏「人员」上方)。旧 Hub ⇒ 空,不出现。
  const managedDepts = managedDepartmentIds(authMe, me.networkId);
  const [manageDeptOpen, setManageDeptOpen] = useState(false);
  const filtered = useMemo(() => filterSettings(query, { localHub: !!localHub, users: usersAvailable }, undefined, platform), [query, localHub, usersAvailable, platform, language]);
  const searching = query.trim().length > 0;
  const visible = useMemo(() => visibleRowKeys(query, filtered), [query, filtered]);
  const active = activeCategoryKey(category, filtered);
  // 行要同时满足:在本平台存在(filtered 已按平台筛掉安卓专属行)且命中搜索(visible 为 null = 不在搜索)。
  const onPlatform = useMemo(() => new Set(filterSettings('', { localHub: true, users: true }, undefined, platform).flatMap(c => c.rows.map(r => `${c.key}.${r.key}`))), [platform]);
  const show = (cat: SettingsCategoryKey, row: string) => onPlatform.has(`${cat}.${row}`) && (visible === null || visible.has(`${cat}.${row}`));
  // 不在搜索:只画选中的那一类;搜索中:把所有命中的类都画出来(各带小标题)。
  const sectionsToRender = searching ? filtered.map(c => c.key) : [active];
  const paneTitle = searching ? tr('settings.copy.0') : (SETTINGS_CATEGORIES.find(c => c.key === active)?.label ?? tr('settings.copy.1'));
  // 宽屏「登录设备」页:只在账号分类、不在搜索时推进来;搜索或换分类就回到账号。
  const showWideDevices = wideDevices && !compact && !searching && active === 'account' && sessions.available;
  const showWideChangelog = wideChangelog && !compact && !searching && active === 'about';
  const showWidePassword = widePassword && !compact && !searching && active === 'account' && canChangePassword && !showWideDevices;

  const sidebar = (
    <View style={[styles.sidebar, compact && styles.sidebarCompact]} testID="settings-sidebar">
      <View style={styles.sidebarTop}>
        {onClose ? (
          <Pressable accessibilityLabel={tr('settings.copy.2')} accessibilityRole="button" onPress={onClose} hitSlop={8} style={({ pressed }) => [styles.closeButton, pressed && { opacity: 0.6 }]}>
            <Ionicons name="close" size={18} color={colors.text} />
          </Pressable>
        ) : null}
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={15} color={colors.textMuted} />
          <TextInput
            accessibilityLabel={tr('settings.copy.3')}
            value={query}
            onChangeText={setQuery}
            placeholder={tr('settings.copy.3')}
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query ? (
            <Pressable accessibilityLabel={tr('settings.copy.4')} onPress={() => setQuery('')} hitSlop={6}>
              <Ionicons name="close-circle" size={15} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <ScrollView horizontal={compact} showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false} contentContainerStyle={compact ? styles.categoryRow : styles.categoryList}>
        {filtered.map(cat => {
          const isActive = !searching && cat.key === active;
          return (
            <Pressable
              key={cat.key}
              accessibilityLabel={tr('settings.copy.178', { v0: settingsText(cat.label) })}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              onPress={() => { setCategory(cat.key); if (searching) setQuery(''); }}
              style={({ pressed, hovered }: any) => [styles.categoryItem, compact && styles.categoryChip, (hovered || pressed) && styles.categoryItemHover, isActive && styles.categoryItemActive]}
            >
              <Ionicons name={cat.icon as any} size={17} color={isActive ? colors.text : colors.textSecondary} />
              <Text style={[styles.categoryLabel, isActive && styles.categoryLabelActive]} numberOfLines={1}>{settingsText(cat.label)}</Text>
            </Pressable>
          );
        })}
        {searching && filtered.length === 0 ? <Text style={styles.emptySide}>{tr('settings.copy.5')}</Text> : null}
      </ScrollView>
    </View>
  );

  // ── 手机:分组列表 + 子页顶栏 ──────────────────────────────────────────────────────────────
  const phoneValue = (key: SettingsCategoryKey): string => {
    if (key === 'account') return me.username ?? cfg.username ?? '';
    if (key === 'about') return tr('settings.copy.179', { v0: APP_VERSION });
    return '';
  };
  const canLogout = cfg.profileId !== LOCAL_HUB_PROFILE_ID;
  // 手机 / 网页上迁移过来的账号在 cfg 上没有 profileId,列表里它的 id 是 legacy(storage.sessionIdOf)。
  const currentId = sessionIdOf(cfg);
  const pickProfile = (profile: Pick<HubProfile, 'profileId' | 'serverUrl' | 'username' | 'displayName' | 'requiresReauth'>) => {
    if (profile.requiresReauth) return onReauthProfile(profile);
    if (profile.profileId !== currentId) void Promise.resolve(onSwitchProfile(profile.profileId)).catch(reportError);
  };
  // 鼠标 + 键盘(桌面壳,任何窗口宽度)还是手指:手机管理账号页点一行出底部动作面板,桌面窄窗口照旧逐项列出。
  const pointer = pointerUi();
  const profileActions = (profile: HubProfile) => accountRowActions(profile, { canOpenWindow: tauriDesktop });
  const runProfileAction = (action: AccountRowAction, profile: HubProfile) => {
    if (action === 'copy') void copyAccountLine(profile).then(() => setToast(tr('accounts.copied')), error => setToast(tr('accounts.copyFailed', { msg: String(error) })));
    else if (action === 'edit') setEditTarget(profile);
    else if (action === 'openWindow') void openWorkspaceWindow(profile).catch(reportError);
    else setRemoveTarget(profile);
  };
  // ⋯(#427):鼠标 = 锚在 ⋯ 下面的菜单;手指 = 底部 action sheet(和以前「管理账号」页同一个)。
  const openProfileMore = (profile: HubProfile, el: any) => {
    if (!pointer || !el?.measureInWindow) { setSheetTarget(profile); return; }
    el.measureInWindow((x: number, y: number, w: number, h: number) => setMenuFor({ profile, anchor: { x, y, w, h } }));
  };
  const runMenuItem = (item: AccountMenuItem, profile: HubProfile) => {
    if (item === 'switch') pickProfile(profile);
    else runProfileAction(item, profile);
  };
  const closeMenu = useCallback(() => setMenuFor(null), []);
  const currentProfile = profiles.find(profile => profile.profileId === currentId) ?? null;
  const otherProfiles = profiles.filter(profile => profile.profileId !== currentId);
  const accountRow = (profile: HubProfile, isCurrent: boolean) => (
    <SettingsAccountRow
      key={profile.profileId}
      testID={`settings-profile-${profile.profileId}`}
      name={profile.displayName || profile.username || tr('settings.copy.12')}
      subtitle={accountSubtitle(profile)}
      warning={profile.requiresReauth ? tr('settings.copy.15') : undefined}
      current={isCurrent ? tr('accounts.currentPill') : undefined}
      badge={profile.profileId === LOCAL_HUB_PROFILE_ID ? tr('accounts.localPill') : undefined}
      large={isCurrent}
      accessibilityLabel={tr('settings.copy.182', { v0: profile.displayName || profile.username || maskedHubHost(profile.serverUrl) })}
      onPress={() => pickProfile(profile)}
      onMore={el => openProfileMore(profile, el)}
      moreLabel={tr('accounts.more', { name: accountName(profile) })}
    />
  );
  const afterProfileEdit = async (profileId: string, serverChanged: boolean) => {
    const registry = await listHubProfiles();
    setProfiles(registry.profiles);
    if (profileId !== currentId || !serverChanged) return;
    await Promise.resolve(onProfileEdited ? onProfileEdited(profileId) : onSwitchProfile(profileId));
  };
  const phoneList = (
    <ScrollView style={styles.phoneScroll} contentContainerStyle={styles.phoneListContent} testID="settings-phone-list">
      {/* v2(#427):列表页也是设置积木 —— 每个分类一行(行首图标方块 · 名字 · 右侧值 · ›),分组标题照旧。 */}
      {onOpenServer ? (
        <SettingsGroup testID="settings-group-server">
          <SettingsRow
            testID={`settings-row-${PHONE_SETTINGS_SERVER_ENTRY.key}`}
            icon="cloud-outline"
            label={tr('nav.server')}
            value={maskedHubHost(cfg.serverUrl)}
            accessibilityLabel={tr('nav.server')}
            onPress={onOpenServer}
          />
        </SettingsGroup>
      ) : null}
      {managedDepts.length && me.networkId ? (
        <SettingsGroup testID="settings-group-manage-dept">
          <SettingsRow
            testID="settings-row-manageDepartment"
            icon="git-network-outline"
            label={tr('dept.manage')}
            accessibilityLabel={tr('dept.manage')}
            onPress={() => setManageDeptOpen(true)}
          />
        </SettingsGroup>
      ) : null}
      {phoneSettingsGroups(filtered).map((group, gi) => (
        <SettingsGroup key={group.title ?? `g${gi}`} title={group.title ? settingsText(group.title) : undefined} testID={`settings-group-${gi}`}>
          {group.rows.map(cat => (
            <SettingsRow
              key={cat.key}
              testID={`settings-row-${cat.key}`}
              icon={SETTINGS_CATEGORIES.find(c => c.key === cat.key)?.icon}
              label={settingsText(phoneRowLabel(cat))}
              value={phoneValue(cat.key) || undefined}
              accessibilityLabel={settingsText(phoneRowLabel(cat))}
              onPress={() => openPage(cat.key)}
            />
          ))}
        </SettingsGroup>
      ))}
      {/* 切换账号(Vincent 2026-09-29)/ 退出登录:最下面两块整宽按钮(照微信),v2 起是设置积木的 SettingsButton,
          和上面的卡片同一左右边距。退出登录要先确认(弹窗不变)。 */}
      <SettingsButton variant="plain" label={tr('accounts.switch')} onPress={() => setSwitcherOpen(true)} testID="settings-switch-account-block" />
      {canLogout ? <SettingsButton variant="plain" label={tr('settings.copy.6')} onPress={() => setLogoutConfirm(true)} testID="settings-logout-block" /> : null}
    </ScrollView>
  );
  // 顶栏(列表与子页同一高度、同一底色 = 状态栏那条的底色,和微信一样看不出接缝;标题位置切页不跳)。
  const listHeader = (
    <View style={styles.phoneHeader} testID="settings-list-header">
      <View style={styles.phoneHeaderSide} />
      <Text style={styles.phoneHeaderTitle} numberOfLines={1}>{tr('settings.copy.1')}</Text>
      <View style={styles.phoneHeaderSide} />
    </View>
  );
  const subPageCat = subPage ? SETTINGS_CATEGORIES.find(c => c.key === active) : undefined;
  const openDetailKey = subPage && settingsBackTarget(subPage, detail) === 'detail' ? detail : null;
  const headerAction = headerOverride?.action;
  const phoneHeader = (
    <View style={styles.phoneHeader} testID="settings-subpage-header">
      <Pressable testID="settings-back" accessibilityRole="button" accessibilityLabel={tr('settings.copy.7')} onPress={goBack} hitSlop={8} style={({ pressed }) => [styles.phoneHeaderSide, openDetailKey && headerAction && styles.phoneHeaderBackWide, pressed && { opacity: 0.6 }]}>
        <Ionicons name="chevron-back" size={24} color={colors.text} />
      </Pressable>
      <Text style={styles.phoneHeaderTitle} numberOfLines={1} testID="settings-subpage-title">{openDetailKey && headerOverride?.title ? headerOverride.title : settingsText(openDetailKey ? SETTINGS_DETAIL_TITLE[openDetailKey] : subPageCat ? phoneRowLabel(subPageCat) : tr('settings.copy.1'))}</Text>
      {openDetailKey && headerAction ? (
        <View style={[styles.phoneHeaderSide, styles.phoneHeaderActionSide]}>
          <Pressable
            testID={headerAction.testID}
            accessibilityRole="button"
            accessibilityLabel={headerAction.label}
            accessibilityState={{ disabled: !!(headerAction.disabled || headerAction.busy), busy: !!headerAction.busy }}
            disabled={headerAction.disabled || headerAction.busy}
            onPress={headerAction.onPress}
            hitSlop={6}
            style={({ pressed }) => [styles.phoneHeaderAction, (headerAction.disabled || headerAction.busy) && styles.disabled, pressed && { opacity: 0.75 }]}
          >
            {headerAction.busy ? <ActivityIndicator size="small" color={colors.onAccent} /> : null}
            <Text style={styles.phoneHeaderActionText} numberOfLines={1}>{headerAction.label}</Text>
          </Pressable>
        </View>
      ) : <View style={styles.phoneHeaderSide} />}
    </View>
  );
  const sectionStyle = styles.section;

  // 手机子页:状态与动作和宽屏右栏同一份,只换 settings-kit 的画法(SettingsPhonePages.tsx)。
  const reportError = (error: unknown) => setProfileError(String(error));
  const runLocalHub = (work: () => Promise<unknown>) => {
    setLocalHubBusy(true);
    void work().catch(reportError).finally(() => setLocalHubBusy(false));
  };
  const phoneCtx: PhonePagesCtx = {
    cfg,
    show,
    detail: openDetailKey,
    openDetail,
    closeDetail,
    profiles,
    me,
    profileError,
    storageDiagnostics,
    tauriDesktop,
    currentProfileId: currentId,
    onPickProfile: pickProfile,
    onOpenProfileWindow: profile => { void openWorkspaceWindow(profile).catch(reportError); },
    onRemoveProfile: profile => setRemoveTarget(profile),
    onProfileMore: openProfileMore,
    pointer,
    onAddAccount,
    sessions,
    password,
    weakPassword,
    canChangePassword,
    openPassword: () => openPassword(false),
    localHub,
    localHubBusy,
    localBackupMessage,
    localHubActions: {
      upgrade: () => { setProfileError(''); runLocalHub(() => restartLocalHub().then(setLocalHub)); },
      restart: () => runLocalHub(() => restartLocalHub().then(setLocalHub)),
      stop: () => runLocalHub(() => stopLocalHub().then(() => localHubStatus()).then(setLocalHub)),
      logs: () => { void openLocalHubLogs().catch(reportError); },
      backup: () => { setLocalBackupMessage(''); runLocalHub(() => backupLocalHubData().then(result => setLocalBackupMessage(tr('settings.copy.180', { v0: result.path })))); },
      openDelete: () => { setLocalDeleteText(''); setLocalDeleteVisible(true); },
    },
    themePref: themeSnap.pref,
    themeModeNow: themeSnap.mode,
    notify,
    saveNotify,
    nativeNotify,
    permission,
    ensurePermission,
    muted,
    unmute: alias => saveNotify(toggleAgentMuted(notify, notifyKey, alias)),
    keepAliveState,
    keepAliveStatus: keepAliveStatusText(notify, keepAliveState),
    onKeepAliveChange: value => { saveNotify({ ...notify, keepAlive: value }); setTimeout(() => bumpKeepAlive(n => n + 1), 1500); },
    dndAccess,
    onDndBypassChange: value => { saveNotify({ ...notify, dndBypass: value }); if (value && dndAccessGranted() === false) void openDndAccessSettings(); },
    openDndAccess: () => { void openDndAccessSettings(); },
    openXiaomiGuide: () => setGuideVisible(true),
    testMessage,
    sendTest: () => {
      void (async () => {
        if (!(await ensurePermission())) { setTestMessage(tr('settings.copy.8')); return; }
        try { await sendTestNotification(); setTestMessage(tr('settings.copy.9')); }
        catch (e) { setTestMessage(tr('settings.copy.181', { v0: String((e as Error)?.message ?? e) })); }
      })();
    },
    onSoundChange: value => { saveNotifySettings({ ...notify, soundEnabled: value }); if (value) playChime(); },
    notifyPreview: !!notifyPreview,
    quietStart,
    quietEnd,
    setQuietStart,
    setQuietEnd,
    renderUsers: detail => <UserManagementPanel cfg={cfg} me={authMe} networkId={me.networkId} phone={{ memberOpen: detail === 'userMember', groupOpen: detail === 'userGroup', openMember: () => openDetail('userMember'), openGroup: () => openDetail('userGroup'), closeMember: closeDetail, setHeader: setHeaderOverride, scrollTop: scrollPaneTop }} />,
    renderAgentOrg: () => <AgentOrgScreen cfg={cfg} networkId={me.networkId || cfg.networkId} phone />,
    renderShortcuts: () => <ShortcutsSettings s={styles} showNav={show('shortcuts', 'nav')} showChat={show('shortcuts', 'chat')} showSend={show('shortcuts', 'send')} />,
    updateView: isIOS ? IOS_UPDATE_ROW : isAndroid
      ? describeAndroidUpdateRow(androidUpdate, { currentVersion: APP_VERSION, lastCheckedAt: androidUpdateLastCheckedAt(), now: Date.now() })
      : describeUpdateRow(update, { currentVersion: APP_VERSION, lastCheckedAt: desktopUpdateLastCheckedAt(), now: Date.now() }),
    onVersionTap,
    showPooledHttp: showPooledHttpDiagnostics(versionTaps.revealed, platform),
    pooledHttp,
    onPooledHttpChange,
    onCheckUpdate: () => {
      if (isIOS) void openTestFlight(Linking);
      else if (isAndroid) void checkAndroidUpdate(APP_VERSION);
      else void checkDesktopUpdate(undefined, { manual: true });
    },
  };
  const phoneSubPage = subPage && openDetailKey === 'changelog' ? (
    // 更新日志自己滚、底部钉「复制所选」条,不套在设置的滚动区里。
    <View style={styles.phoneScroll} testID="settings-subpage-about-changelog"><ChangelogPage phone /></View>
  ) : subPage ? (
    <ScrollView
      ref={paneScrollRef}
      style={styles.phoneScroll}
      contentContainerStyle={settingsPageContentStyle()}
      onScroll={e => rememberSettingsScroll(e.nativeEvent.contentOffset.y)}
      scrollEventThrottle={100}
      keyboardShouldPersistTaps="handled"
      testID="settings-scroll"
    >
      <View testID={`settings-subpage-${subPage}`}>
        <SettingsPhonePage page={subPage} ctx={phoneCtx} />
      </View>
    </ScrollView>
  ) : null;

  // 宽屏「登录设备」:本机一行在最上;其余按设备名(client_label / UA)合并成组 —— 组头写「N 个登录 · 最近使用」,
  // 点开才列出每一条(每条右侧「退出」)。只出现一次的设备名直接是一行。底下「退出其他所有设备」。
  const renderWideDevices = () => {
    const now = Date.now();
    const shown = visibleSessions(sessions.items, sessions.showAll);
    const deviceRow = (session: LoginSession, label: string, kind: DeviceKind, member: boolean) => {
      const id = session.is_current ? 'login-device-current' : `login-device-${session.token_id}`;
      return (
        <View style={[styles.deviceRow, member && styles.deviceMemberRow]} testID={id}>
          {member ? null : (
            <View style={styles.deviceIcon}>
              <Ionicons name={DEVICE_ICON[kind] as any} size={18} color={colors.textSecondary} />
            </View>
          )}
          <View style={styles.rowCopy}>
            <View style={styles.deviceTitleLine}>
              <Text style={member ? styles.rowLabel : styles.rowLabelStrong} numberOfLines={1} testID={`${id}-label`}>{member ? sessionSubtitle(session, now) : label}</Text>
              {session.is_current ? <View style={styles.currentBadge} testID="login-device-current-badge"><Text style={styles.currentBadgeText}>{tr('sessions.thisDevice')}</Text></View> : null}
            </View>
            <Text style={styles.rowHint} numberOfLines={1}>{member ? memberSubtitle(session, now) : sessionSubtitle(session, now)}</Text>
          </View>
          {session.is_current ? null : (
            <Pressable
              testID={`${id}-signout`}
              accessibilityRole="button"
              accessibilityLabel={tr('sessions.signOutLabel', { name: label })}
              disabled={!!sessions.busy}
              onPress={() => sessions.askRevokeOne(session, label)}
              hitSlop={8}
              style={({ pressed, hovered }: any) => [styles.deviceSignOut, (pressed || hovered) && styles.deviceSignOutHover, !!sessions.busy && styles.disabled]}
            >
              {sessions.busy === session.token_id ? <ActivityIndicator size="small" color={colors.failed} /> : <Text style={styles.dangerText}>{tr('sessions.signOut')}</Text>}
            </Pressable>
          )}
        </View>
      );
    };
    return (
      <View style={sectionStyle} testID="settings-section-devices">
        <WideCard>
          {sessions.error ? (
            <>
              <Text style={styles.errorText}>{tr('sessions.loadFailed', { msg: sessions.error })}</Text>
              <Pressable testID="login-devices-retry" style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]} onPress={() => void sessions.refresh()} accessibilityRole="button">
                <Text style={styles.accentText}>{tr('sessions.retry')}</Text>
              </Pressable>
            </>
          ) : null}
          {shown.map((item, index) => {
            if (item.type === 'session') return <View key={item.key}>{index ? <Divider /> : null}{deviceRow(item.session, item.label, item.kind, false)}</View>;
            const gid = `login-devices-group-${groupTestKey(item, index)}`;
            const open = sessions.expanded.has(item.key);
            const members = visibleSessions(item.sessions, sessions.groupShowAll.has(item.key));
            return (
              <View key={item.key}>
                {index ? <Divider /> : null}
                <Pressable
                  testID={gid}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  accessibilityLabel={tr(open ? 'sessions.collapseGroup' : 'sessions.expandGroup', { name: item.label })}
                  onPress={() => sessions.toggleGroup(item.key)}
                  style={({ pressed, hovered }: any) => [styles.deviceRow, (pressed || hovered) && styles.categoryItemHover]}
                >
                  <View style={styles.deviceIcon}>
                    <Ionicons name={DEVICE_ICON[item.kind] as any} size={18} color={colors.textSecondary} />
                  </View>
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowLabelStrong} numberOfLines={1} testID={`${gid}-label`}>{item.label}</Text>
                    <Text style={styles.rowHint} numberOfLines={1} testID={`${gid}-subtitle`}>{groupSubtitle(item.sessions, now)}</Text>
                  </View>
                  <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
                </Pressable>
                {open ? members.map(m => <View key={m.token_id}><Divider />{deviceRow(m, item.label, item.kind, true)}</View>) : null}
                {open && members.length < item.sessions.length ? (
                  <>
                    <Divider />
                    <Pressable testID={`${gid}-show-all`} style={({ pressed }) => [styles.row, styles.deviceMemberRow, pressed && { opacity: 0.6 }]} onPress={() => sessions.showAllInGroup(item.key)} accessibilityRole="button">
                      <Text style={styles.accentText}>{tr('sessions.showAll', { n: item.sessions.length })}</Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
            );
          })}
          {!sessions.showAll && sessions.items.length > SESSIONS_VISIBLE_DEFAULT ? (
            <>
              <Divider />
              <Pressable testID="login-devices-show-all" style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]} onPress={() => sessions.setShowAll(true)} accessibilityRole="button">
                <Text style={styles.accentText}>{tr('sessions.showAll', { n: sessions.items.length })}</Text>
              </Pressable>
            </>
          ) : null}
          {sessions.others > 0 ? (
            <>
              <Divider />
              <Pressable testID="login-devices-revoke-others" disabled={!!sessions.busy} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }, !!sessions.busy && styles.disabled]} onPress={sessions.askRevokeOthers} accessibilityRole="button">
                <View style={styles.rowCopy}>
                  <Text style={styles.dangerText}>{tr('sessions.signOutOthers')}</Text>
                  <Text style={styles.rowHint}>{tr('sessions.othersHint', { n: sessions.others })}</Text>
                </View>
                {sessions.busy === 'others' ? <ActivityIndicator size="small" color={colors.failed} /> : null}
              </Pressable>
            </>
          ) : sessions.sessions.length ? <Text style={styles.footHint}>{tr('sessions.onlyThis')}</Text> : null}
          {sessions.message ? <Text style={[styles.footHint, { color: sessions.message.ok ? colors.accent : colors.failed }]} testID="login-devices-message">{sessions.message.text}</Text> : null}
          {sessions.idleDays ? <Text style={styles.footHint} testID="login-devices-idle">{tr('sessions.idleFooter', { n: sessions.idleDays })}</Text> : null}
        </WideCard>
      </View>
    );
  };

  const heading = (cat: SettingsCategoryKey) => searching
    ? <Text style={styles.groupTitle}>{settingsText(SETTINGS_CATEGORIES.find(c => c.key === cat)?.label ?? '')}</Text>
    : null;

  return (
    <View style={[styles.root, !compact && styles.rootWide, compact && styles.rootPhone]}>
      {compact ? (subPage ? phoneHeader : listHeader) : sidebar}
      {compact ? (subPage ? phoneSubPage : phoneList) : (
      <View style={styles.pane} testID="settings-pane">
        {showWideDevices ? (
          <View style={styles.paneTitleRow} testID="settings-devices-header">
            <Pressable testID="settings-devices-back" accessibilityRole="button" accessibilityLabel={tr('settings.copy.7')} onPress={() => setWideDevices(false)} hitSlop={8} style={({ pressed, hovered }: any) => [styles.paneBack, (pressed || hovered) && styles.categoryItemHover]}>
              <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
              <Text style={styles.paneBackText}>{settingsText(SETTINGS_CATEGORIES.find(c => c.key === 'account')?.label ?? '')}</Text>
            </Pressable>
            <Text style={styles.paneTitleText} numberOfLines={1}>{tr('sessions.title')}</Text>
          </View>
        ) : showWidePassword ? (
          <View style={styles.paneTitleRow} testID="settings-password-header">
            <Pressable testID="settings-password-back" accessibilityRole="button" accessibilityLabel={tr('settings.copy.7')} onPress={() => setWidePassword(false)} hitSlop={8} style={({ pressed, hovered }: any) => [styles.paneBack, (pressed || hovered) && styles.categoryItemHover]}>
              <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
              <Text style={styles.paneBackText}>{settingsText(SETTINGS_CATEGORIES.find(c => c.key === 'account')?.label ?? '')}</Text>
            </Pressable>
            <Text style={styles.paneTitleText} numberOfLines={1}>{tr('password.title')}</Text>
          </View>
        ) : showWideChangelog ? (
          <View style={styles.paneTitleRow} testID="settings-changelog-header">
            <Pressable testID="settings-changelog-back" accessibilityRole="button" accessibilityLabel={tr('settings.copy.7')} onPress={() => setWideChangelog(false)} hitSlop={8} style={({ pressed, hovered }: any) => [styles.paneBack, (pressed || hovered) && styles.categoryItemHover]}>
              <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
              <Text style={styles.paneBackText}>{settingsText(SETTINGS_CATEGORIES.find(c => c.key === 'about')?.label ?? '')}</Text>
            </Pressable>
            <Text style={styles.paneTitleText} numberOfLines={1}>{tr('changelog.title')}</Text>
          </View>
        ) : (
          <Text style={styles.paneTitle}>{settingsText(paneTitle)}</Text>
        )}
        {/* 0.2.80(Vincent 2026-09-19「设置页面往下面滑动不了」):右栏是 ScrollView,padding 在
            contentContainer 上——留在滚动根上的话它在可滚区域之外,最后一行照样贴着窗口底边。 */}
        {showWideChangelog ? (
          // 更新日志自己滚:工具栏(全选 · 复制所选)钉在顶上,「已复制」小条贴在右栏底部,不随列表滚走。
          <View style={{ flex: 1, minHeight: 0 }} testID="settings-changelog-pane"><ChangelogPage phone={false} /></View>
        ) : (
        <ScrollView
          ref={paneScrollRef}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator
          onScroll={e => rememberSettingsScroll(e.nativeEvent.contentOffset.y)}
          scrollEventThrottle={100}
          testID="settings-scroll"
        >
          {searching && filtered.length === 0 ? (
            <Text style={styles.emptyPane}>{tr('settings.copy.10')}{query.trim()}{tr('settings.copy.11')}</Text>
          ) : null}

          {showWideDevices ? renderWideDevices() : null}
          {showWidePassword ? <ChangePasswordPanel pw={password} weak={weakPassword} onCancel={() => setWidePassword(false)} /> : null}
          {sectionsToRender.includes('account') && !showWideDevices && !showWidePassword ? (
            // #427「设置页整体重新设计」:分组卡片 —— 当前账号(置顶、头像、主色细边)/ 其他账号(点一下切换,⋯ 收动作)/
            // 安全 / 本地数据 / 最后单独一组危险操作。行为不变:点行切换、⋯ 里是原来行尾那四个按钮(+ 切换)。
            <View style={sectionStyle} testID="settings-section-account">
              {heading('account')}
              {show('account', 'profiles') ? (
                profiles.length ? (
                  <>
                    {currentProfile ? (
                      <SettingsGroup title={tr('accounts.groupCurrent')} highlight testID="settings-account-current">
                        {accountRow(currentProfile, true)}
                      </SettingsGroup>
                    ) : null}
                    <SettingsGroup
                      title={otherProfiles.length ? tr('accounts.groupOthers') : undefined}
                      footer={profileError || (otherProfiles.length ? tr(pointer ? 'accounts.othersFooter' : 'accounts.othersFooterTouch') : undefined)}
                      footerTone={profileError ? 'danger' : undefined}
                      testID="settings-account-others"
                    >
                      {otherProfiles.map(profile => accountRow(profile, false))}
                      {show('account', 'addAccount') ? <SettingsRow label={tr('settings.copy.93')} tone="accent" icon="add" onPress={onAddAccount} testID="settings-add-account-row" /> : null}
                    </SettingsGroup>
                  </>
                ) : (
                  <SettingsGroup>
                    <SettingsRow label={tr('settings.copy.18')} value={maskedHubHost(cfg.serverUrl)} />
                    <SettingsRow label={tr('settings.copy.19')} value={me.username ?? cfg.username ?? '—'} />
                    {show('account', 'addAccount') ? <SettingsRow label={tr('settings.copy.93')} tone="accent" icon="add" onPress={onAddAccount} testID="settings-add-account-row" /> : null}
                  </SettingsGroup>
                )
              ) : show('account', 'addAccount') ? (
                <SettingsGroup><SettingsRow label={tr('settings.copy.93')} tone="accent" icon="add" onPress={onAddAccount} testID="settings-add-account-row" /></SettingsGroup>
              ) : null}
              {show('account', 'avatar') ? <UserAvatarEditor cfg={cfg} /> : null}
              {(show('account', 'devices') && sessions.available) || show('account', 'switchAccount') || (show('account', 'changePassword') && canChangePassword) ? (
                <SettingsGroup title={tr('accounts.groupSecurity')} testID="settings-account-security">
                  {show('account', 'changePassword') && canChangePassword ? (
                    <SettingsRow
                      label={tr('password.title')}
                      icon="key-outline"
                      subtitle={weakPassword ? tr('password.weakRowHint') : tr('password.rowHint')}
                      subtitleTone={weakPassword ? 'accent' : undefined}
                      onPress={() => openPassword(true)}
                      accessibilityLabel={tr('password.title')}
                      testID="settings-change-password-row"
                    />
                  ) : null}
                  {show('account', 'devices') && sessions.available ? (
                    <SettingsRow
                      label={tr('sessions.title')}
                      icon="desktop-outline"
                      subtitle={tr('sessions.rowHint')}
                      value={sessions.sessions.length ? tr('sessions.count', { n: sessions.sessions.length }) : undefined}
                      onPress={() => { setWideDevices(true); if (searching) setQuery(''); paneScrollRef.current?.scrollTo({ y: 0, animated: false }); }}
                      accessibilityLabel={tr('sessions.title')}
                      testID="settings-login-devices-row"
                    />
                  ) : null}
                  {show('account', 'switchAccount') ? (
                    <SettingsRow label={tr('accounts.switch')} icon="swap-horizontal" subtitle={tr('accounts.switchHint')} value={profiles.length > 1 ? tr('accounts.dataDirValue', { n: profiles.length }) : undefined} onPress={() => setSwitcherOpen(true)} accessibilityLabel={tr('accounts.switch')} testID="settings-switch-account-row" />
                  ) : null}
                </SettingsGroup>
              ) : null}
              {show('account', 'profiles') && storageDiagnostics ? (
                <SettingsGroup title={tr('accounts.groupLocalData')} testID="settings-account-local-data">
                  <SettingsRow
                    label={tr('accounts.dataDir')}
                    icon="folder-outline"
                    subtitle={`${storageDiagnostics.root}${storageDiagnostics.corrupt_backups.length ? tr('settings.copy.185', { v0: storageDiagnostics.corrupt_backups.length }) : ''}`}
                    value={tr('accounts.dataDirValue', { n: storageDiagnostics.profile_count })}
                    testID="settings-account-data-dir"
                  />
                </SettingsGroup>
              ) : null}
              {show('account', 'logout') && canLogout ? (
                // 危险操作单独最后一组(和上面隔开),整行红字居中。
                <View testID="settings-account-danger">
                  <SettingsButton variant="destructive" label={tr('settings.copy.22')} onPress={onLogout} testID="settings-logout-row" />
                  <SettingsGroup footer={tr('settings.copy.23')} />
                </View>
              ) : null}
            </View>
          ) : null}

          {sectionsToRender.includes('agentTeams') ? (
            <View style={sectionStyle} testID="settings-section-agent-teams">
              {heading('agentTeams')}
              <AgentOrgScreen cfg={cfg} networkId={me.networkId || cfg.networkId} phone={false} />
            </View>
          ) : null}

          {sectionsToRender.includes('users') && usersAvailable ? (
            <View style={sectionStyle} testID="settings-section-users">
              {heading('users')}
              {/* 用户管理自己就是几组设置积木卡片,不再套一层 WideCard(v2:卡片里套卡片)。 */}
              <UserManagementPanel cfg={cfg} me={authMe} networkId={me.networkId} />
            </View>
          ) : null}

          {sectionsToRender.includes('localHub') && localHub ? (
            // v2(#427):每一行都是设置积木(标签列 · 值 / › 列 · 52 行高);毁灭性动作单独最后一组。
            <View style={sectionStyle} testID="local-hub-settings-card">
              {heading('localHub')}
              <SettingsGroup footer={localHub.error || undefined} footerTone="danger" testID="local-hub-status-group">
                {show('localHub', 'status') ? <SettingsRow label={tr('settings.copy.24')} value={localHub.state === 'running' || localHub.state === 'running_external' ? tr('settings.copy.25') : localHub.state === 'error' ? tr('settings.copy.26') : tr('settings.copy.27')} testID="local-hub-status" /> : null}
                {show('localHub', 'endpoint') ? <SettingsRow label={tr('settings.copy.28')} value={localHub.endpoint} testID="local-hub-endpoint" /> : null}
                {show('localHub', 'hubVersion') ? <SettingsRow label={tr('settings.copy.29')} value={localHub.hubVersion} testID="local-hub-version" /> : null}
              </SettingsGroup>
              <SettingsGroup testID="local-hub-actions-group">
                {/* app#246(Vincent 2026-09-05「版本低了就加个触发安装的按钮」):本地数据还是旧版 Hub 写的
                    (requiresMigration)或端口上跑着旧版 sidecar(version mismatch)时,给一个显式的升级入口。
                    它做的事 = 重新启动:停掉旧 sidecar → 备份 → 迁移 → 用捆绑的 Hub 接管。 */}
                {(localHub.requiresMigration || (localHub.error ?? '').includes('version mismatch')) && show('localHub', 'restart') ? (
                  <SettingsRow
                    label={localHubBusy ? tr('settings.copy.30') : tr('settings.copy.186', { v0: localHub.expectedHubVersion ?? tr('settings.copy.31') })}
                    tone="accent"
                    disabled={localHubBusy}
                    onPress={() => {
                      setLocalHubBusy(true);
                      setProfileError('');
                      void restartLocalHub().then(setLocalHub).catch(error => setProfileError(String(error))).finally(() => setLocalHubBusy(false));
                    }}
                    testID="local-hub-upgrade"
                  />
                ) : null}
                {show('localHub', 'restart') ? <SettingsActionRow label={tr('settings.copy.32')} subtitle={tr('settings.copy.33')} busy={localHubBusy} busyLabel={tr('settings.copy.92')} onPress={() => {
                  setLocalHubBusy(true);
                  void restartLocalHub().then(setLocalHub).catch(error => setProfileError(String(error))).finally(() => setLocalHubBusy(false));
                }} testID="local-hub-restart" /> : null}
                {show('localHub', 'stop') ? <SettingsActionRow label={tr('settings.copy.34')} disabled={localHubBusy || localHub.state === 'stopped'} onPress={() => {
                  setLocalHubBusy(true);
                  void stopLocalHub().then(() => localHubStatus()).then(setLocalHub).catch(error => setProfileError(String(error))).finally(() => setLocalHubBusy(false));
                }} testID="local-hub-stop" /> : null}
                {show('localHub', 'logs') ? <SettingsActionRow label={tr('settings.copy.35')} onPress={() => { void openLocalHubLogs().catch(error => setProfileError(String(error))); }} testID="local-hub-logs" /> : null}
                {show('localHub', 'backup') ? <SettingsActionRow label={tr('settings.copy.36')} subtitle={localBackupMessage || undefined} busy={localHubBusy} busyLabel={tr('settings.copy.92')} onPress={() => {
                  setLocalHubBusy(true);
                  setLocalBackupMessage('');
                  void backupLocalHubData().then(result => setLocalBackupMessage(tr('settings.copy.180', { v0: result.path }))).catch(error => setProfileError(String(error))).finally(() => setLocalHubBusy(false));
                }} testID="local-hub-backup" /> : null}
              </SettingsGroup>
              {show('localHub', 'deleteLocal') ? (
                // 唯一的毁灭性动作单独一组、放最后:红字、要输入确认词(确认框不变)。
                <SettingsGroup title={tr('settings.copy.37')} testID="settings-danger-zone">
                  <SettingsRow label={tr('settings.copy.38')} subtitle={tr('settings.copy.39')} tone="danger" onPress={() => { setLocalDeleteText(''); setLocalDeleteVisible(true); }} testID="local-hub-delete" />
                </SettingsGroup>
              ) : null}
            </View>
          ) : null}

          {sectionsToRender.includes('appearance') ? (
            <View style={sectionStyle}>
              {heading('appearance')}
              <SettingsGroup>
                {show('appearance', 'theme') ? (
                  // 0.2.101:三选一分段控件(浅色 / 深色 / 跟随系统)。说明行写明当前生效的主题。
                  <SettingsControlRow label={tr('settings.copy.40')} subtitle={localizedThemeSummary(themeSnap.pref, themeSnap.mode)} testID="settings-theme-row">
                    <View style={styles.segmented} accessibilityRole="radiogroup" accessibilityLabel={tr('settings.copy.40')}>
                      {THEME_PREFERENCES.map(option => {
                        const selected = themeSnap.pref === option;
                        return (
                          <Pressable
                            key={option}
                            accessibilityRole="radio"
                            accessibilityState={{ selected, checked: selected }}
                            accessibilityLabel={settingsText(THEME_PREFERENCE_LABEL[option])}
                            testID={`settings-theme-${option}`}
                            style={({ pressed }) => [styles.segment, selected && styles.segmentSelected, pressed && !selected && { opacity: 0.6 }]}
                            onPress={() => {
                              if (selected) return;
                              setThemePreference(option);
                              void saveThemeMode(option);
                            }}
                          >
                            <Text style={[styles.segmentText, selected && styles.segmentTextSelected]} numberOfLines={1}>{settingsText(THEME_PREFERENCE_LABEL[option])}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </SettingsControlRow>
                ) : null}
              </SettingsGroup>
              {/* 语言本身就是一组积木卡片(LanguageSettings):放在两张卡中间,不套进卡里。 */}
              {show('appearance', 'language') ? <LanguageSettings /> : null}
              <WideCard>
                {/* 字体大小 / 界面密度 + 预览 + 恢复默认 (src/UiScaleSettings.tsx, src/ui-scale.ts). */}
                <UiScaleSettings s={styles} showFont={show('appearance', 'fontSize')} showDensity={show('appearance', 'density')} />
              </WideCard>
            </View>
          ) : null}

          {sectionsToRender.includes('notifications') ? (
            // v2(#427):开关行 = SettingsSwitchRow、分段 / 时间 / 测试按钮 = SettingsControlRow / SettingsActionRow,
            // 标签列、右侧控件列、52 行高和其它积木行一致;需要修的权限提示单独一行红字(点了去修),不再夹在说明文字里。
            <View style={sectionStyle} testID="notify-settings-card">
              {heading('notifications')}
              <SettingsGroup footer={!searching ? (nativeNotify ? tr('settings.copy.75') : tr('settings.copy.76')) : undefined}>
                {show('notifications', 'enabled') ? (
                  <SettingsSwitchRow
                    label={tr('settings.copy.41')}
                    subtitle={tr('settings.copy.42')}
                    value={notify.enabled}
                    onValueChange={value => {
                      saveNotify({ ...notify, enabled: value });
                      if (value) void ensurePermission();
                    }}
                    testID="notify-enabled-row"
                  />
                ) : null}
                {show('notifications', 'enabled') && nativeNotify && notify.enabled && permission && permission.status !== 'granted' ? (
                  <SettingsRow label={tr('settings.copy.43')} tone="danger" onPress={() => { void ensurePermission(); }} testID="notify-permission-fix" />
                ) : null}
                {show('notifications', 'mode') ? (
                  <SettingsControlRow label={tr('settings.copy.44')} subtitle={notify.mode === 'new' ? tr('settings.copy.45') : tr('settings.copy.46')} disabled={!notify.enabled} testID="notify-mode-row">
                    <View style={styles.segmented} accessibilityRole="radiogroup">
                      {([['all', tr('settings.copy.47')], ['new', tr('settings.copy.48')]] as const).map(([mode, label]) => (
                        <Pressable
                          key={mode}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: notify.mode === mode, disabled: !notify.enabled }}
                          disabled={!notify.enabled}
                          onPress={() => saveNotify({ ...notify, mode })}
                          style={[styles.segment, notify.mode === mode && styles.segmentSelected]}
                          testID={`notify-mode-${mode}`}
                        >
                          <Text style={[styles.segmentText, notify.mode === mode && styles.segmentTextSelected]}>{label}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </SettingsControlRow>
                ) : null}
                {show('notifications', 'sound') ? (
                  <SettingsSwitchRow
                    label={tr('settings.copy.49')}
                    subtitle={tr('settings.copy.50')}
                    value={notify.soundEnabled}
                    onValueChange={value => {
                      const next = { ...notify, soundEnabled: value };
                      saveNotifySettings(next);
                      if (value) playChime();
                    }}
                    testID="notify-sound-row"
                  />
                ) : null}
                {show('notifications', 'quiet') ? (
                  <SettingsSwitchRow
                    label={tr('settings.copy.51')}
                    subtitle={notify.quiet.enabled ? tr('settings.copy.187', { v0: notify.quiet.start, v1: notify.quiet.end }) : tr('settings.copy.52')}
                    value={notify.quiet.enabled}
                    onValueChange={value => { saveNotifySettings({ ...notify, quiet: { ...notify.quiet, enabled: value } }); }}
                    testID="notify-quiet-row"
                  />
                ) : null}
                {show('notifications', 'quiet') && notify.quiet.enabled ? (
                  <SettingsControlRow label={tr('settings.copy.53')} testID="notify-quiet-times">
                    <View style={styles.quietRow}>
                      <TextInput
                        accessibilityLabel={tr('settings.copy.54')}
                        style={styles.quietInput}
                        value={quietStart}
                        onChangeText={setQuietStart}
                        onBlur={() => saveNotifySettings({ ...notify, quiet: { ...notify.quiet, start: quietStart } })}
                        placeholder="22:00"
                        placeholderTextColor={colors.textMuted}
                      />
                      <Text style={styles.rowHint}>{tr('settings.copy.55')}</Text>
                      <TextInput
                        accessibilityLabel={tr('settings.copy.56')}
                        style={styles.quietInput}
                        value={quietEnd}
                        onChangeText={setQuietEnd}
                        onBlur={() => saveNotifySettings({ ...notify, quiet: { ...notify.quiet, end: quietEnd } })}
                        placeholder="08:00"
                        placeholderTextColor={colors.textMuted}
                      />
                    </View>
                  </SettingsControlRow>
                ) : null}
                {show('notifications', 'muted') ? (
                  <SettingsRow label={tr('settings.copy.57')} subtitle={muted.length ? tr('settings.copy.58') : (nativeNotify ? tr('settings.copy.59') : tr('settings.copy.60'))} testID="notify-muted-row" />
                ) : null}
                {show('notifications', 'muted') ? muted.map(alias => (
                  <SettingsActionRow key={`muted-${alias}`} label={alias} action={tr('settings.copy.61')} tone="accent" onPress={() => saveNotify(toggleAgentMuted(notify, notifyKey, alias))} testID={`notify-muted-${alias}`} />
                )) : null}
                {show('notifications', 'keepAlive') ? (
                  <SettingsSwitchRow
                    label={tr('settings.copy.62')}
                    subtitle={keepAliveStatusText(notify, keepAliveState) ? `${tr('settings.copy.63')}\n${keepAliveStatusText(notify, keepAliveState)}` : tr('settings.copy.63')}
                    subtitleTone={keepAliveState.error ? 'danger' : undefined}
                    value={notify.keepAlive}
                    disabled={!notify.enabled || !keepAliveState.available}
                    onValueChange={value => {
                      saveNotify({ ...notify, keepAlive: value });
                      setTimeout(() => bumpKeepAlive(n => n + 1), 1500);
                    }}
                    testID="notify-keepalive-row"
                  />
                ) : null}
                {show('notifications', 'dndBypass') ? (
                  <SettingsSwitchRow
                    label={tr('settings.copy.64')}
                    subtitle={notify.dndBypass && dndAccess === true ? `${tr('settings.copy.65')}\n${tr('settings.copy.67')}` : tr('settings.copy.65')}
                    value={notify.dndBypass}
                    disabled={!notify.enabled}
                    onValueChange={value => {
                      saveNotify({ ...notify, dndBypass: value });
                      if (value && dndAccessGranted() === false) void openDndAccessSettings();
                    }}
                    testID="notify-dnd-row"
                  />
                ) : null}
                {show('notifications', 'dndBypass') && notify.dndBypass && dndAccess === false ? (
                  <SettingsRow label={tr('settings.copy.66')} tone="danger" onPress={() => { void openDndAccessSettings(); }} testID="notify-dnd-grant" />
                ) : null}
                {show('notifications', 'xiaomiGuide') ? (
                  <SettingsRow label={tr('settings.copy.68')} subtitle={tr('settings.copy.69')} onPress={() => setGuideVisible(true)} testID="notify-xiaomi-guide" />
                ) : null}
                {show('notifications', 'test') ? (
                  <SettingsActionRow
                    label={tr('settings.copy.70')}
                    subtitle={testMessage || tr('settings.copy.71')}
                    action={tr('settings.copy.72')}
                    onPress={() => {
                      void (async () => {
                        if (!(await ensurePermission())) { setTestMessage(tr('settings.copy.8')); return; }
                        try { await sendTestNotification(); setTestMessage(tr('settings.copy.9')); }
                        catch (e) { setTestMessage(tr('settings.copy.181', { v0: String((e as Error)?.message ?? e) })); }
                      })();
                    }}
                    testID="notify-test-row"
                  />
                ) : null}
              </SettingsGroup>
              {show('notifications', 'diagnostics') ? (
                <SettingsGroup title={tr('settings.copy.73')} caption={tr('settings.copy.74')} testID="notify-diagnostics-group">
                  {notifyPreview ? null : <SettingsCardContent><NotifyDiagnosticsPanel /></SettingsCardContent>}
                </SettingsGroup>
              ) : null}
            </View>
          ) : null}

          {sectionsToRender.includes('voice') ? (
            <View style={sectionStyle} testID="settings-section-voice">
              {heading('voice')}
              {/* VoiceSettingsSection 自己画成几组设置积木卡片(v2),不再套一层 WideCard。 */}
              <VoiceSettingsSection showMode={show('voice', 'mode')} showCredentials={show('voice', 'credentials')} showMic={show('voice', 'mic')} showTest={show('voice', 'test')} />
            </View>
          ) : null}

          {sectionsToRender.includes('shortcuts') ? (
            <View style={styles.section} testID="settings-section-shortcuts">
              {heading('shortcuts')}
              <WideCard>
                <ShortcutsSettings s={styles} showNav={show('shortcuts', 'nav')} showChat={show('shortcuts', 'chat')} showSend={show('shortcuts', 'send')} />
              </WideCard>
            </View>
          ) : null}

          {sectionsToRender.includes('about') && !showWideChangelog ? (
            <View style={sectionStyle}>
              {heading('about')}
              <BrandMark size={36} style={{ marginTop: 8, marginBottom: 12 }} />
              <SettingsGroup>
                {show('about', 'version') ? <SettingsRow label={tr('settings.copy.77')} value={`v${APP_VERSION}`} onPress={onVersionTap} testID="settings-version-row" /> : null}
                {show('about', 'update') ? (() => {
                  // 「点击更新好像没用」:每次手动检查都要落到一句看得见、和上一次不同的话上
                  // (版本号 + 刚刚检查 / 失败原因),而不是闪一下转圈又回到同一句。
                  const view = isIOS ? IOS_UPDATE_ROW : isAndroid
                    ? describeAndroidUpdateRow(androidUpdate, { currentVersion: APP_VERSION, lastCheckedAt: androidUpdateLastCheckedAt(), now: Date.now() })
                    : describeUpdateRow(update, { currentVersion: APP_VERSION, lastCheckedAt: desktopUpdateLastCheckedAt(), now: Date.now() });
                  const valueColor = view.tone === 'danger' ? colors.failed : view.tone === 'accent' ? colors.accent : colors.textMuted;
                  return (
                    <SettingsControlRow
                      label={tr('settings.copy.78')}
                      testID="settings-update-row"
                      onPress={view.actionable ? () => {
                        if (isIOS) void openTestFlight(Linking);
                        else if (isAndroid) void checkAndroidUpdate(APP_VERSION);
                        else void checkDesktopUpdate(undefined, { manual: true });
                      } : undefined}
                      disabled={!view.actionable}
                      accessibilityState={{ busy: view.busy, disabled: !view.actionable }}
                    >
                      <View style={styles.dropdownValue}>
                        {view.busy ? <ActivityIndicator size="small" color={colors.accent} style={{ marginRight: 6 }} /> : null}
                        <Text testID="settings-update-label" style={[styles.updateValue, { color: valueColor }]} numberOfLines={2}>{view.label}</Text>
                        <View style={styles.accessoryCell}>{view.actionable && !view.busy ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null}</View>
                      </View>
                      {view.detail ? <Text testID="settings-update-detail" style={styles.updateDetail}>{view.detail}</Text> : null}
                    </SettingsControlRow>
                  );
                })() : null}
                {show('about', 'changelog') ? (
                  <SettingsRow label={tr('changelog.title')} subtitle={tr('changelog.rowHint')} onPress={() => { setWideChangelog(true); paneScrollRef.current?.scrollTo({ y: 0, animated: false }); }} testID="settings-changelog-row" />
                ) : null}
                {lastFatal && show('about', 'lastCrash') ? (
                  <SettingsActionRow label={tr('fatal.copyRow')} subtitle={fatalSummary(lastFatal)} onPress={() => { void copyLastFatal(lastFatal); }} testID="settings-last-crash-row" />
                ) : null}
              </SettingsGroup>
              {showPooledHttpDiagnostics(versionTaps.revealed, platform) && !searching ? (
                <SettingsGroup title={tr('settings.copy.281')} testID="settings-diagnostics-group">
                  <SettingsSwitchRow label={tr('settings.copy.277')} subtitle={tr('settings.copy.278')} value={pooledHttp} onValueChange={onPooledHttpChange} testID="settings-pooled-http-row" />
                </SettingsGroup>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
        )}
      </View>
      )}

      {/* 两个确认弹窗是 ScrollView 的兄弟不是子节点:Modal 套进滚动容器里会继承它的
          触摸处理,背板也不再铺满窗口。 */}
      <Modal visible={!!removeTarget} transparent animationType="fade" onRequestClose={() => setRemoveTarget(null)}>
        <View style={[styles.modalBackdrop, withBasePadding(dialogSafe, spacing.xl)]}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{tr('settings.copy.79')}</Text>
            <Text style={styles.modalBody}>{removeTarget ? `${maskedHubHost(removeTarget.serverUrl)} · ${removeTarget.username}` : ''}{tr('settings.copy.80')}</Text>
            <View style={styles.modalActions}>
              <Pressable style={styles.modalButton} onPress={() => setRemoveTarget(null)}><Text style={styles.rowValue}>{tr('settings.copy.7')}</Text></Pressable>
              <Pressable style={[styles.modalButton, styles.modalDanger]} onPress={() => {
                const target = removeTarget;
                setRemoveTarget(null);
                if (!target) return;
                if (target.profileId === currentId) void Promise.resolve(onLogout()).catch(error => setProfileError(String(error)));
                else void removeHubProfile(target.profileId).then(() => setProfiles(current => current.filter(item => item.profileId !== target.profileId))).catch(error => setProfileError(String(error)));
              }}><Text style={styles.dangerText}>{tr('settings.copy.81')}</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={localDeleteVisible} transparent animationType="fade" onRequestClose={() => setLocalDeleteVisible(false)}>
        <ModalKeyboardAvoider scrim={MODAL_SCRIM}>
        <View style={[styles.modalFrame, withBasePadding(dialogSafe, spacing.xl)]}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{tr('settings.copy.82')}</Text>
            <Text style={styles.modalBody}>{tr('settings.copy.83')}</Text>
            <TextInput
              value={localDeleteText}
              onChangeText={setLocalDeleteText}
              placeholder={tr('settings.copy.84')}
              placeholderTextColor={colors.textMuted}
              style={styles.confirmInput}
              autoCapitalize="none"
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalButton} onPress={() => setLocalDeleteVisible(false)}><Text style={styles.rowValue}>{tr('settings.copy.7')}</Text></Pressable>
              <Pressable disabled={localDeleteText !== tr('settings.copy.84') || localHubBusy} style={[styles.modalButton, styles.modalDanger, localDeleteText !== tr('settings.copy.84') && styles.disabled]} onPress={() => {
                setLocalHubBusy(true);
                void deleteLocalHubData().then(async backupPath => {
                  setLocalDeleteVisible(false);
                  setLocalBackupMessage(tr('settings.copy.189', { v0: backupPath }));
                  await onLocalDataDeleted();
                }).catch(error => setProfileError(String(error))).finally(() => setLocalHubBusy(false));
              }}><Text style={styles.dangerText}>{tr('settings.copy.85')}</Text></Pressable>
            </View>
          </View>
        </View>
        </ModalKeyboardAvoider>
      </Modal>
      <Modal visible={logoutConfirm} transparent animationType="fade" onRequestClose={() => setLogoutConfirm(false)}>
        <View style={[styles.modalBackdrop, withBasePadding(dialogSafe, spacing.xl)]}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{tr('settings.copy.86')}</Text>
            <Text style={styles.modalBody}>{`${maskedHubHost(cfg.serverUrl)} · ${me.username ?? cfg.username ?? ''}`}{tr('settings.copy.87')}</Text>
            <View style={styles.modalActions}>
              <Pressable style={styles.modalButton} onPress={() => setLogoutConfirm(false)}><Text style={styles.rowValue}>{tr('settings.copy.7')}</Text></Pressable>
              <Pressable testID="settings-logout-confirm" style={[styles.modalButton, styles.modalDanger]} onPress={() => {
                setLogoutConfirm(false);
                void Promise.resolve(onLogout()).catch(error => setProfileError(String(error)));
              }}><Text style={styles.dangerText}>{tr('settings.copy.6')}</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={!!sessions.confirm} transparent animationType="fade" onRequestClose={sessions.cancelConfirm}>
        <View style={[styles.modalBackdrop, withBasePadding(dialogSafe, spacing.xl)]}>
          <View style={styles.modalCard} testID="login-devices-confirm">
            <Text style={styles.modalTitle}>{sessions.confirm?.kind === 'others' ? tr('sessions.confirmOthersTitle') : tr('sessions.confirmOneTitle')}</Text>
            <Text style={styles.modalBody}>{sessions.confirm?.kind === 'others' ? tr('sessions.confirmOthersBody', { n: sessions.confirm.count }) : sessions.confirm ? tr('sessions.confirmOneBody', { name: sessions.confirm.name }) : ''}</Text>
            <View style={styles.modalActions}>
              <Pressable testID="login-devices-confirm-cancel" style={styles.modalButton} onPress={sessions.cancelConfirm}><Text style={styles.rowValue}>{tr('sessions.cancel')}</Text></Pressable>
              <Pressable testID="login-devices-confirm-ok" accessibilityRole="button" style={[styles.modalButton, styles.modalDestructive]} onPress={sessions.runConfirm}><Text style={styles.modalDestructiveText}>{sessions.confirm?.kind === 'others' ? tr('sessions.confirmOthersOk', { n: sessions.confirm.count }) : tr('sessions.confirm')}</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
      {manageDeptOpen && me.networkId ? (
        <ManageDepartmentPhone cfg={cfg} networkId={me.networkId} networkName={me.networkName ?? ''} managed={managedDepts} onClose={() => setManageDeptOpen(false)} />
      ) : null}
      <AccountSwitcher
        visible={switcherOpen}
        variant={compact ? 'sheet' : 'dialog'}
        profiles={profiles}
        currentId={currentId}
        onPick={pickProfile}
        onAdd={onAddAccount}
        onRemove={profile => setRemoveTarget(profiles.find(p => p.profileId === profile.profileId) ?? null)}
        onClose={() => setSwitcherOpen(false)}
      />
      <AccountMoreMenu
        anchor={menuFor?.anchor ?? null}
        profile={menuFor?.profile ?? null}
        items={menuFor ? accountMenuItems(profileActions(menuFor.profile), { current: menuFor.profile.profileId === currentId, requiresReauth: menuFor.profile.requiresReauth }) : []}
        onSelect={item => { if (menuFor) runMenuItem(item, menuFor.profile); }}
        onClose={closeMenu}
      />
      <AccountActionSheet
        visible={!pointer && !!sheetTarget}
        profile={sheetTarget}
        actions={sheetTarget ? profileActions(sheetTarget) : []}
        current={sheetTarget?.profileId === currentId}
        onSelect={action => { if (sheetTarget) runProfileAction(action, sheetTarget); }}
        onClose={() => setSheetTarget(null)}
      />
      {editTarget ? (
        <AccountEditDialog
          profile={editTarget}
          current={editTarget.profileId === currentId}
          onClose={() => setEditTarget(null)}
          onSaved={afterProfileEdit}
          onRelogin={onReauthProfile}
        />
      ) : null}
      <AccountToast text={toast} />
      {guideVisible ? <XiaomiGuideModal onClose={() => setGuideVisible(false)} /> : null}
    </View>
  );
}

type KeepAliveSnapshot = { available: boolean; running: boolean; error: string | null };
export type NotifySettingsPreview = {
  platform: SettingsPlatform;
  permission: { status: PermissionStatus; canAskAgain: boolean };
  keepAlive: KeepAliveSnapshot;
  guideOpen?: boolean;
};
let keepAliveCache: KeepAliveSnapshot = { available: false, running: false, error: null };
/** useSyncExternalStore 要同一个对象才算「没变」。 */
function keepAliveSnapshot(): KeepAliveSnapshot {
  const next = { available: keepAliveAvailable(), running: keepAliveRunning(), error: keepAliveLastError() };
  if (next.available !== keepAliveCache.available || next.running !== keepAliveCache.running || next.error !== keepAliveCache.error) keepAliveCache = next;
  return keepAliveCache;
}

function keepAliveStatusText(notify: NotifySettings, state: KeepAliveSnapshot): string {
  if (!state.available) return tr('settings.copy.88');
  if (state.error) return tr('settings.copy.190', { v0: state.error });
  if (!notify.keepAlive) return '';
  if (!notify.enabled) return tr('settings.copy.89');
  return state.running ? tr('settings.copy.90') : tr('settings.copy.91');
}

/** 标签在左、只读值在右。 */
/**
 * 宽屏右栏的一段(#427):沿用原来的行,外面套上设置积木的卡片(同手机子页的白色圆角卡),整页读起来是一组组卡片,
 * 和账号段的 SettingsGroup 左右边缘对齐。旧行自带 12 的左右内边距,这里再补 4 —— 标签左边缘 = 卡片 + 16,
 * 和积木行(SETTINGS_ROW_PAD_X)一样;分隔线的缩进同理。
 */
function WideCard({ children }: { children: ReactNode }) {
  if (!Children.toArray(children).length) return null;
  return <SettingsGroup separators={false} testID="settings-wide-card"><View style={styles.wideCardInner}>{children}</View></SettingsGroup>;
}

const DEVICE_ICON: Record<DeviceKind, string> = {
  phone: 'phone-portrait-outline',
  desktop: 'desktop-outline',
  browser: 'globe-outline',
  terminal: 'terminal-outline',
  unknown: 'help-circle-outline',
};

function Divider() {
  useTranslation();
  return <View style={styles.divider} />;
}

const makeStyles = () =>
  StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  rootWide: { flexDirection: 'row' },
  // 手机分组列表(照微信「设置」):浅地面、白行、组标题小灰字;行高下限 48。
  // 地面 = 顶栏 / 状态栏那条的同一色(colors.bg):09-27 截图里顶栏下面那道灰带就是
  // 「白顶栏 + groupedBg 地面」的接缝。白块靠细线描边和地面分开。
  rootPhone: { backgroundColor: colors.bg },
  phoneScroll: { flex: 1 },
  phoneListContent: { paddingBottom: spacing.xl * 2 },
  phoneHeader: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: spacing.xs, backgroundColor: colors.bg },
  phoneHeaderSide: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  phoneHeaderTitle: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  // 右上角有按钮(保存 / 完成(N))时两侧同宽,标题仍在正中。
  // 返回箭头的左边距(头 4 + 格子里 10)与按钮的右边距同为 14。
  phoneHeaderActionSide: { width: 104, alignItems: 'flex-end', paddingRight: 10 },
  phoneHeaderBackWide: { width: 104, alignItems: 'flex-start', paddingLeft: 10 },
  phoneHeaderAction: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingHorizontal: spacing.md, borderRadius: radius.item, backgroundColor: colors.accent },
  phoneHeaderActionText: { color: colors.onAccent, fontSize: 15, fontWeight: '600' },
  // 左栏:与导航栏同一色系,细线分隔;宽屏固定宽,窄屏变成顶部一条横向分类。
  sidebar: { width: 232, backgroundColor: colors.railBg, borderRightWidth: 1, borderRightColor: colors.border, paddingTop: spacing.lg },
  sidebarCompact: { width: '100%', borderRightWidth: 0, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.sm },
  sidebarTop: { paddingHorizontal: spacing.md, gap: spacing.md, marginBottom: spacing.md },
  closeButton: { width: ds(32), height: ds(32), borderRadius: radius.item, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, backgroundColor: colors.inputBg, paddingHorizontal: spacing.md, minHeight: ds(36) },
  searchInput: { flex: 1, color: colors.text, fontSize: 13, padding: 0, outlineStyle: 'none' } as any,
  categoryList: { paddingHorizontal: spacing.sm, gap: 2 },
  categoryRow: { flexDirection: 'row', paddingHorizontal: spacing.md, gap: spacing.sm },
  categoryItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, borderRadius: radius.item },
  categoryChip: { borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.xs + 2 },
  categoryItemHover: { backgroundColor: colors.rowHover },
  categoryItemActive: { backgroundColor: colors.rowActive },
  categoryLabel: { color: colors.textSecondary, fontSize: 14 },
  categoryLabelActive: { color: colors.text, fontWeight: '600' },
  emptySide: { color: colors.textMuted, fontSize: 12, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  // 右栏
  pane: { flex: 1, minWidth: 0 },
  paneTitle: { color: colors.text, fontSize: 20, fontWeight: '600', paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, marginHorizontal: spacing.lg },
  // 「登录设备」页的标题行:‹ 账号 + 标题。标题的字号 / 基线、底边线的位置和普通 paneTitle 相同(drive.mjs 量)。
  paneTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.xl - spacing.sm, paddingRight: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, marginHorizontal: spacing.lg },
  paneTitleText: { color: colors.text, fontSize: 20, fontWeight: '600', flexShrink: 1 },
  paneBack: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: spacing.xs, paddingVertical: 2, borderRadius: radius.control },
  paneBackText: { color: colors.textSecondary, fontSize: 14 },
  deviceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: SETTINGS_ROW_PAD_X, paddingVertical: spacing.sm, minHeight: settingsRowMinHeight() },
  // 展开的组里的每一条:不重复图标,左边对齐到组头的文字列(图标 36 + 间距 12)。
  deviceMemberRow: { paddingLeft: SETTINGS_ROW_PAD_X + 36 + spacing.md },
  deviceIcon: { width: 36, height: 36, borderRadius: radius.item, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.subtleFill },
  deviceTitleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 0 },
  currentBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: colors.tonalBg },
  currentBadgeText: { color: colors.accent, fontSize: 11, fontWeight: '600' },
  deviceSignOut: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.control },
  deviceSignOutHover: { backgroundColor: colors.subtleFill },
  // 底部多留一个 spacing.xl:最后一行要能完全离开窗口下沿,而不是刚好贴上去——贴上去看起来就和「滚不动」一样。
  // #427:右栏内容收成居中的一列(最宽 760),卡片在大窗口里不被拉成一整条。
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2, width: '100%', maxWidth: 760, alignSelf: 'center' },
  // 卡片自己带 16 的左右边距(settings-kit SETTINGS_GUTTER),段落不再另加。
  section: { paddingBottom: spacing.md },
  wideCardInner: {},
  groupTitle: { color: colors.textMuted, fontSize: 12, marginTop: spacing.md, marginBottom: spacing.xs },
  emptyPane: { color: colors.textMuted, fontSize: 14, paddingHorizontal: spacing.md, paddingVertical: spacing.lg },
  // v2(#427):右栏里还在用这套样式的行(快捷键、字体大小 / 界面密度、登录设备,经 s={styles} 传进去)和设置积木
  // 同一套尺寸 —— 左右内边距 16、行高下限 52(settingsRowMinHeight)、标签 16 号、说明 13 号、分隔线从 16 开始。
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: SETTINGS_ROW_PAD_X,
    paddingVertical: spacing.sm,
    minHeight: settingsRowMinHeight(),
  },
  rowCopy: { flex: 1, minWidth: 0, gap: 3 },
  rowLabel: { color: colors.text, fontSize: 16 },
  rowLabelStrong: { color: colors.text, fontSize: 16, fontWeight: '600' },
  rowValue: { color: colors.textMuted, fontSize: 15, flexShrink: 1 },
  rowHint: { color: colors.textMuted, fontSize: 13, lineHeight: 18, flexShrink: 1 },
  footHint: { color: colors.textMuted, fontSize: 13, lineHeight: 18, paddingHorizontal: SETTINGS_ROW_PAD_X, paddingVertical: spacing.sm },
  dropdownValue: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  // 主题三选一。宽处与说明并排;窄屏(手机竖屏)放不下「跟随系统（当前：深色）」一整行时,
  // 分段控件整体折到下一行 —— 说明文字不被挤成两行半个词。
  themeRow: { flexWrap: 'wrap', rowGap: spacing.sm, columnGap: spacing.md },
  themeRowCopy: { flexGrow: 1, flexShrink: 1, flexBasis: 150, minWidth: 150 },
  segmented: { flexDirection: 'row', flexShrink: 0, padding: 2, borderRadius: radius.control, backgroundColor: colors.subtleFill, borderWidth: 1, borderColor: colors.border },
  segment: { paddingHorizontal: spacing.sm + 2, paddingVertical: ds(6), borderRadius: radius.item, alignItems: 'center', justifyContent: 'center', minWidth: 44, borderWidth: 1, borderColor: 'transparent' },
  segmentSelected: { backgroundColor: colors.card, borderColor: colors.border },
  segmentText: { color: colors.textSecondary, fontSize: 13 },
  segmentTextSelected: { color: colors.text, fontWeight: '600' },
  quietRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  updateValue: { fontSize: 15, textAlign: 'right', flexShrink: 1 },
  updateDetail: { fontSize: 12, color: colors.textMuted, marginTop: 2, marginRight: 18 + spacing.sm, textAlign: 'right' },
  // 右侧 › 的格子:和设置积木的 accessory 同宽(18),› 右边缘和其他行对齐。
  accessoryCell: { width: 18, height: 18, marginLeft: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  quietInput: { color: colors.text, fontSize: 14, borderWidth: 1, borderColor: colors.border, borderRadius: radius.item, paddingHorizontal: 8, paddingVertical: 4, minWidth: 64, textAlign: 'center', backgroundColor: colors.inputBg },
  accentText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  dangerText: { color: colors.failed, fontSize: 14, fontWeight: '600' },
  errorText: { color: colors.failed, fontSize: 13, paddingHorizontal: SETTINGS_ROW_PAD_X, paddingVertical: spacing.sm },
  actionButton: { ...buttonStyle('secondary') },
  actionButtonText: { ...buttonTextStyle('secondary') },
  dangerZone: { marginTop: spacing.lg, borderWidth: 1, borderColor: colors.failed, borderRadius: radius.surface, overflow: 'hidden' },
  dangerZoneTitle: { color: colors.failed, fontSize: 12, fontWeight: '600', paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  dangerZoneRow: { paddingTop: spacing.sm },
  confirmInput: { marginTop: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, color: colors.text, backgroundColor: colors.inputBg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  disabled: { opacity: 0.45 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: SETTINGS_ROW_PAD_X },
  modalBackdrop: { flex: 1, backgroundColor: MODAL_SCRIM, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  // 有键盘避让的那个:遮罩画在 ModalKeyboardAvoider 上(铺满窗口),这里只管居中。
  modalFrame: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalCard: { width: '100%', maxWidth: 440, backgroundColor: colors.card, borderRadius: radius.surface, padding: spacing.lg, ...elevated('floating') },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
  modalBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, marginTop: spacing.sm },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.lg },
  modalButton: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.control, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  modalDanger: { borderColor: colors.failed },
  // 「退出其他所有登录」的确认键:实心红底白字 —— 一下会退掉脚本和 agent 在用的登录,比描边红字的普通确认更重。
  modalDestructive: { backgroundColor: colors.failed, borderColor: colors.failed },
  modalDestructiveText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
});

// Theme styling idiom (shared across screens): `styles` is a module-level
// value rebuilt whenever the theme flips. The reassignment alone does NOT
// re-render an already-mounted screen — App.tsx remounts the whole tree by
// putting key={theme} on the root <SafeAreaView> inside AppRoot, so the next
// render reads these fresh styles. Keep both halves in sync: rebuild here,
// remount there.
const themeSnapshotKey = (): string => `${themePreference()}|${themeMode()}`;

let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
