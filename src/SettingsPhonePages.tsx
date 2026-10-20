import { t as tr } from './i18n';
import { maskedHubHost } from './mask-hub-address';
import { useTranslation } from './i18n-react';
import { localizedVoiceStatus } from './i18n-settings-presentation';
import { settingsText } from './i18n-settings';
import { localizedThemeSummary, localizedScaleSummary } from './i18n-settings-presentation';
// 手机「设置」的子页(Vincent 2026-09-27「设置界面有点体验太差」,截图是 设置 → 语音输入)。
//
// #439 把列表页做成了微信式分组,子页却还是宽屏右栏那套密排表单:贴边、大圆点单选卡片、控件之间
// 夹长段说明、API Key 是行内输入框加两个小按钮。这里按类重画**全部**子页,只用 settings-kit 的积木:
//   分组卡片(左右 16)· 行(≥48,标签 · 值 · ›)· 单选行(右侧 ✓)· 开关行 · 整宽按钮;
//   说明挪到卡片下面的小灰字;要输入的东西点进三级编辑页(SettingsEditPages.tsx)。
// 状态与动作全部来自 SettingsScreen / useVoiceSettings,和宽屏同一份 —— 这里只换画法。
//
// 🔴 settings-subpages.test.ts 静态守着这个文件:不许直接用 TextInput、不许画单选圆点卡片、
//    不许从 react-native 拿 Switch —— 一律经 settings-kit。
import type { ReactNode } from 'react';
import LanguageSettings from './LanguageSettings';
import UserAvatarEditor from './UserAvatarEditor';
import './i18n-changelog';
import './i18n-fatal';
import { fatalSummary } from './fatal-report';
import { copyLastFatal, useLastFatalReport } from './use-last-fatal';
import { Platform } from 'react-native';
import { BrandMark } from './brand-mark';
import { LOCAL_HUB_PROFILE_ID } from './local-hub';
import { SettingsAccountRow, SettingsButton, SettingsCardContent, SettingsChoiceRow, SettingsGroup, SettingsRow, SettingsSwitchRow, type SettingsTone } from './settings-kit';
import { ChangePasswordEditPage, VoiceAdvancedEditPage, VoiceApiKeyEditPage, QuietHoursEditPage } from './SettingsEditPages';
import type { ChangePasswordState } from './useChangePassword';
import './i18n-password';
import type { HubConfig } from './api';
import type { DesktopStorageDiagnostics, HubProfile } from './storage';
import { saveThemeMode } from './storage';
import { THEME_PREFERENCES, THEME_PREFERENCE_LABEL, setThemePreference, themePreferenceSummary, type ThemePreference } from './theme';
import { APP_VERSION } from './version';
import type { LocalHubResult } from './local-hub';
import type { NotifySettings } from './notify-settings';
import type { PermissionStatus } from './mobile-notify-model';
import NotifyDiagnosticsPanel from './NotifyDiagnosticsPanel';
import { persistUiScale, UiScalePreview } from './UiScaleSettings';
import { DENSITY_OPTIONS, FONT_SIZE_OPTIONS, uiScale, uiScaleLayoutWide, uiScaleSummary } from './ui-scale';
import { CONSOLE_HELP, useVoiceSettings, VOICE_UNSUPPORTED_TEXT } from './VoiceSettingsSection';
import MicDeviceSetting from './MicDeviceSetting';
import { MODE_LABELS, STREAM_UNAVAILABLE_HINT, streamingSupported } from './voice-stream-policy';
import { VOLC_CONSOLE_URL } from './voice-credentials-model';
import { openExternal } from './open-external';
import type { SettingsCategoryKey, SettingsDetailKey } from './settings-model';
import type { LoginSessionsState } from './useLoginSessions';
import { groupTestKey, memberSubtitle, sessionSubtitle, visibleSessions, SESSIONS_VISIBLE_DEFAULT, type LoginSession } from './login-sessions';

type KeepAliveSnapshot = { available: boolean; running: boolean; error: string | null };

