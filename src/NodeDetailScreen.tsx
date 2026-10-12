// Per-node detail screen — issue #8 row 4 (V1 health card only).
//
// SCOPE (per 通信龙 71ee862d + d349e514 V1 decision):
//   Health card: alias + status chip + updated_at + current task preview +
//   team + server + avatar. V2 progressively adds masked config facts and
//   lifecycle controls when GET /api/nodes supplies an authoritative node_id.
//   Session-only aliases remain read-only. Logs stay in the Server workspace.
//
// TASK vs NODE distinction (author-厘清 → 通信龙 5a8783bd 认为镜像镜镜):
//   task = one dispatched task's status/result/reply
//     (that's demo马's TaskDetailScreen in row 5 — NOT this file)
//   node = one agent's health/config/log stream
//     (that's this file for the health slice; config = V2, log = row 6)
//
// HARD REQUIREMENTS from dispatch (do NOT change without lead sign):
//   1. Avatar: use src/lib/avatars.ts (djb2 pool). Do NOT roll own hash —
//      the h*31 in AliasAvatar is the letter-pill color palette, a
//      DIFFERENT hash from the pool pick (author corrected lead on this
//      once already; the memo-vs-source hash confusion is the exact
//      trap this file avoids by delegating to AliasAvatar).
//   2. Styles: `import { styles } from './app-styles'` — do NOT
//      destructure, do NOT copy. See app-styles.ts header comment
//      explaining ES-module live binding: styles is `export let`,
//      onThemeChange reassigns the whole object, importers get the new
//      one via live binding. Any local copy freezes on first paint's
//      colors — screen "works but wrong color" after theme switch,
//      undetectable in a single screen review.
//   3. Three visible states — loading, empty (session not found in
//      fleet), error (fetch failed) — separated on screen, not merged
//      into a blank canvas.
//
// ENTRY: the agent row menu's 「节点详情」 (long-press on touch, right-click on
//   desktop — AgentRowMenu.tsx; before 2026-09-26 long-press opened this
//   directly). Existing tap → chat is a high-frequency path, preserved unchanged.
//
// WIRING: App.tsx adds one route case + one prop. Coordinated with
//   demo马's Tasks tab that also touches App.tsx (lead-mediated order:
//   this PR lands first, demo马 wires after).
//
// V1 uses ONLY `Session` fields already exposed by fetchStatus
// (alias / status / agent / task / server / updated_at). No new API
// fetcher. If the alias vanishes from the fleet between refreshes, we
// render "empty" not "error" — the caller (App.tsx router) can offer a
// back navigation. Missing field values render "—" so the user can tell
// "field absent" apart from "screen broken" (lead 71ee862d
// verification bullet).

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import ModalKeyboardAvoider from './ModalKeyboardAvoider';
import NodeAdoptionControls from './NodeAdoptionControls';
import NodeControlCard from './NodeControlCard';
import { nodeControlView } from './node-control-access';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-backend-pending';
import { adoptionError, isAdopted } from './node-adoption';
import { layoutGeneration, releaseOnUnmount, takeHandoff } from './layout-handoff';
import { takeNodeSectionRequest } from './node-section-request';
import { ActivityIndicator, BackHandler, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StatusBar, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';

import AliasAvatar from './AliasAvatar';
import DegradedBadge from './DegradedBadge';
import { nodeDegraded } from './node-degraded';
import AvatarEditSection from './AvatarEditSection';
import { teamOf } from './agents-list';
import { fetchHostSupervisors, fetchHubNodes, fetchNodeConfig, fetchNodeStatus, runNodeLifecycleAction, type HostSupervisorDaemon, type HubConfig, type HubNode, type NodeLifecycleAction, type Session } from './api';
import { styles } from './app-styles';
import { colors, onThemeChange, radius, spacing, statusColor, type as typeScale, weight } from './theme';
import { popoutHeaderChrome, type PopoutChrome } from './window-shell';
import { ds } from './ui-scale';
import { formatTime } from './time';
import { usePoll } from './usePoll';
import NodeTasksSection from './NodeTasksSection';
import { nodeActionVisual, type NodeActionTone } from './node-action-visual';
import { nodeInfoFacts, type NodeInfoFact } from './node-info';
import { nodeIdentityNotice, taskSectionTitle } from './node-identity';
import NodeRulesSection from './NodeRulesSection';
import { rulesFileTarget } from './node-rules';
import NodeModelSection from './NodeModelSection';
import NodeCodexExecutionSection from './NodeCodexExecutionSection';
import NodeCodexReasoningSection from './NodeCodexReasoningSection';
import { NodeCodexProviderSection } from './CodexProviderFields';
import NodeDaemonProviderSection from './NodeDaemonProviderSection';
import { daemonProviderNodeRuntime } from './node-provider-target';
import { isCodexRuntime } from './provider-create-options';
import NodeSkillsSection from './NodeSkillsSection';
import ScopedSecretsSection from './ScopedSecretsSection';
import NodeFilesSection from './NodeFilesSection';
import NodeSchedulesSection from './NodeSchedulesSection';
import NodeLogsSection from './NodeLogsSection';
import NodePermissionSection from './NodePermissionSection';
import { canShowPermissionSection } from './node-permission-model';
import { pointerUi } from './pointer-ui';
import type { ScheduleOpenRequest } from './node-schedules';
import { keyboardAvoidEnabled, useKeyboardVisible } from './keyboard-visibility';
import { useScreenKeyboardInset } from './screen-keyboard-inset';
import { filesTreeMode, nodePageColumnMaxWidth } from './node-files-tree';
import { NODE_PAGE_COMPACT_WIDTH, NODE_SECTIONS, factText, headerChips, leaveNeedsConfirm, modelSectionFacts, nodePageChrome, nodePageContentWidth, nodePageScrolls, overviewFactColumns, resolveActiveSection, splitOverviewFacts, visibleNodeSections, type NodeSectionKey } from './node-page-model';
import { useModalSafePadding } from './safe-area-runtime';
import { withBasePadding } from './modal-safe-area';
import { PANE_BACK_TEST_ID, paneShowsBack } from './pane-header';
import { elevated } from './elevation';
import { actionMessageTone, dangerActions, START_OUTCOME_MESSAGE, START_SUBMITTED_MESSAGE, START_WAIT_MS, startErrorMessage, startWatchOutcome } from './node-danger-actions';
import CloneNodeDialog, { CloneNodeButton } from './CloneNodeDialog';
import { cloneAvailability, cloneNoticeMessage } from './node-clone';
import { isHostSupervisorNode } from './daemon-node';
import './i18n-node-clone';

// board #694 —— 只读页(节点信息)唯一放开的两个变更:概览卡片里的重启 / 停止。删除 / 启动仍只在节点详情。
const OVERVIEW_ACTIONS: readonly NodeLifecycleAction[] = ['restart_node', 'stop_node'];
const POLL_MS = 10_000; // same cadence as AgentsScreen — hub-friendly, felt-live

function NodeActionButton({
  label,
  tone,
  onPress,
  disabled,
  disabledHint,
}: {
  label: string;
  tone: NodeActionTone;
  onPress: () => void;
  /** board #586 —— 置灰原因(读屏用;页面上另有一行可见文字)。 */
  disabledHint?: string;
  /** app#196 —— 置灰而不是隐藏（Vincent 定）：隐藏会让人以为功能不存在，
   *  置灰 + 底下一句说明能告诉他为什么、以及替代做法。 */
  disabled?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const visual = nodeActionVisual(colors, tone);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      accessibilityHint={disabled ? (disabledHint || '此节点不支持远程生命周期操作') : tone === 'danger' ? '需要输入节点别名再次确认' : '打开确认窗口'}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [
        localStyles.actionButton,
        { borderColor: visual.borderColor, backgroundColor: visual.backgroundColor },
        !disabled && (hovered || focused) && { backgroundColor: colors.inputBg },
        !disabled && focused && { borderColor: visual.textColor },
        !disabled && pressed && localStyles.actionButtonPressed,
        disabled && { opacity: 0.35 },
      ]}
    >
      <Text style={[localStyles.actionButtonText, { color: visual.textColor }]}>{label}</Text>
    </Pressable>
  );
}