/** SettingsScreen 交给子页的全部状态与动作(和宽屏右栏读的是同一份)。 */
export type PhonePagesCtx = {
  cfg: HubConfig;
  /** 用户管理子页(宽屏右栏同一个组件)。memberOpen = 三级页「成员」开着(点了某个成员)。 */
  renderUsers: (detail: 'userMember' | 'userGroup' | null) => ReactNode;
  renderAgentOrg: () => ReactNode;
  show: (cat: SettingsCategoryKey, row: string) => boolean;
  detail: SettingsDetailKey | null;
  openDetail: (key: SettingsDetailKey) => void;
  closeDetail: () => void;
  // 账号
  profiles: HubProfile[];
  me: { username?: string };
  profileError: string;
  storageDiagnostics: DesktopStorageDiagnostics | null;
  tauriDesktop: boolean;
  /** 列表里当前账号的 id(手机上迁移过来的账号 cfg 没有 profileId,它的 id 是 legacy)。 */
  currentProfileId: string | undefined;
  onPickProfile: (profile: HubProfile) => void;
  onOpenProfileWindow: (profile: HubProfile) => void;
  onRemoveProfile: (profile: HubProfile) => void;
  /** 账号行的 ⋯:鼠标 = 锚在 ⋯ 下的菜单,手指 = 底部动作面板(SettingsScreen 决定)。 */
  onProfileMore: (profile: HubProfile, anchor: any) => void;
  /** 鼠标 + 键盘(桌面窄窗口也会进到这一页):账号说明写「点一下」而不是「点 ⋯ 管理」。 */
  pointer: boolean;
  onAddAccount: () => void;
  /** 登录设备(hub 的登录会话列表);旧 hub 没有接口时 available=false,入口不出现。 */
  sessions: LoginSessionsState;
  /** 修改密码(#653):表单状态与提交(宽屏同一份)、hub 是否判了弱密码、本账号能不能改(本地工作区不能)。 */
  password: ChangePasswordState;
  weakPassword: boolean;
  canChangePassword: boolean;
  openPassword: () => void;
  // 本地 Hub
  localHub: LocalHubResult | null;
  localHubBusy: boolean;
  localBackupMessage: string;
  localHubActions: { upgrade: () => void; restart: () => void; stop: () => void; logs: () => void; backup: () => void; openDelete: () => void };
  // 外观
  themePref: ThemePreference;
  themeModeNow: 'light' | 'dark';
  // 通知
  notify: NotifySettings;
  saveNotify: (next: NotifySettings) => void;
  nativeNotify: boolean;
  permission: { status: PermissionStatus; canAskAgain: boolean } | null;
  ensurePermission: () => Promise<boolean>;
  muted: readonly string[];
  unmute: (alias: string) => void;
  keepAliveState: KeepAliveSnapshot;
  keepAliveStatus: string;
  onKeepAliveChange: (value: boolean) => void;
  dndAccess: boolean | null | undefined;
  onDndBypassChange: (value: boolean) => void;
  openDndAccess: () => void;
  openXiaomiGuide: () => void;
  testMessage: string;
  sendTest: () => void;
  onSoundChange: (value: boolean) => void;
  notifyPreview: boolean;
  quietStart: string;
  quietEnd: string;
  setQuietStart: (v: string) => void;
  setQuietEnd: (v: string) => void;
  // 快捷键(只在窄的桌面窗口里会进到这一页):沿用宽屏那段渲染,放进一张卡片里。
  renderShortcuts: () => ReactNode;
  // 关于
  updateView: { label: string; detail?: string; tone: string; busy: boolean; actionable: boolean };
  onCheckUpdate: () => void;
  /** #695 连点「版本」5 下揭开「诊断」组;showPooledHttp = 已揭开且在桌面壳里(diagnostics-reveal.ts)。 */
  onVersionTap: () => void;
  showPooledHttp: boolean;
  pooledHttp: boolean;
  onPooledHttpChange: (value: boolean) => void;
};

export default function SettingsPhonePage({ page, ctx }: { page: SettingsCategoryKey; ctx: PhonePagesCtx }) {
  useTranslation();
  switch (page) {
    case 'account': return ctx.detail === 'loginDevices' ? <LoginDevicesPage ctx={ctx} /> : ctx.detail === 'changePassword' && ctx.canChangePassword ? <ChangePasswordEditPage ctx={ctx} /> : <AccountPage ctx={ctx} />;
    case 'users': return <>{ctx.renderUsers(ctx.detail === 'userMember' ? 'userMember' : ctx.detail === 'userGroup' ? 'userGroup' : null)}</>;
    case 'agentTeams': return <>{ctx.renderAgentOrg()}</>;
    case 'localHub': return <LocalHubPage ctx={ctx} />;
    case 'appearance': return <AppearancePage ctx={ctx} />;
    case 'notifications': return ctx.detail === 'quietHours' ? <QuietHoursEditPage ctx={ctx} /> : <NotificationsPage ctx={ctx} />;
    case 'voice': return <VoicePhonePage ctx={ctx} />;
    case 'shortcuts': return <ShortcutsPage ctx={ctx} />;
    case 'about': return <AboutPage ctx={ctx} />;
    default: return null;
  }
}