/** 概览网格里的一格:小号灰色标签在上,值在下;空值显示「—」(分得清「没上报」和「坏了」)。
 *  wrap 的格子(session-id)不截成两行省略:整段留在格子里,桌面可划选,手机换行可读。 */
function FactCell({ fact, columns }: { fact: NodeInfoFact; columns: number }) {
  return (
    <View style={{ width: `${100 / columns}%`, paddingVertical: spacing.sm, paddingRight: spacing.lg, gap: 2 }}>
      <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>{fact.label}</Text>
      <Text
        testID={fact.testID}
        style={[
          { color: colors.text, fontSize: typeScale.body },
          fact.wrap ? ({ overflowWrap: 'anywhere', wordBreak: 'break-all' } as any) : null,
        ]}
        selectable
        // 0 is not "unlimited" on web / Android (line-clamp 0 hides the text). Omit the cap instead.
        {...(fact.wrap ? {} : { numberOfLines: 2 })}
      >{factText(fact.value)}</Text>
    </View>
  );
}

/** 分区标题 + 一句说明;分区之间不画框,靠留白和标题分层(0.2.85 极简语言)。
 *  action:标题行右端的一个按钮(定时任务的「＋ 新建」);标题本身的位置不因它而变。 */
function SectionTitle({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <View style={{ marginBottom: spacing.md, gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
        <Text style={{ color: colors.text, fontSize: typeScale.title, fontWeight: weight.strong }} testID="node-section-title">{title}</Text>
        {action}
      </View>
      {hint ? <Text style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }}>{hint}</Text> : null}
    </View>
  );
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; session: Session }
  | { kind: 'not_found' } // alias no longer in the fleet
  | { kind: 'error' };    // fetch itself failed (network / auth / server)