const profileName = (p: HubProfile) => p.displayName || p.username || tr('settings.copy.12');
/** 账号行的灰字:地址(去掉 http(s):// 和结尾 /,#649 打码)· 用户名 · 网络。宽屏同一写法(settings-account-subtitle)。 */
export const accountSubtitle = (p: Pick<HubProfile, 'serverUrl' | 'username' | 'networkId'>): string =>
  `${maskedHubHost(p.serverUrl)} · ${p.username || tr('settings.copy.14')}${p.networkId ? ` · ${p.networkId}` : ''}`;

// ── 账号 ─────────────────────────────────────────────────────────────────────────────────────
// #427「设置页整体重新设计」:当前账号一张卡(大头像、「当前」小标、主色细边)置顶;其他账号一组,点一下切换,
// 每行 ⋯ 出底部动作面板(复制 / 编辑 / 移除);登录设备单独一组。退出登录 / 切换账号仍在设置首页最下面两块。
function AccountPage({ ctx }: { ctx: PhonePagesCtx }) {
  useTranslation();
  const { cfg, profiles, show } = ctx;
  const devices = show('account', 'devices') && ctx.sessions.available;
  const passwordRow = show('account', 'changePassword') && ctx.canChangePassword;
  const current = profiles.find(profile => profile.profileId === ctx.currentProfileId) ?? null;
  const others = profiles.filter(profile => profile.profileId !== ctx.currentProfileId);
  const row = (profile: HubProfile, isCurrent: boolean) => (
    <SettingsAccountRow
      key={profile.profileId}
      testID={`settings-profile-${profile.profileId}`}
      name={profileName(profile)}
      subtitle={accountSubtitle(profile)}
      warning={profile.requiresReauth ? tr('settings.copy.15') : undefined}
      current={isCurrent ? tr('accounts.currentPill') : undefined}
      badge={profile.profileId === LOCAL_HUB_PROFILE_ID ? tr('accounts.localPill') : undefined}
      large={isCurrent}
      onPress={() => ctx.onPickProfile(profile)}
      onMore={el => ctx.onProfileMore(profile, el)}
      moreLabel={tr('accounts.more', { name: profileName(profile) })}
    />
  );
  return (
    <>
      {show('account', 'profiles') && profiles.length ? (
        <>
          {current ? <SettingsGroup title={tr('accounts.groupCurrent')} highlight testID="settings-account-current">{row(current, true)}</SettingsGroup> : null}
          <SettingsGroup
            title={others.length ? tr('accounts.groupOthers') : undefined}
            testID="settings-account-profiles"
            footer={ctx.profileError || (others.length ? tr(ctx.pointer ? 'accounts.othersFooter' : 'accounts.othersFooterTouch') : undefined)}
            footerTone={ctx.profileError ? 'danger' : undefined}
          >
            {others.map(profile => row(profile, false))}
            {show('account', 'addAccount') ? <SettingsRow label={tr('settings.copy.93')} tone="accent" icon="add" onPress={ctx.onAddAccount} testID="settings-add-account" /> : null}
          </SettingsGroup>
        </>
      ) : (
        <SettingsGroup>
          {show('account', 'profiles') ? <SettingsRow label={tr('settings.copy.18')} value={maskedHubHost(cfg.serverUrl)} /> : null}
          {show('account', 'profiles') ? <SettingsRow label={tr('settings.copy.19')} value={ctx.me.username ?? cfg.username ?? '—'} /> : null}
          {show('account', 'addAccount') ? <SettingsRow label={tr('settings.copy.93')} tone="accent" icon="add" onPress={ctx.onAddAccount} testID="settings-add-account" /> : null}
        </SettingsGroup>
      )}
      {show('account', 'avatar') ? <UserAvatarEditor cfg={cfg} /> : null}
      {devices || passwordRow ? (
        <SettingsGroup title={tr('accounts.groupSecurity')} testID="settings-account-security">
          {passwordRow ? (
            <SettingsRow
              label={tr('password.title')}
              icon="key-outline"
              subtitle={ctx.weakPassword ? tr('password.weakRowHint') : undefined}
              subtitleTone={ctx.weakPassword ? 'accent' : undefined}
              onPress={ctx.openPassword}
              testID="settings-change-password"
            />
          ) : null}
          {devices ? (
            <SettingsRow
              label={tr('sessions.title')}
              icon="desktop-outline"
              value={ctx.sessions.sessions.length ? tr('sessions.count', { n: ctx.sessions.sessions.length }) : undefined}
              onPress={() => ctx.openDetail('loginDevices')}
              testID="settings-login-devices"
            />
          ) : null}
        </SettingsGroup>
      ) : null}
      {show('account', 'profiles') && ctx.storageDiagnostics ? (
        <SettingsGroup title={tr('accounts.groupLocalData')}>
          {show('account', 'profiles') && ctx.storageDiagnostics ? (
            <SettingsRow
              label={tr('accounts.dataDir')}
                    icon="folder-outline"
              subtitle={`${ctx.storageDiagnostics.root}${ctx.storageDiagnostics.corrupt_backups.length ? tr('settings.copy.185', { v0: ctx.storageDiagnostics.corrupt_backups.length }) : ''}`}
              value={tr('accounts.dataDirValue', { n: ctx.storageDiagnostics.profile_count })}
              testID="settings-account-data-dir"
            />
          ) : null}
        </SettingsGroup>
      ) : null}
    </>
  );
}


/**
 * 三级页:登录设备。每台设备一行(名字 · 最近使用 · 右侧「退出」红字;本机写「本机」、不能在这里退出),
 * 底下整宽的「退出其他所有设备」。确认弹窗在 SettingsScreen(和宽屏共用一个)。
 */
function LoginDevicesPage({ ctx }: { ctx: PhonePagesCtx }) {
  useTranslation();
  const s = ctx.sessions;
  const now = Date.now();
  const shown = visibleSessions(s.items, s.showAll);
  const footer = s.message?.text ?? (s.idleDays ? tr('sessions.idleFooter', { n: s.idleDays }) : undefined);
  if (s.error) {
    return (
      <>
        <SettingsGroup footer={tr('sessions.loadFailed', { msg: s.error })} footerTone="danger" />
        <SettingsButton variant="plain" label={tr('sessions.retry')} onPress={() => void s.refresh()} testID="login-devices-retry" />
      </>
    );
  }
  // 一条登录一行(本机 / 只出现一次的设备名);同一设备名的多条并成一行组头「N 个」,点开在下面列出每一条。
  const sessionRow = (session: LoginSession, label: string, member: boolean) => (
    <SettingsRow
      key={session.token_id}
      testID={session.is_current ? 'login-device-current' : `login-device-${session.token_id}`}
      label={member ? sessionSubtitle(session, now) : label}
      subtitle={member ? memberSubtitle(session, now) : sessionSubtitle(session, now)}
      value={session.is_current ? tr('sessions.thisDevice') : tr('sessions.signOut')}
      valueTone={session.is_current ? 'muted' : 'danger'}
      chevron={false}
      busy={s.busy === session.token_id}
      onPress={session.is_current ? undefined : () => s.askRevokeOne(session, label)}
      accessibilityLabel={session.is_current ? `${label} · ${tr('sessions.thisDevice')}` : tr('sessions.signOutLabel', { name: label })}
    />
  );
  return (
    <>
      <SettingsGroup testID="login-devices-list" footer={footer} footerTone={s.message ? (s.message.ok ? 'accent' : 'danger') : undefined}>
        {shown.flatMap((item, index) => {
          if (item.type === 'session') return [sessionRow(item.session, item.label, false)];
          const gid = `login-devices-group-${groupTestKey(item, index)}`;
          const open = s.expanded.has(item.key);
          const members = visibleSessions(item.sessions, s.groupShowAll.has(item.key));
          return [
            <SettingsRow
              key={item.key}
              testID={gid}
              label={item.label}
              subtitle={sessionSubtitle(item.sessions[0], now)}
              value={tr('sessions.groupCount', { n: item.sessions.length })}
              chevron
              onPress={() => s.toggleGroup(item.key)}
              accessibilityLabel={tr(open ? 'sessions.collapseGroup' : 'sessions.expandGroup', { name: item.label })}
            />,
            ...(open ? members.map(m => sessionRow(m, item.label, true)) : []),
            ...(open && members.length < item.sessions.length
              ? [<SettingsRow key={`${item.key}-all`} label={tr('sessions.showAll', { n: item.sessions.length })} tone="accent" chevron={false} onPress={() => s.showAllInGroup(item.key)} testID={`${gid}-show-all`} />]
              : []),
          ];
        })}
        {!s.showAll && s.items.length > SESSIONS_VISIBLE_DEFAULT ? (
          <SettingsRow label={tr('sessions.showAll', { n: s.items.length })} tone="accent" chevron={false} onPress={() => s.setShowAll(true)} testID="login-devices-show-all" />
        ) : null}
      </SettingsGroup>
      {s.others > 0 ? (
        <SettingsButton variant="destructive" label={tr('sessions.signOutOthers')} busy={s.busy === 'others'} onPress={s.askRevokeOthers} testID="login-devices-revoke-others" />
      ) : s.sessions.length ? (
        <SettingsGroup footer={tr('sessions.onlyThis')} />
      ) : null}
    </>
  );
}