export default function NodeDetailScreen({
  cfg,
  alias,
  onBack,
  readOnly = false,
  layoutWidth,
  touch = false,
  desktop = false,
  onOpenScheduled,
  windowChrome = null,
}: {
  cfg: HubConfig;
  alias: string;
  onBack: () => void;
  readOnly?: boolean;
  /** Android two-pane: the width this screen actually gets (window minus the list).
   *  Omitted everywhere else, where the window width decides as before. */
  layoutWidth?: number;
  /** Android two-pane: finger-sized section rail rows (≥ 48 dp) when the rail shows. */
  touch?: boolean;
  /** Tauri desktop workspace: the rail / sidebar / list select this page — no phone back (pane-header.ts). */
  desktop?: boolean;
  /** 「定时任务」分区:点一行 / 「＋ 新建」→ 定时任务页落在那一条 / 打开预填了这个节点的新建表单。
   *  没有(独立聊天窗口)时分区只读:行不可点,不画新建。 */
  onOpenScheduled?: (request: ScheduleOpenRequest) => void;
  /** 分离聊天窗:页头兼当标题栏(window-shell.ts popoutChatChrome)。其他地方不传。 */
  windowChrome?: PopoutChrome;
}) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [node, setNode] = useState<HubNode | null>(null);
  const [nodeListState, setNodeListState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const [pendingAction, setPendingAction] = useState<NodeLifecycleAction | null>(null);
  const [confirmAlias, setConfirmAlias] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  // board #585 —— 提交启动后等节点上线(只看页面本来就在轮询的节点 / 会话状态,不另起轮询)。
  const [startWatch, setStartWatch] = useState<{ deadline: number; sawStarting: boolean } | null>(null);
  const [activeSection, setActiveSection] = useState<NodeSectionKey>('overview');
  // 「定时任务」分区标题上的「＋ 新建」:每按一次加一,NodeSchedulesSection 就地打开预填了这个节点的编辑器。
  const [scheduleCreateSeq, setScheduleCreateSeq] = useState(0);
  // Fold/unfold remounts this screen; keep the selected tab (概览/规则文件/技能/…)
  // across that remount only (see layout-handoff.ts).
  const sectionHandoffKey = `nodeSection:${readOnly ? 'info' : 'detail'}:${cfg.profileId ?? cfg.serverUrl}:${alias}`;
  const activeSectionRef = useRef(activeSection);
  activeSectionRef.current = activeSection;
  useLayoutEffect(() => {
    const mountedGeneration = layoutGeneration();
    const handed = takeHandoff<NodeSectionKey>(sectionHandoffKey);
    // 聊天信息里点的是某个分区(node-section-request.ts):优先于折叠屏交接。
    const requested = readOnly ? takeNodeSectionRequest(sectionHandoffKey) : undefined;
    if (requested || handed) setActiveSection((requested || handed)!);
    return () => releaseOnUnmount(sectionHandoffKey, activeSectionRef.current, mountedGeneration);
  }, [sectionHandoffKey]);
  const [showMoreFacts, setShowMoreFacts] = useState(false);
  // 规则文件草稿没保存时,切分区 / 返回之前先问(草稿只活在 NodeRulesSection 里,一卸载就没了)。
  const [rulesDirty, setRulesDirty] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<null | (() => void)>(null);
  // 软键盘弹起(原生端):规则分区里收起头部卡片,把高度让给编辑框;web / 桌面没有这些事件,恒 false。
  const keyboardVisible = useKeyboardVisible(Keyboard, Platform.OS);
  // iOS:键盘避让按窗口坐标量(#547,同 ChatScreen;RN 的 KAV 在导航壳里少算一个顶部安全区)。
  const iosKeyboard = useScreenKeyboardInset();
  // 返回(页头 ‹ 和 Android 系统返回键)也要过确认。needConfirm 在下面算(要先有 section),这里用 ref 读最新值。
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const confirmLeaveRef = useRef(false);
  const guardedBack = () => { if (confirmLeaveRef.current) setPendingLeave(() => onBackRef.current); else onBackRef.current(); };
  useEffect(() => {
    if (!rulesDirty) return;
    // 只在有草稿时挂:它比 App.tsx 的返回处理晚注册 ⇒ 先被调用(BackHandler 后注册先调)。
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!confirmLeaveRef.current) return false;
      setPendingLeave(() => onBackRef.current);
      return true;
    });
    return () => sub.remove();
  }, [rulesDirty]);
  const { width: windowWidth } = useWindowDimensions();
  // The two confirm dialogs below are Modals = their own window (safe-area rule 2). The page itself
  // gets NO inset: it renders inside the root / a pane that already applied it (rule 1).
  const dialogSafe = useModalSafePadding('fullScreen');
  const width = layoutWidth ?? windowWidth;
  const compact = width < NODE_PAGE_COMPACT_WIDTH;
  // 右栏实测宽度(左侧还有服务器侧栏/分区栏,窗口宽≠右栏宽);没量到之前按窗口估。
  const [paneWidth, setPaneWidth] = useState(0);
  const contentPadding = compact ? spacing.lg : spacing.xl;
  const factColumns = compact ? 1 : overviewFactColumns(nodePageContentWidth(paneWidth || width, contentPadding));
  // 项目文件夹右侧文件树(node-files-tree.ts filesTreeMode):按内容列**封顶前**能拿到的宽度决定并排 / 抽屉;
  // 手机单栏(窄且不是安卓双栏)不挂,手机布局不变。右栏没量到之前按抽屉算,不先挂出来再收回去。
  const filesTree = filesTreeMode({ contentWidth: paneWidth > 0 ? paneWidth - 2 * contentPadding : 0, phone: compact && layoutWidth === undefined });
  // Force re-render on theme switch. `styles` reassigns via live binding
  // (see app-styles.ts header) but child style props are captured at
  // render — a manual bump is how the sibling screens do it too.
  const [, setThemeTick] = useState(0);
  // board #694 —— 节点操作卡片 / 指路那一行走 i18n:切语言时这一页也要重画。
  useTranslation();
  useEffect(() => onThemeChange(() => setThemeTick(t => t + 1)), []);

  const load = useCallback(async () => {
    // 节点行和状态行互不依赖:一起发,别等状态回来再发节点(跨太平洋多一个往返)。
    // 拉取失败时**保留上一次的 node**:否则一次超时就让操作区/规则区整块消失,
    // 文案还会说「没有权威节点 ID」,和上面显示的 ID 自相矛盾(Vincent 09-03 截图)。
    void fetchHubNodes(cfg)
      .then(result => {
        const list = result.nodes ?? [];
        setNode(list.find(candidate => candidate.alias === alias) ?? null);
        setKnownNames(list.flatMap(item => [item.alias, item.node_name ?? ''].map(value => value.trim()).filter(Boolean)));
        setNodeListState('loaded');
      })
      .catch(() => setNodeListState('failed'));
    try {
      const data = await fetchNodeStatus(cfg, alias);
      const found = (data.sessions ?? []).find(s => s.alias === alias);
      if (found) setState({ kind: 'ready', session: found });
      else setState(prev => (prev.kind === 'ready' ? prev : { kind: 'not_found' }));
      // If we previously had the session and it's now gone, we keep the
      // last-known snapshot rather than flashing "not_found" — the alias
      // may have gone offline momentarily. `not_found` only wins when we
      // never had it (initial fetch missed it).
    } catch {
      setState(prev => (prev.kind === 'ready' ? prev : { kind: 'error' }));
      // Same "keep last-known" policy on fetch error, mirroring
      // AgentsScreen's behavior.
    }
  }, [cfg, alias]);

  // Foreground-only 10s polling. usePoll pauses in background and
  // instant-refreshes on resume — same hook AgentsScreen uses. It also runs
  // once at mount, so no separate mount effect (that one fetched everything twice).
  usePoll(load, POLL_MS, [load]);

  // board #586 —— 手动启动的节点(lifecycle_controllable=false)重启不需要 daemon:节点上报了
  // config_update_capable 就会自己 exit 75 重启。这个能力只在 GET /api/nodes/:id/config 里有
  // (/api/nodes 的列表把 config_snapshot 去掉了),所以进「危险操作」时单独读一次。
  // undefined = 读取中,null = Hub 没这个接口或读失败(按不支持说)。
  const [configUpdateCapable, setConfigUpdateCapable] = useState<boolean | null | undefined>(undefined);
  const handStartedNodeId = node?.lifecycle_controllable === false ? node.node_id : null;
  // board #694 —— 「概览」里也画重启 / 停止(节点操作卡片),同样要知道能不能自己重启。
  const onDangerTab = activeSection === 'danger' || activeSection === 'overview';
  useEffect(() => {
    setConfigUpdateCapable(undefined);
    if (!handStartedNodeId || !onDangerTab) return;
    let live = true;
    fetchNodeConfig(cfg, handStartedNodeId)
      .then(c => { if (live) setConfigUpdateCapable(c ? c.config_update_capable : null); })
      .catch(() => { if (live) setConfigUpdateCapable(null); });
    return () => { live = false; };
  }, [cfg, handStartedNodeId, onDangerTab]);

  // board #694 —— 手动启动的节点:这台机器上有没有能收编它的 daemon(决定「交给守护进程管理」还是「还没有守护进程」)。
  // undefined = 读取中 / 读失败 ⇒ 卡片不下结论。只在概览、且节点是手动启动时读一次。
  const [hostDaemons, setHostDaemons] = useState<HostSupervisorDaemon[] | undefined>(undefined);
  const [adoptOpen, setAdoptOpen] = useState(false);
  const [knownNames, setKnownNames] = useState<string[]>([]);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneNotice, setCloneNotice] = useState<{ demo: boolean; pending: boolean; text: string } | null>(null);
  const onOverviewTab = activeSection === 'overview';
  useEffect(() => {
    setHostDaemons(undefined);
    if (!handStartedNodeId || !onOverviewTab) return;
    let live = true;
    fetchHostSupervisors(cfg)
      .then(r => { if (live) setHostDaemons(r.ok ? r.daemons : undefined); })
      .catch(() => { if (live) setHostDaemons(undefined); });
    return () => { live = false; };
  }, [cfg, handStartedNodeId, onOverviewTab]);

  // board #585 —— 启动请求提交后:节点上线 / daemon 报失败 / 2 分钟没动静,各说一句。
  const watchOnline = state.kind === 'ready' && state.session.status !== 'offline';
  const watchLifecycle = node?.lifecycle_state;
  useEffect(() => {
    if (!startWatch) return;
    const outcome = startWatchOutcome({ online: watchOnline, lifecycleState: watchLifecycle, sawStarting: startWatch.sawStarting, now: Date.now(), deadline: startWatch.deadline });
    if (outcome === 'waiting') {
      if (watchLifecycle === 'starting' && !startWatch.sawStarting) { setStartWatch({ ...startWatch, sawStarting: true }); return; }
      const timer = setTimeout(() => setStartWatch(w => (w ? { ...w } : w)), Math.max(0, startWatch.deadline - Date.now()) + 50);
      return () => clearTimeout(timer);
    }
    setStartWatch(null);
    setActionMessage(START_OUTCOME_MESSAGE[outcome]);
  }, [startWatch, watchOnline, watchLifecycle]);

  // 分离聊天窗里的「节点信息」:页头同样兼当标题栏(见 window-shell.ts popoutChatChrome)。
  const headerChrome = popoutHeaderChrome(windowChrome, spacing.lg);
  const header = (
    <View
      testID="screen-header"
      {...({ dataSet: headerChrome.dataSet } as any)}
      style={[{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        gap: spacing.md,
      }, headerChrome.style]}
    >
      {paneShowsBack(desktop) ? (
        <Pressable onPress={guardedBack} testID={PANE_BACK_TEST_ID} hitSlop={12} accessibilityRole="button" accessibilityLabel="返回">
          <Text style={{ color: colors.accent, fontSize: 28 }}>‹</Text>
        </Pressable>
      ) : null}
      <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>{readOnly ? '节点信息' : '节点详情'}</Text>
    </View>
  );

  if (state.kind === 'loading') {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    );
  }

  if (state.kind === 'error') {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.center}>
          <Text style={styles.errorTitle}>加载失败</Text>
          <Text style={styles.errorHint}>网络不稳定或 Hub 未响应</Text>
          <Pressable
            style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.7 }]}
            onPress={() => {
              setState({ kind: 'loading' });
              void load();
            }}
          >
            <Text style={styles.retryBtnText}>重试</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (state.kind === 'not_found') {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.center}>
          <Text style={styles.errorTitle}>找不到节点</Text>
          <Text style={styles.errorHint}>
            别名 <Text style={{ color: colors.text }}>{alias}</Text> 已不在当前网络的会话列表里
          </Text>
        </View>
      </View>
    );
  }

  const s = state.session;
  const rulesTarget = rulesFileTarget({ readOnly, node, session: s });
  const online = s.status !== 'offline';
  const danger = dangerActions({ lifecycleControllable: node?.lifecycle_controllable, online, configUpdateCapable, lifecycleState: node?.lifecycle_state, alias });
  const control = node ? nodeControlView({ node, danger, online, hostname: node.hostname ?? s.hostname, daemons: hostDaemons, networkId: cfg.networkId }) : null;
  const chipColor = statusColor(s.status, online);
  const team = teamOf(s.alias);
  const executeLifecycle = async () => {
    if (!pendingAction || !node || actionBusy) return;
    setActionBusy(true);
    setActionMessage('');
    const result = await runNodeLifecycleAction(cfg, pendingAction, node);
    setActionBusy(false);
    if (!result.ok) {
      setActionMessage(result.error === 'node_busy_in_flight'
        ? `节点仍有 ${result.in_flight_count ?? 1} 个处理中任务，未强制操作`
        : ['adopted_restart_requires_daemon', 'lifecycle_identity_unavailable'].includes(result.error) ? adoptionError(result.error)
        : pendingAction === 'start_node' ? startErrorMessage(result.error) : result.error);
      return;
    }
    setStartWatch(pendingAction === 'start_node' ? { deadline: Date.now() + START_WAIT_MS, sawStarting: false } : null);
    setActionMessage(pendingAction === 'start_node' ? START_SUBMITTED_MESSAGE : pendingAction === 'restart_node' ? '重启请求已提交' : pendingAction === 'stop_node' ? '停止请求已提交' : '删除请求已提交');
    setPendingAction(null);
    setConfirmAlias('');
    void load();
  };

  const facts: NodeInfoFact[] = [
    ...nodeInfoFacts(s, node, cfg.serverUrl),
    { label: '所属 team', value: team },
    { label: '最后更新', value: formatTime(s.updated_at) },
    { label: '生命周期', value: node?.lifecycle_state },
    { label: '配置版本', value: typeof node?.config_revision === 'number' ? String(node.config_revision) : undefined },
  ];
  const { primary, secondary } = splitOverviewFacts(facts);
  const chips = headerChips(facts);
  const skillsCapable = (s as Session & { skills_capable?: boolean }).skills_capable === true;
  const visibleSections = visibleNodeSections({ readOnly, hasRulesTarget: !!rulesTarget, skillsCapable, permissionsAllowed: canShowPermissionSection(node) });
  const section = resolveActiveSection(activeSection, visibleSections);
  const sectionMeta = NODE_SECTIONS.filter(item => visibleSections.includes(item.key));
  const needConfirm = leaveNeedsConfirm({ section, rulesDirty });
  confirmLeaveRef.current = needConfirm;
  // 要离开规则分区 / 这一页:有没保存的草稿就先弹确认,确认了才真的走。
  const guardLeave = (go: () => void) => { if (needConfirm) setPendingLeave(() => go); else go(); };
  const chrome = nodePageChrome({ section, keyboardVisible });
  const pageScrolls = nodePageScrolls(section);
  const runtimeFacts = modelSectionFacts(facts);

  // 头部卡片:头像 + 名字 + 在线状态 + 运行时/模型/版本/主机小标签。常驻,切分区不动。
  const headerCard = (
    <View style={[localStyles.headerCard, { borderBottomColor: colors.border }]}>
      <AliasAvatar alias={s.alias} size={compact ? 44 : 56} />
      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
          <Text style={{ color: colors.text, fontSize: typeScale.heading, fontWeight: weight.strong }} selectable numberOfLines={1}>
            {s.alias}
          </Text>
          <View style={[localStyles.statusPill, { borderColor: colors.border }]}>
            <View style={{ width: 7, height: 7, borderRadius: radius.pill, backgroundColor: chipColor }} />
            <Text style={{ color: colors.textSecondary, fontSize: typeScale.small }}>{online ? s.status : 'offline'}</Text>
          </View>
          {/* #460 降级:原因 + 修法在提示条里(悬停 / 点按)。 */}
          <DegradedBadge info={nodeDegraded(s)} testID="node-degraded" size="header" />
        </View>
        {chips.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {chips.map(chip => (
              <View key={chip} style={[localStyles.chip, { backgroundColor: colors.subtleFill }]}>
                <Text style={{ color: colors.textSecondary, fontSize: typeScale.small }} numberOfLines={1}>{chip}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );

  // 分区导航:宽窗左栏(同设置页),窄窗顶部一排分段标签。
  const nav = (
    <View style={compact ? [localStyles.tabsWrap, { borderBottomColor: colors.border }] : [localStyles.rail, { borderRightColor: colors.border }]} testID="node-section-nav">
      <ScrollView horizontal={compact} showsHorizontalScrollIndicator={false} contentContainerStyle={compact ? localStyles.tabsRow : localStyles.railList}>
        {sectionMeta.map(item => {
          const isActive = item.key === section;
          const danger = item.key === 'danger';
          return (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={item.label}
              onPress={() => { if (item.key !== section) guardLeave(() => setActiveSection(item.key)); }}
              style={({ pressed, hovered }: any) => [
                compact ? localStyles.tab : localStyles.railItem,
                touch && (compact ? localStyles.tabTouch : localStyles.railItemTouch),
                (hovered || pressed) && { backgroundColor: colors.rowHover },
                isActive && { backgroundColor: colors.rowActive },
              ]}
            >
              {!compact ? <Ionicons name={item.icon as any} size={16} color={danger ? colors.failed : isActive ? colors.text : colors.textMuted} /> : null}
              <Text style={{ color: danger ? colors.failed : isActive ? colors.text : colors.textSecondary, fontSize: typeScale.body, fontWeight: isActive ? weight.strong : weight.regular }} numberOfLines={1}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  const card = { backgroundColor: colors.card, borderRadius: radius.surface, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm } as const;
  const cloneGate = cloneAvailability({
    pending: nodeListState === 'loading',
    nodeId: node?.node_id,
    daemonNodeId: node?.lifecycle_daemon_node_id,
    hostSupervisor: node ? isHostSupervisorNode(node) : false,
  });
  const cloneSource = node?.node_id && node.lifecycle_daemon_node_id && !isHostSupervisorNode(node)
    ? { nodeId: node.node_id, alias: node.alias, name: node.node_name?.trim() || node.alias, daemonNodeId: node.lifecycle_daemon_node_id }
    : null;

  const content = (() => {
    if (section === 'overview') return (
      <View style={{ gap: spacing.xl }}>
        <View>
          <SectionTitle title="概览" />
          <View style={[card, { flexDirection: 'row', flexWrap: 'wrap' }]}>
            {primary.map(fact => <FactCell key={fact.label} fact={fact} columns={factColumns} />)}
          </View>
          {secondary.length ? (
            <View style={{ marginTop: spacing.sm }}>
              <Pressable onPress={() => setShowMoreFacts(v => !v)} accessibilityRole="button" accessibilityState={{ expanded: showMoreFacts }} hitSlop={8} style={{ paddingVertical: spacing.xs }}>
                <Text style={{ color: colors.accent, fontSize: typeScale.small, fontWeight: weight.strong }}>{showMoreFacts ? '收起更多信息' : `更多信息(${secondary.length})`}</Text>
              </Pressable>
              {showMoreFacts ? (
                <View style={[card, { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs }]}>
                  {secondary.map(fact => <FactCell key={fact.label} fact={fact} columns={factColumns} />)}
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
        {/* board #694 —— 重启 / 停止放在主人看的地方:概览。置灰也画出来,底下一句原因 + 下一步(收编 / 没有 daemon)。
            只读页(聊天里的「节点信息」)也在:重启 / 停止是主人在这里要的;删除 / 启动仍只在节点详情的「危险操作」里。 */}
        {control ? (
          <View>
            <SectionTitle title={t('nodeControl.title')} />
            <NodeControlCard
              view={control}
              compact={compact}
              onRestart={() => setPendingAction('restart_node')}
              onStop={() => setPendingAction('stop_node')}
              onAdopt={() => setAdoptOpen(true)}
              adoptOpen={adoptOpen && control.mode !== 'managed'}
              adoptSlot={node ? <NodeAdoptionControls key={JSON.stringify(['overview', cfg.serverUrl, cfg.token, cfg.networkId, node.node_id])} cfg={cfg} node={node} online={online} initialDialog="adopt" onRefresh={() => { void load(); }} /> : null}
              message={actionMessage && section === 'overview' ? (
                <Text testID="node-control-action-message" style={{ color: { ok: colors.running, warn: colors.blocked, error: colors.failed }[actionMessageTone(actionMessage)], fontSize: typeScale.small, lineHeight: 18 }}>{actionMessage}</Text>
              ) : null}
            />
          </View>
        ) : null}
        {!readOnly ? (
          <View>
            <SectionTitle title={t('nodeClone.title')} hint={t('nodeClone.sectionHint')} />
            <View testID="node-clone-card" style={[card, { paddingVertical: spacing.md, gap: spacing.sm }]}>
              <Text style={{ color: colors.textSecondary, fontSize: typeScale.body, lineHeight: 20 }}>{t('nodeClone.cardBody')}</Text>
              <View style={{ flexDirection: 'row' }}>
                <CloneNodeButton testID="node-clone-open" disabled={!cloneGate.enabled} onPress={() => { setCloneNotice(null); setCloneOpen(true); }} />
              </View>
              {cloneGate.reasonKey ? (
                <Text testID="node-clone-reason" style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }}>{t(cloneGate.reasonKey)}</Text>
              ) : null}
              {cloneNotice ? (
                <Text testID="node-clone-message" style={{ color: cloneNotice.demo || cloneNotice.pending ? colors.blocked : colors.running, fontSize: typeScale.small, lineHeight: 18 }}>{cloneNotice.text}</Text>
              ) : null}
            </View>
          </View>
        ) : null}
        <View>
          <SectionTitle title={taskSectionTitle(s.status)} />
          <View style={[card, { paddingVertical: spacing.md }]}>
            {s.task && s.task.trim().length > 0 ? (
              <Text style={{ color: colors.text, fontSize: typeScale.body, lineHeight: 20 }} selectable>{s.task}</Text>
            ) : (
              <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>节点还没有上报任务。完整记录见「任务」分区。</Text>
            )}
          </View>
        </View>
        {/* R2 avatar editor (pool picker + custom URL; pre-disclosure for session-only) */}
        {!readOnly ? <AvatarEditSection cfg={cfg} alias={s.alias} /> : null}
      </View>
    );
    if (section === 'model') return (
      <View>
        <SectionTitle title="模型与运行时" hint={readOnly ? '可改模型与 Codex 思考程度,会经 Hub 下发到节点。' : '改模型会让节点重启一次;思考程度热更新,不经过大模型。'} />
        <View style={[card, { flexDirection: 'row', flexWrap: 'wrap' }]}>
          {runtimeFacts.map(fact => <FactCell key={fact.label} fact={fact} columns={factColumns} />)}
        </View>
        {/* board #694 —— 节点操作自然会在这里找:一句指路,点了回概览。 */}
        {control ? (
          <Pressable testID="node-model-control-pointer" accessibilityRole="link" onPress={() => setActiveSection('overview')} hitSlop={8} style={{ marginTop: spacing.sm, paddingVertical: spacing.xs, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>{t('nodeControl.pointer')}</Text>
            <Text style={{ color: colors.accent, fontSize: typeScale.small, fontWeight: weight.strong }}>{t('nodeControl.pointerOpen')} ›</Text>
          </Pressable>
        ) : null}
        {/* RFC-024 —— 不经 LLM 直接改模型;需要权威 node_id。 */}
        {node && !daemonProviderNodeRuntime(node.runtime) ? <NodeModelSection cfg={cfg} node={node} /> : null}
        {node && daemonProviderNodeRuntime(node.runtime) ? (
          <NodeDaemonProviderSection cfg={cfg} node={node} onManageBinding={() => setActiveSection('overview')} />
        ) : null}
        {node && (node.runtime === 'codex-app-server' || node.runtime === 'codex-sdk') ? (
          <>
            <NodeCodexExecutionSection cfg={cfg} node={node} />
            <NodeCodexReasoningSection cfg={cfg} node={node} />
          </>
        ) : null}
        {!readOnly && node && isCodexRuntime(node.runtime) && !daemonProviderNodeRuntime(node.runtime) ? (
          <NodeCodexProviderSection runtimeId={node.runtime} serverUrl={cfg.serverUrl} />
        ) : null}
      </View>
    );
    if (section === 'secrets') return (
      <View>
        <SectionTitle title="密钥" />
        <ScopedSecretsSection cfg={cfg} daemonId={node?.lifecycle_daemon_node_id} nodeId={node?.node_id} />
      </View>
    );
    if (section === 'rules') return (
      <View style={{ flex: 1 }}>
        {/* 说明收进规则区工具条的 ⓘ(09-25 紧凑化),标题下不再常驻一行。 */}
        {chrome.sectionTitle ? <SectionTitle title="规则文件" /> : null}
        {/* app#225 —— 节点规则文件（CLAUDE.md / AGENTS.md）查看/编辑。显示条件与请求目标见
            node-rules.ts rulesFileTarget:会话上报 rules_file_capable 时详情/只读页都显示
            (claude-code 会话没有 nodes 行也能按 alias 发);否则保持原行为。 */}
        {rulesTarget ? <NodeRulesSection cfg={cfg} node={rulesTarget} session={s} onDirtyChange={setRulesDirty} /> : null}
      </View>
    );
    if (section === 'skills') return (
      <View>
        <SectionTitle title="技能" />
        <NodeSkillsSection cfg={cfg} alias={alias} node={rulesTarget} session={s} readOnly={readOnly} />
      </View>
    );
    if (section === 'files') return (
      <View>
        <SectionTitle title="项目文件夹" />
        {/* 节点工作目录的只读文件树。有 nodes 行按 node_id 发(rulesTarget 带权威 node_id),否则按 alias。 */}
        <NodeFilesSection cfg={cfg} alias={alias} node={rulesTarget} session={s} treeMode={filesTree} />
      </View>
    );
    if (section === 'schedules') {
      // 执行节点按 node_id 认:nodes 行的权威 id 优先,没有再用会话上报的(节点计划的快照挂在会话上)。
      const scheduleNodeId = node?.node_id ?? s.node_id ?? null;
      // 「＋ 新建」/ 点一行 Hub 计划:就在这一页打开编辑器(NodeSchedulesSection 里的 ScheduleEditor),不切到定时任务页。
      const create = onOpenScheduled && scheduleNodeId ? () => setScheduleCreateSeq(n => n + 1) : undefined;
      return (
        <View>
          <SectionTitle
            title="定时任务"
            hint="这个节点要执行的计划:Hub 计划由 Hub 按时派发,节点计划是节点上报的本机计划。点一行 Hub 计划就地编辑、看最近执行。"
            action={create ? (
              <Pressable onPress={create} accessibilityRole="button" accessibilityLabel="新建定时任务" testID="node-schedules-create" hitSlop={6}
                style={({ pressed }) => [localStyles.headerAction, { backgroundColor: colors.accent }, pressed && { opacity: 0.8 }]}>
                <Text style={{ color: colors.onAccent, fontSize: typeScale.small, lineHeight: 17, fontWeight: weight.strong }}>＋ 新建</Text>
              </Pressable>
            ) : undefined}
          />
          {nodeListState === 'loading' && !scheduleNodeId ? (
            <ActivityIndicator color={colors.textMuted} style={{ alignSelf: 'flex-start' }} />
          ) : (
            <NodeSchedulesSection
              cfg={cfg}
              nodeId={scheduleNodeId}
              editable={!!onOpenScheduled}
              createSeq={scheduleCreateSeq}
              onOpenNodePlan={onOpenScheduled}
            />
          )}
        </View>
      );
    }
    if (section === 'logs') return (
      <View style={{ flex: 1, minHeight: 0 }}>
        <SectionTitle title="运行日志" />
        {/* 节点自己的 agent-node 运行日志末尾(只读;节点上脱敏、hub 读后即删)。有 nodes 行按 node_id 发,否则按 alias。 */}
        <NodeLogsSection cfg={cfg} alias={alias} node={rulesTarget} session={s} pointer={pointerUi(desktop)} />
      </View>
    );
    if (section === 'tasks') return (
      <View>
        <SectionTitle title="任务" hint="发给这个节点的任务。自己发给自己的定时提醒单独一组,不算运行中。" />
        {/* app#157 —— 这个节点正在跑什么、前面排着几条(只读视图也显示,它不改任何东西) */}
        <NodeTasksSection cfg={cfg} alias={alias} embedded />
      </View>
    );
    if (section === 'permissions' && node) return (
      <View>
        <SectionTitle title="权限" />
        <NodePermissionSection cfg={cfg} node={node} compact={compact} onChanged={mode => setNode(prev => prev ? { ...prev, permission_mode: mode } : prev)} />
      </View>
    );
    // danger
    return (
      <View>
        <SectionTitle title="危险操作" hint="操作通过公开 CommHub/anet 契约执行。停止不会删除配置；有任务处理中时 Hub 会拒绝，不会自动强制。" />
        {!readOnly ? <View style={[localStyles.dangerZone, { borderColor: colors.failed }]}>
          {node && <NodeAdoptionControls key={JSON.stringify([cfg.serverUrl, cfg.token, cfg.networkId, node.node_id])} cfg={cfg} node={node} online={online} onRefresh={() => { void load(); }} />}
          {node && isAdopted(node) ? null : node ? (
            <View style={{ gap: spacing.md }}>
              {/* app#196 —— hub 明确说不可控时置灰。
                  🔴 undefined（旧 hub 没这个字段）按可控渲染：与升级前行为逐字相同，
                  真不行的话提交时 hub 会拒绝并显示错误 —— 宁可多让用户点一次，
                  也不能因为 hub 旧就把 11 个真正可控的节点全灰掉。
                  board #586 —— 重启和停止 / 删除分开判:手动启动的节点在线且报了 config_update_capable 就能重启
                  (节点自己 exit 75,不需要 daemon);判据见 node-danger-actions.ts。置灰一律写一句原因。 */}
              <View style={localStyles.actionRow}>
                {/* board #585 —— 节点没在跑时才出现;手动启动的节点置灰,下面一句说去那台机器上 anet node start。 */}
                {danger.start.visible ? (
                  <NodeActionButton label="启动节点" tone="primary" disabled={!danger.start.enabled} disabledHint={danger.start.reason} onPress={() => setPendingAction('start_node')} />
                ) : null}
                <NodeActionButton label="重启节点" tone="neutral" disabled={!danger.restart.enabled} disabledHint={danger.restart.reason} onPress={() => setPendingAction('restart_node')} />
                <NodeActionButton label="停止节点" tone="caution" disabled={!danger.stop.enabled} disabledHint={danger.stop.reason} onPress={() => setPendingAction('stop_node')} />
                <NodeActionButton label="删除节点" tone="danger" disabled={!danger.stopDelete.enabled} disabledHint={danger.stopDelete.reason} onPress={() => setPendingAction('delete_node')} />
              </View>
              {danger.start.reason || danger.restart.reason || danger.stop.reason || danger.stopDelete.reason ? (
                <View style={{ gap: spacing.xs }} testID="node-danger-reasons">
                  {danger.start.visible && danger.start.reason ? (
                    <Text testID="node-danger-start-reason" style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }}>{danger.start.reason}</Text>
                  ) : null}
                  {danger.restart.reason ? (
                    <Text testID="node-danger-restart-reason" style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }}>重启：{danger.restart.reason}</Text>
                  ) : null}
                  {/* #715 复审 —— daemon 管的节点停了:停止置灰的那句(手动启动的走下面那行,不重复)。 */}
                  {danger.stop.reason && danger.stop.reason !== danger.stopDelete.reason ? (
                    <Text testID="node-danger-stop-state-reason" style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }}>停止：{danger.stop.reason}</Text>
                  ) : null}
                  {danger.stopDelete.reason ? (
                    <Text testID="node-danger-stop-reason" style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }}>
                      {danger.stopDelete.reason}可在那台机器上执行 `anet node stop {alias}`。
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {actionMessage ? (
                <Text testID="node-danger-action-message" style={{ color: { ok: colors.running, warn: colors.blocked, error: colors.failed }[actionMessageTone(actionMessage)], fontSize: typeScale.small, lineHeight: 18 }}>{actionMessage}</Text>
              ) : null}
            </View>
          ) : (
            <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>{nodeIdentityNotice(s, node, nodeListState)}</Text>
          )}
        </View> : null}
      </View>
    );
  })();

  const column = (
    // 运行日志:列的高度按可用空间定(flexBasis 0 + minHeight 0),不按内容撑开 —— 否则 2000 行日志把列撑到几万像素,
    // 日志区自己的 ScrollView 永远不滚、打开时也停不到最新一行。
    <View style={{ flexGrow: 1, width: '100%', maxWidth: nodePageColumnMaxWidth(section, filesTree), alignSelf: 'center', ...(section === 'logs' ? { flexBasis: 0, minHeight: 0 } : null) }} testID="node-page-content">
      {content}
    </View>
  );
  return (
    // 规则分区在原生端打字时:键盘把页面底部顶上来(Android edge-to-edge 下 adjustResize 不生效,同 ChatScreen 的做法),
    // 编辑框底边和光标所在行不被键盘盖住;别的分区不启用,行为不变。
    <KeyboardAvoidingView
      style={[styles.root, Platform.OS !== 'web' && section === 'rules' ? iosKeyboard.style : null]}
      // Android: 只在键盘真弹着时启用 —— RN 的 KAV 收起键盘时不归零 padding,会留一条键盘高的空白(见 keyboard-visibility.ts)。
      enabled={keyboardAvoidEnabled(Platform.OS, keyboardVisible, Platform.OS !== 'web' && section === 'rules')}
      behavior={iosKeyboard.handled ? undefined : 'padding'}
      keyboardVerticalOffset={Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0}
    >
      {iosKeyboard.probe}
      {header}
      {chrome.headerCard ? headerCard : null}
      <View style={{ flex: 1, flexDirection: compact ? 'column' : 'row', minHeight: 0 }}>
        {nav}
        {/* 内容列随窗口变宽、到 NODE_PAGE_CONTENT_MAX_WIDTH 封顶并居中(Vincent 09-24「空了」:
            原来 maxWidth 880 贴左,2000px 宽窗右边空一大片)。
            规则文件分区整页不滚(nodePageScrolls):工具条钉在上面,阅读区 / 编辑框自己滚 ——
            包在 ScrollView 里时手机上一滑就把「阅读/编辑」「保存」滚出屏幕(2026-09-26 小米折叠屏)。 */}
        {pageScrolls ? (
          <ScrollView style={{ flex: 1 }} onLayout={e => setPaneWidth(e.nativeEvent.layout.width)}
            contentContainerStyle={{ flexGrow: 1, padding: contentPadding, paddingBottom: spacing.xl * 2 }}>
            {column}
          </ScrollView>
        ) : (
          <View style={{ flex: 1, minHeight: 0, padding: contentPadding }} onLayout={e => setPaneWidth(e.nativeEvent.layout.width)} testID="node-page-fixed">
            {column}
          </View>
        )}
      </View>

      {/* 规则文件有没保存的草稿,又要切分区 / 返回。 */}
      <Modal transparent visible={!!pendingLeave} onRequestClose={() => setPendingLeave(null)} animationType="fade">
        <View style={[{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }, withBasePadding(dialogSafe, spacing.xl)]}>
          <View style={{ width: '100%', maxWidth: 420, borderRadius: radius.surface, backgroundColor: colors.card, padding: spacing.xl, gap: spacing.md, ...elevated('floating') }} accessibilityViewIsModal>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>放弃未保存的修改？</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19 }}>规则文件的改动还没有保存到节点。离开后这些改动会丢失。</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, flexWrap: 'wrap' }}>
              <Pressable style={styles.retryBtn} accessibilityRole="button" onPress={() => setPendingLeave(null)}><Text style={styles.retryBtnText}>继续编辑</Text></Pressable>
              <Pressable
                style={[styles.retryBtn, { borderColor: colors.failed }]}
                accessibilityRole="button"
                onPress={() => { const go = pendingLeave; setPendingLeave(null); setRulesDirty(false); go?.(); }}
              >
                <Text style={{ color: colors.failed, fontWeight: '600' }}>放弃修改</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={!!pendingAction && (!readOnly || OVERVIEW_ACTIONS.includes(pendingAction))} onRequestClose={() => setPendingAction(null)} animationType="fade">
        <ModalKeyboardAvoider scrim="rgba(0,0,0,0.55)">
        <View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center' }, withBasePadding(dialogSafe, spacing.xl)]}>
          <View style={{ width: '100%', maxWidth: 420, borderRadius: radius.surface, backgroundColor: colors.card, padding: spacing.xl, gap: spacing.md, ...elevated('floating') }}>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>
              {pendingAction === 'start_node' ? '启动节点？' : pendingAction === 'restart_node' ? '重启节点？' : pendingAction === 'stop_node' ? '停止节点？' : '删除节点？'}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19 }}>
              {pendingAction === 'delete_node' ? `删除会撤销节点身份。请输入别名“${alias}”确认；节点配置默认备份保留。` : pendingAction === 'start_node' ? `目标：${alias}。由它所在机器上的 daemon 启动，提交后这里会等它上线。` : `目标：${alias}。请求提交后请等待节点状态刷新。`}
            </Text>
            {pendingAction === 'delete_node' ? (
              <TextInput value={confirmAlias} onChangeText={setConfirmAlias} autoCapitalize="none" placeholder={alias} placeholderTextColor={colors.textMuted} style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: spacing.md }} />
            ) : null}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm }}>
              <Pressable style={styles.retryBtn} onPress={() => { setPendingAction(null); setConfirmAlias(''); }}><Text style={styles.retryBtnText}>返回</Text></Pressable>
              <Pressable
                style={[styles.retryBtn, pendingAction === 'delete_node' && { backgroundColor: colors.card, borderColor: colors.failed, borderWidth: 1 }, (actionBusy || (pendingAction === 'delete_node' && confirmAlias !== alias)) && { opacity: 0.4 }]}
                disabled={actionBusy || (pendingAction === 'delete_node' && confirmAlias !== alias)}
                onPress={() => void executeLifecycle()}
              >
                <Text style={[styles.retryBtnText, pendingAction === 'delete_node' && { color: colors.failed }]}>{actionBusy ? '提交中…' : '确认'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
        </ModalKeyboardAvoider>
      </Modal>

      {cloneOpen && cloneSource ? (
        <CloneNodeDialog
          cfg={cfg}
          source={cloneSource}
          takenNames={knownNames}
          onClose={() => setCloneOpen(false)}
          onDone={outcome => {
            setCloneNotice({ demo: outcome.demo, pending: outcome.pending, text: cloneNoticeMessage(outcome, t) });
          }}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

// Rebuilt on every restyle: it reads `spacing` (density-scaled) and ds() (src/ui-scale.ts).
const makeLocalStyles = () => StyleSheet.create({
  headerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  chip: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    maxWidth: 260,
  },
  rail: {
    width: ds(200),
    borderRightWidth: 1,
    paddingTop: spacing.md,
  },
  railList: { paddingHorizontal: spacing.sm, gap: 2 },
  railItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.item,
  },
  // Android two-pane (touch): Material's 48 dp minimum for the rail, 40 dp for the chip row.
  railItemTouch: { minHeight: ds(48, 44) },
  tabTouch: { minHeight: ds(40, 36), justifyContent: 'center' },
  tabsWrap: {
    borderBottomWidth: 1,
    paddingVertical: spacing.sm,
  },
  tabsRow: { flexDirection: 'row', paddingHorizontal: spacing.md, gap: spacing.xs },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
  },
  // 不高于分区标题那一行(≈ 21px):否则标题行被撑高,「定时任务」标题会比其它分区的标题低几像素。
  headerAction: {
    borderRadius: radius.item,
    paddingHorizontal: spacing.md,
    paddingVertical: 2,
  },
  dangerZone: {
    borderWidth: 1,
    borderRadius: radius.surface,
    padding: spacing.lg,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionButton: {
    minWidth: ds(92),
    height: ds(34),
    borderRadius: radius.control,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonPressed: {
    opacity: 0.68,
    transform: [{ scale: 0.98 }],
  },
  actionButtonText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
});
let localStyles = makeLocalStyles();
onThemeChange(() => { localStyles = makeLocalStyles(); });