// ── 本地 Hub ─────────────────────────────────────────────────────────────────────────────────
function LocalHubPage({ ctx }: { ctx: PhonePagesCtx }) {
  useTranslation();
  const { localHub, show, localHubBusy: busy } = ctx;
  const a = ctx.localHubActions;
  if (!localHub) return null;
  const state = localHub.state === 'running' || localHub.state === 'running_external' ? tr('settings.copy.25') : localHub.state === 'error' ? tr('settings.copy.26') : tr('settings.copy.27');
  const needsUpgrade = localHub.requiresMigration || (localHub.error ?? '').includes('version mismatch');
  return (
    <>
      <SettingsGroup footer={localHub.error || ctx.profileError || undefined} footerTone="danger" testID="local-hub-settings-card">
        {show('localHub', 'status') ? <SettingsRow label={tr('settings.copy.24')} value={state} valueTone={localHub.state === 'error' ? 'danger' : undefined} /> : null}
        {show('localHub', 'endpoint') ? <SettingsRow label={tr('settings.copy.28')} value={localHub.endpoint} /> : null}
        {show('localHub', 'hubVersion') ? <SettingsRow label={tr('settings.copy.29')} value={localHub.hubVersion} /> : null}
      </SettingsGroup>
      <SettingsGroup footer={ctx.localBackupMessage || tr('settings.copy.97')}>
        {needsUpgrade && show('localHub', 'restart') ? (
          <SettingsRow testID="local-hub-upgrade" label={busy ? tr('settings.copy.30') : tr('settings.copy.186', { v0: localHub.expectedHubVersion ?? tr('settings.copy.31') })} tone="accent" disabled={busy} onPress={a.upgrade} />
        ) : null}
        {show('localHub', 'restart') ? <SettingsRow label={tr('settings.copy.32')} busy={busy} disabled={busy} onPress={a.restart} chevron={false} /> : null}
        {show('localHub', 'stop') ? <SettingsRow label={tr('settings.copy.34')} disabled={busy || localHub.state === 'stopped'} onPress={a.stop} chevron={false} /> : null}
        {show('localHub', 'logs') ? <SettingsRow label={tr('settings.copy.35')} onPress={a.logs} /> : null}
        {show('localHub', 'backup') ? <SettingsRow label={tr('settings.copy.36')} busy={busy} disabled={busy} onPress={a.backup} chevron={false} /> : null}
      </SettingsGroup>
      {show('localHub', 'deleteLocal') ? (
        <>
          <SettingsButton variant="destructive" label={tr('settings.copy.38')} onPress={a.openDelete} testID="settings-danger-zone" />
          <SettingsGroup footer={tr('settings.copy.98')} />
        </>
      ) : null}
    </>
  );
}

// ── 外观 ─────────────────────────────────────────────────────────────────────────────────────
function AppearancePage({ ctx }: { ctx: PhonePagesCtx }) {
  useTranslation();
  const r = uiScale();
  const summary = localizedScaleSummary(r, uiScaleLayoutWide());
  const anyStored = !r.fontIsDefault || !r.densityIsDefault;
  return (
    <>
      {ctx.show('appearance', 'theme') ? (
        <SettingsGroup title={tr('settings.copy.40')} footer={localizedThemeSummary(ctx.themePref, ctx.themeModeNow)} testID="settings-theme-row">
          {THEME_PREFERENCES.map(option => (
            <SettingsChoiceRow
              key={option}
              testID={`settings-theme-${option}`}
              label={settingsText(THEME_PREFERENCE_LABEL[option])}
              selected={ctx.themePref === option}
              onPress={() => {
                if (ctx.themePref === option) return;
                setThemePreference(option);
                void saveThemeMode(option);
              }}
            />
          ))}
        </SettingsGroup>
      ) : null}
      {ctx.show('appearance', 'language') ? <LanguageSettings /> : null}
      {ctx.show('appearance', 'fontSize') ? (
        <SettingsGroup title={tr('settings.copy.99')} footer={[summary.font, summary.osNote].filter(Boolean).join(' · ')} testID="settings-font-size-row">
          {FONT_SIZE_OPTIONS.map(o => (
            // 选「只是默认」的那项 = 显式存下来(折叠/展开不再改它);选已存的那项不动。同宽屏 Segmented。
            <SettingsChoiceRow key={o.key} testID={`settings-font-size-${o.key}`} label={settingsText(o.label)} selected={r.font === o.key} onPress={() => { if (r.font !== o.key || r.fontIsDefault) persistUiScale({ font: o.key }); }} />
          ))}
        </SettingsGroup>
      ) : null}
      {ctx.show('appearance', 'density') ? (
        <SettingsGroup title={tr('settings.copy.100')} footer={tr('settings.copy.192', { v0: summary.density })} testID="settings-density-row">
          {DENSITY_OPTIONS.map(o => (
            <SettingsChoiceRow key={o.key} testID={`settings-density-${o.key}`} label={settingsText(o.label)} selected={r.density === o.key} onPress={() => { if (r.density !== o.key || r.densityIsDefault) persistUiScale({ density: o.key }); }} />
          ))}
        </SettingsGroup>
      ) : null}
      {ctx.show('appearance', 'fontSize') || ctx.show('appearance', 'density') ? (
        <>
          <SettingsGroup title={tr('settings.copy.101')}>
            <SettingsCardContent><UiScalePreview /></SettingsCardContent>
          </SettingsGroup>
          <SettingsButton variant="plain" label={tr('settings.copy.102')} accessibilityLabel={tr('settings.copy.103')} disabled={!anyStored} onPress={() => persistUiScale({ font: null, density: null })} testID="settings-ui-scale-reset" />
        </>
      ) : null}
    </>
  );
}

// ── 通知 ─────────────────────────────────────────────────────────────────────────────────────
function NotificationsPage({ ctx }: { ctx: PhonePagesCtx }) {
  useTranslation();
  const { notify, show, saveNotify } = ctx;
  const permissionOff = ctx.nativeNotify && notify.enabled && ctx.permission && ctx.permission.status !== 'granted';
  const androidRows = show('notifications', 'keepAlive') || show('notifications', 'dndBypass') || show('notifications', 'xiaomiGuide');
  const dndNote = notify.dndBypass && ctx.dndAccess === true ? tr('settings.copy.104') : null;
  return (
    <>
      {show('notifications', 'enabled') ? (
        <SettingsGroup testID="notify-settings-card" footer={tr('settings.copy.105')}>
          <SettingsSwitchRow
            testID="notify-enabled-row"
            label={tr('settings.copy.41')}
            value={notify.enabled}
            onValueChange={value => { saveNotify({ ...notify, enabled: value }); if (value) void ctx.ensurePermission(); }}
          />
          {permissionOff ? <SettingsRow testID="notify-permission-fix" label={tr('settings.copy.106')} tone="danger" value={tr('settings.copy.107')} onPress={() => { void ctx.ensurePermission(); }} /> : null}
        </SettingsGroup>
      ) : null}
      {show('notifications', 'mode') ? (
        <SettingsGroup title={tr('settings.copy.44')} footer={notify.mode === 'new' ? tr('settings.copy.108') : tr('settings.copy.46')} testID="notify-mode-row">
          {([['all', tr('settings.copy.47')], ['new', tr('settings.copy.48')]] as const).map(([mode, label]) => (
            <SettingsChoiceRow key={mode} testID={`notify-mode-${mode}`} label={label} selected={notify.mode === mode} disabled={!notify.enabled} onPress={() => saveNotify({ ...notify, mode })} />
          ))}
        </SettingsGroup>
      ) : null}
      {show('notifications', 'sound') || show('notifications', 'quiet') ? (
        <SettingsGroup footer={notify.quiet.enabled ? tr('settings.copy.187', { v0: notify.quiet.start, v1: notify.quiet.end }) : undefined}>
          {show('notifications', 'sound') ? <SettingsSwitchRow label={tr('settings.copy.49')} value={notify.soundEnabled} onValueChange={ctx.onSoundChange} /> : null}
          {show('notifications', 'quiet') ? <SettingsSwitchRow label={tr('settings.copy.51')} value={notify.quiet.enabled} onValueChange={value => saveNotify({ ...notify, quiet: { ...notify.quiet, enabled: value } })} /> : null}
          {show('notifications', 'quiet') && notify.quiet.enabled ? (
            <SettingsRow testID="notify-quiet-hours" label={tr('settings.copy.109')} value={`${notify.quiet.start} – ${notify.quiet.end}`} onPress={() => ctx.openDetail('quietHours')} />
          ) : null}
        </SettingsGroup>
      ) : null}
      {show('notifications', 'muted') ? (
        <SettingsGroup
          title={tr('settings.copy.57')}
          testID="notify-muted-row"
          footer={ctx.muted.length ? tr('settings.copy.58') : (ctx.nativeNotify ? tr('settings.copy.59') : tr('settings.copy.60'))}
        >
          {ctx.muted.map(alias => (
            <SettingsRow key={alias} label={alias} value={tr('settings.copy.61')} valueTone="accent" chevron={false} onPress={() => ctx.unmute(alias)} accessibilityLabel={tr('settings.copy.188', { v0: alias })} />
          ))}
        </SettingsGroup>
      ) : null}
      {androidRows ? (
        <SettingsGroup
          title={tr('settings.copy.110')}
          footer={[ctx.keepAliveStatus || tr('settings.copy.111'), dndNote].filter(Boolean).join(' ')}
          footerTone={ctx.keepAliveState.error ? 'danger' : undefined}
        >
          {show('notifications', 'keepAlive') ? (
            <SettingsSwitchRow testID="notify-keepalive-row" label={tr('settings.copy.62')} value={notify.keepAlive} disabled={!notify.enabled || !ctx.keepAliveState.available} onValueChange={ctx.onKeepAliveChange} />
          ) : null}
          {show('notifications', 'dndBypass') ? (
            <SettingsSwitchRow testID="notify-dnd-row" label={tr('settings.copy.64')} subtitle={tr('settings.copy.112')} value={notify.dndBypass} disabled={!notify.enabled} onValueChange={ctx.onDndBypassChange} />
          ) : null}
          {show('notifications', 'dndBypass') && notify.dndBypass && ctx.dndAccess === false ? (
            <SettingsRow testID="notify-dnd-grant" label={tr('settings.copy.113')} tone="danger" value={tr('settings.copy.114')} onPress={ctx.openDndAccess} />
          ) : null}
          {show('notifications', 'xiaomiGuide') ? <SettingsRow testID="notify-xiaomi-guide" label={tr('settings.copy.68')} onPress={ctx.openXiaomiGuide} /> : null}
        </SettingsGroup>
      ) : null}
      {show('notifications', 'test') ? (
        <SettingsGroup footer={ctx.testMessage || tr('settings.copy.71')} testID="notify-test-row">
          <SettingsRow label={tr('settings.copy.70')} value={tr('settings.copy.72')} valueTone="accent" chevron={false} onPress={ctx.sendTest} />
        </SettingsGroup>
      ) : null}
      {show('notifications', 'diagnostics') ? (
        <SettingsGroup title={tr('settings.copy.73')} footer={tr('settings.copy.193', { v0: ctx.nativeNotify ? tr('settings.copy.75') : tr('settings.copy.76') })}>
          {ctx.notifyPreview ? null : <SettingsCardContent><NotifyDiagnosticsPanel /></SettingsCardContent>}
        </SettingsGroup>
      ) : null}
    </>
  );
}

// ── 语音输入 ─────────────────────────────────────────────────────────────────────────────────
function VoicePhonePage({ ctx }: { ctx: PhonePagesCtx }) {
  useTranslation();
  // 一个 hook 实例同时服务子页和它的两个三级页:表单改到一半在 API Key ↔ 高级 之间切换不丢。
  const v = useVoiceSettings();
  if (ctx.detail === 'voiceApiKey') return <VoiceApiKeyEditPage v={v} ctx={ctx} />;
  if (ctx.detail === 'voiceAdvanced') return <VoiceAdvancedEditPage v={v} ctx={ctx} />;
  if (v.storage === 'unsupported') return <SettingsGroup testID="voice-settings-unsupported" footer={tr(VOICE_UNSUPPORTED_TEXT)} />;
  const { show } = ctx;
  const { status } = v;
  const modeNote: { text: string; tone?: SettingsTone } = !streamingSupported(v.platform)
    ? { text: tr('settings.copy.115') }
    : v.mode === 'stream' && v.unavailable ? { text: settingsText(STREAM_UNAVAILABLE_HINT), tone: 'accent' }
      : v.mode === 'stream' ? { text: tr('settings.copy.116') }
        : { text: tr('settings.copy.117') };
  const credNote = status.configured && (status.console === 'old' || status.customEndpoint || status.customStreamEndpoint)
    ? `${status.console === 'old' ? tr('settings.copy.194', { v0: status.appId }) : tr('settings.copy.118')}${status.customEndpoint || status.customStreamEndpoint ? tr('settings.copy.119') : ''}`
    : tr('settings.copy.120');
  const t = v.test;
  const testValue = t.kind === 'recording' ? tr('settings.copy.195', { v0: v.secondsLeft }) : t.kind === 'transcribing' ? tr('settings.copy.121') : '';
  const testFooter = (t.kind === 'recording' || t.kind === 'transcribing') && v.interim ? v.interim
    : t.kind === 'done' ? `${t.text ? tr('settings.copy.196', { v0: t.via === 'stream' ? tr('settings.copy.122') : tr('settings.copy.123'), v1: t.text }) : tr('settings.copy.124')}${t.note ? `\n${t.note}` : ''}`
      : t.kind === 'error' ? t.message
        : status.configured ? tr('settings.copy.125') : tr('settings.copy.126');
  return (
    <>
      {show('voice', 'mode') ? (
        <SettingsGroup title={tr('settings.copy.127')} footer={modeNote.text} footerTone={modeNote.tone} testID="voice-mode">
          {v.choices.map(m => (
            <SettingsChoiceRow key={m} testID={`voice-mode-${m}`} label={settingsText(MODE_LABELS[m])} selected={v.mode === m || v.choices.length === 1} onPress={() => v.onPickMode(m)} />
          ))}
        </SettingsGroup>
      ) : null}
      {show('voice', 'credentials') ? (
        <>
          <SettingsGroup title={tr('settings.copy.128')} footer={credNote}>
            <SettingsRow
              testID="voice-api-key-row"
              label="API Key"
              busy={!v.loaded}
              value={v.loaded ? (status.configured ? localizedVoiceStatus(status).replace(' ✓', '') : tr('settings.copy.129')) : undefined}
              valueTone={status.configured ? 'accent' : undefined}
              onPress={() => ctx.openDetail('voiceApiKey')}
            />
          </SettingsGroup>
          <SettingsGroup title={tr('settings.copy.130')} footer={tr(CONSOLE_HELP)}>
            <SettingsRow testID="voice-console-link" label={tr('settings.copy.131')} external onPress={() => { void openExternal(VOLC_CONSOLE_URL).catch(() => {}); }} />
            <SettingsRow testID="voice-advanced-toggle" label={tr('settings.copy.132')} onPress={() => ctx.openDetail('voiceAdvanced')} />
          </SettingsGroup>
        </>
      ) : null}
      {/* 麦克风选择只在 webview 里有(窄的桌面窗口);手机走原生录音,没有这一栏。 */}
      {/* phone = 微信设置行 + 底部面板,整组(行 · 电平条 · footer 说明)由 MicDeviceSetting 自己画。 */}
      {show('voice', 'mic') && Platform.OS === 'web' ? <MicDeviceSetting phone /> : null}
      {show('voice', 'test') ? (
        <SettingsGroup footer={testFooter} footerTone={t.kind === 'error' ? 'danger' : undefined} testID="voice-test-group">
          <SettingsRow testID="voice-test" label={tr('settings.copy.133')} value={testValue} busy={v.testBusy} disabled={v.testBusy || !status.configured} onPress={() => void v.onTest()} />
        </SettingsGroup>
      ) : null}
    </>
  );
}

// ── 快捷键(窄的桌面窗口)─────────────────────────────────────────────────────────────────────
function ShortcutsPage({ ctx }: { ctx: PhonePagesCtx }) {
  useTranslation();
  return (
    <SettingsGroup testID="settings-section-shortcuts">
      <SettingsCardContent>{ctx.renderShortcuts()}</SettingsCardContent>
    </SettingsGroup>
  );
}

// ── 关于 ─────────────────────────────────────────────────────────────────────────────────────
function AboutPage({ ctx }: { ctx: PhonePagesCtx }) {
  useTranslation();
  const lastFatal = useLastFatalReport();
  const view = ctx.updateView;
  const tone: SettingsTone | undefined = view.tone === 'danger' ? 'danger' : view.tone === 'accent' ? 'accent' : undefined;
  return (
    <>
    <BrandMark size={48} />
    <SettingsGroup footer={view.detail} testID="settings-about">
      {ctx.show('about', 'version') ? <SettingsRow testID="settings-version-row" label={tr('settings.copy.77')} value={`v${APP_VERSION}`} onPress={ctx.onVersionTap} /> : null}
      {ctx.show('about', 'update') ? (
        <SettingsRow
          testID="settings-update-row"
          label={tr('settings.copy.78')}
          value={view.label}
          valueTone={tone}
          busy={view.busy}
          chevron={view.actionable && !view.busy}
          onPress={view.actionable ? ctx.onCheckUpdate : undefined}
        />
      ) : null}
      {/* 更新日志:三级页(ChangelogScreen.tsx 的手机版,SettingsScreen 在滚动区外画它 —— 它自己滚、底部钉按钮条)。 */}
      {ctx.show('about', 'changelog') ? (
        <SettingsRow testID="settings-changelog-row" label={tr('changelog.title')} chevron onPress={() => ctx.openDetail('changelog')} />
      ) : null}
      {lastFatal && ctx.show('about', 'lastCrash') ? (
        <SettingsRow testID="settings-last-crash-row" label={tr('fatal.copyRow')} value={fatalSummary(lastFatal, 24)} onPress={() => { void copyLastFatal(lastFatal); }} />
      ) : null}
    </SettingsGroup>
    {ctx.showPooledHttp ? (
      <SettingsGroup title={tr('settings.copy.281')} testID="settings-diagnostics-group">
        <SettingsSwitchRow testID="settings-pooled-http-row" label={tr('settings.copy.277')} subtitle={tr('settings.copy.278')} value={ctx.pooledHttp} onValueChange={ctx.onPooledHttpChange} />
      </SettingsGroup>
    ) : null}
    </>
  );
}
