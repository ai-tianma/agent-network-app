// 节点列表页 —— 从 App.tsx 抽出(纯搬移;分组/排序/过滤逻辑另见 agents-list.ts)。
//
// 抽出的动机:App.tsx 已 673 行且是多人同时要改的文件(Tasks tab 等),
// 把这 220 行独立出来后,列表页的改动不再和导航结构互相踩。
// 🔴 样式必须从 ./app-styles 引入,不能在本文件复制一份 —— 那是 let 变量,
// 主题切换时整体重新赋值,复制的那份不会跟着变(见 app-styles.ts 头注释)。

import { fetchOrg } from './org-api';
import { groupPeopleByDepartment, managedDepartmentIds, type OrgData } from './org-model';
import { ManageDepartmentDesktop, ManageDepartmentIcon } from './ManageDepartment';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import HumanAvatar from './HumanAvatar';
import { consumeAgentSearchFocus, subscribeAgentSearchFocus } from './shortcuts-store';
import { useTranslation } from './i18n-react';
import './i18n-chat';
import './i18n-users';
import { agentsEmptyKind, isRestrictedIn } from './user-admin';
import { fetchAuthMe } from './user-admin-api';
import { applyMemberPresence, noteHumanUsernames, PEOPLE_GROUP_KEY, peopleRows, personPresence, shownPeople, type Human, type PersonPresence, type PersonRow } from './human-dm';
import { fetchHumans } from './human-dm-api';
import { applyConversationTabToGroups, applyGroupEvent, groupRows, groupSubtitle, shownGroups, type GroupRow } from './group-chat';
import { fetchConversationThreads } from './group-chat-api';
import { subscribeGroupChat } from './group-chat-bus';
import { localizedChatHeader as formatChatHeader } from './i18n-chat-time';
import GroupAvatar from './GroupAvatar';
import { subscribeHumanDm, subscribeMemberPresence } from './human-dm-bus';
import { isAgentOnline } from './chat-actions';
import { fetchStatus, fetchUserMessages, takeStatusPrefetch, type HubConfig, type Session,
  ackAgentMessages,
  ackUserMessages,
  fetchReplyInbox,
  fetchTasks,
} from './api';
import { loadSessionsCache, saveSessionsCache } from './storage';
import RegisteredAgentsSection from './RegisteredAgentsSection';
import { useAgentDirectory } from './agent-directory-hook';
import { registeredAgentRows } from './registered-agents';
import { colors, onThemeChange, radius, spacing, statusColor, themeMode, type, weight } from './theme';
import { shadowOnly } from './elevation';
import { ds, fs, listText, uiScale } from './ui-scale';
import { denserRowPitch, publishListFirstRowTop } from './list-rail-align';
import { usePoll } from './usePoll';
import { retryUnreadPersistFromPoll } from './conversation-unread-persist';
import AgentUnreadBadge from './AgentUnreadBadge';
import DegradedBadge from './DegradedBadge';
import { nodeDegraded } from './node-degraded';
import { formatUnreadBadge, type UnreadState } from './unread-ledger';
import { unreadCountForAgentRow } from './unread-badge';
import {
  bindUnreadAppState,
  getUnreadSnapshot,
  hubHasAgentUnread,
  ingestInboxMessagesBody,
  markAgentReadLocally,
  markAgentServerUnreadCleared,
  unackedIdsForAgent,
  ingestUserMessagesBody,
  replyUnreadCounts,
  subscribeUnread,
} from './unread-store';
import { styles } from './app-styles';
import { applyCollapsed, buildSections, countShown, holdWhileActive, SORT_BY_ACTIVITY, toggleCollapsed } from './agents-list';
import { AGENT_ROW_AVATAR, AGENT_ROW_DOT, AGENT_ROW_GAP, AGENT_ROW_HEIGHT, AGENT_ROW_PAD_X, AGENT_ROW_PAD_Y, AGENT_ROW_SEPARATOR_INSET, AGENT_ROW_TOUCH_MIN, agentRowGeometry, agentRowModel, latestMessageByAgent, rowActivity } from './agent-row-model';
import { TaskTimeResolver } from './agent-task-time';
import { loadCollapsedGroups, loadConversationTab, peekConversationTab, saveCollapsedGroups, saveConversationTab } from './agent-list-prefs';
import { CONVERSATION_TABS, applyConversationTab, applyConversationTabToPeople, formatTabCount, unreadConversationCount, type ConversationTab } from './conversation-tab';
import { agentUnreadCounts, latestMessageAtByAgent } from './agent-unread-counts';
import { pinyinMatch } from './lib/pinyin';
import { ackAgentUnread } from './agent-ack';
import AgentRowMenu, { type AgentRowMenuTarget } from './AgentRowMenu';
import {
  agentRowMenuItems,
  clearManualUnread,
  hideConversation,
  isConversationHidden,
  markManualUnread,
  partitionHidden,
  pruneRevivedHidden,
  restoreConversation,
  rowBadgeWithManual,
  rowIsUnread,
  type AgentRowMenuKey,
} from './agent-row-menu';
import { bindConversationFlags, getConversationFlags, subscribeConversationFlags, updateConversationFlags } from './conversation-flags';
import { agentRowBadge, isHostSupervisorAlias, nodeRolesVersion, subscribeNodeRoles } from './daemon-node';
import { applyAgentFilter, filterLabel, isFilterActive, STATUS_FILTER_LABEL, type AgentListFilter, type AgentStatusFilter } from './server-stats';
import { pointerUi } from './pointer-ui';
import { conversationDraftKey, draftPreview, draftTextFor, useDraftsVersion, type DraftConversation } from './composer-drafts';
import { rememberAgentNetworks } from './agent-network';

// 受限成员的空态文案比「还没有 agent」长,窄屏会折行:居中并留出与列表同宽的边距。
const restrictedEmptyCopy = () => ({ textAlign: 'center' as const, paddingHorizontal: spacing.xl });

export default function AgentsScreen({
  cfg,
  onOpenChat,
  onOpenPicker,
  onOpenNodeDetail,
  onOpenPerson,
  selectedPerson,
  onOpenGroup,
  selectedGroup,
  compact = false,
  selectedAlias,
  pinnedAliases = [],
  onTogglePin,
  onOpenChatWindow,
  mutedAliases = [],
  onToggleMute,
  preview,
  filter,
}: {
  cfg: HubConfig;
  /** #769: networkId = 点的那一行所在网络(会话要打到它,不是当前网络)。 */
  onOpenChat: (alias: string, networkId?: string) => void;
  /** #338 — top-right `+` opens the host_supervisor picker modal. */
  onOpenPicker: () => void;
  /** 会话行菜单里的「节点详情」(2026-09-26 起长按改成弹菜单,以前长按直接进这里)。
   *  没有 onTogglePin 的列表(桌面「服务器 → 节点」)没有菜单,长按仍直接进节点详情。
   *  `onPress` remains the high-frequency path to chat and is NOT changed (通信龙 red-line 71ee862d). */
  onOpenNodeDetail: (alias: string) => void;
  /** 人员区块(同网络的其他人,私信)。不传 = 不画(比如「服务器 → 节点」那个列表)。 */
  onOpenPerson?: (person: Human) => void;
  /** 当前打开的私信对象(用户名),行高亮。 */
  selectedPerson?: string;
  /** 群聊区块(RFC-042,Hub ≥ .93)。不传 = 不画;Hub 的 /api/dm/threads 没有 group_threads = 也不画。 */
  onOpenGroup?: (group: { group_id: string; name: string }) => void;
  /** 当前打开的群(group_id),行高亮。 */
  selectedGroup?: string;
  compact?: boolean;
  selectedAlias?: string;
  pinnedAliases?: string[];
  onTogglePin?: (alias: string) => void;
  onOpenChatWindow?: (alias: string) => void;
  /** 0.2.107:本账号下「消息免打扰」的 agent —— 行上画一个静音铃铛。 */
  mutedAliases?: readonly string[];
  /** 桌面右键菜单里的「消息免打扰」开关(手机在会话页右上角)。 */
  onToggleMute?: (alias: string) => void;
  /** GUI 夹具：跳过 Hub 拉取，用同一套行渲染钉死徽标。 */
  preview?: { sessions: Session[]; ledger: UnreadState; serverBody: unknown };
  /** 从服务器页的状态卡片 / 分组行进来时带的筛选(server-stats.ts)。每次导航是一个新对象;
   *  undefined 不清除已有筛选 —— 双栏里点开会话时列表不该丢掉筛选。 */
  filter?: AgentListFilter | null;
}) {
  const { t } = useTranslation();
  // #632 草稿(微信同款):有没发出去的字的会话,行上用红色「[草稿]」+ 开头几个字代替最后一条消息预览。
  // 正开着的那个会话不画(双栏里一边打字一边看自己的草稿行跳没有意义)。
  useDraftsVersion();
  const draftFor = (conversation: DraftConversation, open: boolean): string =>
    open || preview ? '' : draftTextFor(conversationDraftKey(cfg, conversation));
  const draftLine = (text: string, style: any, testID: string) => (
    <Text dense selectable={false} numberOfLines={1} style={style} testID={testID}>
      <Text dense selectable={false} style={{ color: colors.failed }}>{t('chat.draftTag')}</Text>
      {' '}{draftPreview(text)}
    </Text>
  );
  const [sessions, setSessions] = useState<Session[]>(preview?.sessions ?? []);
  // #725: registered nodes with no session are a separate read-only block. They are
  // NOT list rows: the list is Session-shaped and a synthetic status would look online.
  const agentDirectory = useAgentDirectory(cfg, !preview);
  const [registeredCollapsed, setRegisteredCollapsed] = useState(false);
  const [loading, setLoading] = useState(!preview);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  // 多用户 Agent 权限:当前网络里我是不是受限成员(只看管理员分配的 Agent)。决定空列表说什么。
  const [restricted, setRestricted] = useState(false);
  const [selfUserId, setSelfUserId] = useState<string | undefined>(undefined);
  // 部门负责人(RFC-040,Hub ≥ .91):/api/auth/me 的 managed_department_ids 非空 → 桌面侧栏「人员」上方多一项「管理本部门」。
  // 旧 Hub 没有这个字段 → 空,入口不出现。
  const [managedDepts, setManagedDepts] = useState<{ ids: string[]; networkName: string }>({ ids: [], networkName: '' });
  const [manageDeptOpen, setManageDeptOpen] = useState(false);
  useEffect(() => {
    if (preview) return;
    let live = true;
    void fetchAuthMe(cfg).then(me => {
      if (!live) return;
      setRestricted(isRestrictedIn(me, cfg.networkId));
      setSelfUserId(me?.user?.user_id ?? undefined);
      const net = (me?.networks ?? []).find(n => n.network_id === cfg.networkId);
      setManagedDepts({ ids: managedDepartmentIds(me, cfg.networkId), networkName: net?.network_name ?? '' });
    }).catch(() => {});
    return () => { live = false; };
  }, [cfg.serverUrl, cfg.token, cfg.networkId, preview]);
  // 人员(hub#2086):同网络的其他人 + 各自私信未读。旧 hub 没有这些接口 → 空,区块不出现。
  const [people, setPeople] = useState<PersonRow[]>([]);
  // 组织架构(board #419):有部门、且有人分了部门时,「人员」按部门分小组(部门路径做小标题,未分配的最后)。
  // 旧 Hub 没有 /departments → null,照旧一个平的列表。
  const [org, setOrg] = useState<OrgData | null>(null);
  // 群会话(RFC-042):和私信同一次 /api/dm/threads 拿到。null = 这个 Hub 没有群(没有 group_threads 字段)→ 区块不画。
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const loadPeople = useCallback(async () => {
    if (!onOpenPerson || !cfg.networkId || preview || !selfUserId) return;
    try {
      const humans = await fetchHumans(cfg, cfg.networkId);
      noteHumanUsernames(humans.map(h => h.username));
      const conv = await fetchConversationThreads(cfg, cfg.networkId).catch(() => ({ threads: [], groupThreads: null }));
      setPeople(peopleRows(humans, conv.threads, selfUserId));
      setGroups(onOpenGroup && conv.groupThreads ? groupRows(conv.groupThreads) : null);
      void fetchOrg(cfg, cfg.networkId).then(setOrg).catch(() => { /* 读不到部门就不分组 */ });
    } catch { setPeople([]); setGroups(null); }
  }, [cfg.serverUrl, cfg.token, cfg.networkId, !!onOpenPerson, !!onOpenGroup, preview, selfUserId]);
  usePoll(loadPeople, 15000, [loadPeople]);
  useEffect(() => subscribeHumanDm(() => { void loadPeople(); }), [loadPeople]);
  // 群消息 / 已读的实时变化:Hub 在事件里带了我的未读数,就地改那一行;列表里没有这个群(新入群)→ 整表重拉。
  useEffect(() => subscribeGroupChat(ev => {
    if (!ev) { void loadPeople(); return; }
    let missing = false;
    setGroups(rows => {
      if (!rows) return rows;
      const next = applyGroupEvent(rows, ev);
      if (next === null) { missing = true; return rows; }
      return next;
    });
    if (missing) void loadPeople();
  }), [loadPeople]);
  // 在线状态的实时变化(hub 的 member_presence):就地改那一行。旧 hub 不推,只剩 15 s 轮询里的 online 字段。
  useEffect(() => subscribeMemberPresence(ev => setPeople(rows => applyMemberPresence(rows, ev))), []);
  // 设置 → 快捷键 的「搜索会话」(默认 ⌘/Ctrl+K,App.tsx DesktopWorkspace 发起):只有桌面列表栏
  // (compact)接。搜索框平时 > 10 个 agent 才出现;按了快捷键就算 agent 少也临时露出来并聚焦。
  // 从别的页切回来时列表刚挂上、会话还在加载,搜索框可能还没渲染:记下「要聚焦」,等它出现的那次渲染后再聚焦。
  const searchRef = useRef<any>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [, setSearchFocusTick] = useState(0);
  const wantSearchFocus = useRef(false);
  useEffect(() => {
    if (!compact) return;
    const take = () => {
      if (!consumeAgentSearchFocus()) return;
      wantSearchFocus.current = true;
      setSearchOpen(true);
      setSearchFocusTick(n => n + 1);
    };
    take();
    return subscribeAgentSearchFocus(take);
  }, [compact]);
  useEffect(() => {
    if (!wantSearchFocus.current || !searchRef.current) return;
    wantSearchFocus.current = false;
    searchRef.current.focus?.();
    searchRef.current.select?.();
  });
  const [activeFilter, setActiveFilter] = useState<AgentListFilter | null>(filter ?? null);
  useEffect(() => { if (filter) setActiveFilter(filter); }, [filter]);
  const filtering = isFilterActive(activeFilter);
  // 会话行菜单(长按 / 右键,AgentRowMenu):对着哪一行、按在哪。只有会话列表有菜单 —— 能置顶的列表才是会话列表。
  const rowMenu = !!onTogglePin;
  // 鼠标 + 键盘(pointer-ui.ts,Tauri 壳任何宽度):右键开菜单,不挂长按。
  const pointer = pointerUi();
  const [menuFor, setMenuFor] = useState<AgentRowMenuTarget | null>(null);
  const openRowMenu = useCallback((alias: string, x: number, y: number) => setMenuFor({ alias, x, y }), []);
  // 本机的「不显示该对话」「标为未读」(conversation-flags.ts),按账号分。
  useEffect(() => { bindConversationFlags(cfg); }, [cfg.profileId, cfg.serverUrl, cfg.username]);
  const convFlags = useSyncExternalStore(subscribeConversationFlags, getConversationFlags, getConversationFlags);
  // #692:谁是守护节点来自 App 轮询的 /api/nodes;变了要重画行(红点)。
  const rolesVersion = useSyncExternalStore(subscribeNodeRoles, nodeRolesVersion, nodeRolesVersion);
  const [showHidden, setShowHidden] = useState(false);
  const [hoveredAlias, setHoveredAlias] = useState<string | null>(null);
  const [unreadSnap, setUnreadSnap] = useState(getUnreadSnapshot);
  useEffect(() => subscribeUnread(() => setUnreadSnap(getUnreadSnapshot())), []);
  useEffect(() => { bindUnreadAppState(); }, []);

  // 「新消息」组(Vincent 2026-09-25「有消息的那些节点,你要置顶」):未读数取自 agentUnreadCounts ——
  // 托盘角标用的同一个函数,列表和托盘永远是同一组会话。
  const liveUnread = useMemo(() => {
    const src = preview
      ? { serverBody: preview.serverBody, ledger: preview.ledger, replyRows: [], replyUsername: '', replyWatermarks: {} }
      : unreadSnap;
    return { counts: agentUnreadCounts(src), lastAt: latestMessageAtByAgent(src) };
    // rolesVersion:守护节点不计未读(agent-unread-counts.ts),名单变了要重算「新消息」组。
  }, [preview, unreadSnap, rolesVersion]);
  // Row right column + preview line (phone / two-pane rows): the same snapshot as the counts.
  const latestByAgent = useMemo(() => latestMessageByAgent(preview
    ? { serverBody: preview.serverBody, replyRows: [], replyUsername: '' }
    : unreadSnap), [preview, unreadSnap]);
  // Rows whose second line is the task text get the time of the task that text came from
  // (agent-task-time.ts). One resolver per hub + network; a heartbeat never triggers a read.
  const taskTimes = useMemo(() => new TaskTimeResolver(async alias =>
    (await fetchTasks(cfg, { to_name: alias, limit: 1, skipStats: true })).tasks ?? []),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [cfg.serverUrl, cfg.token, cfg.networkId]);
  const [taskTimesTick, setTaskTimesTick] = useState(0);
  useEffect(() => taskTimes.subscribe(() => setTaskTimesTick(n => n + 1)), [taskTimes]);
  useEffect(() => {
    if (preview) return;
    void taskTimes.request(sessions
      .filter(s => s.task && !latestByAgent[s.alias]?.text)
      .map(s => ({ alias: s.alias, text: s.task ?? '', online: isAgentOnline(s.status) })));
  }, [preview, sessions, latestByAgent, taskTimes]);
  // Row activity time per alias — what `sortByActivity` orders by (off by default: SORT_BY_ACTIVITY).
  const activityByAlias = useMemo(() => {
    const out = new Map<string, number>();
    for (const s of sessions) out.set(s.alias, rowActivity(s, latestByAgent[s.alias], taskTimes.timeFor(s.alias, s.task)).at);
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, latestByAgent, taskTimes, taskTimesTick]);
  // Folded group headers, remembered per device (agent-list-prefs.ts).
  const [collapsed, setCollapsed] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    loadCollapsedGroups().then(v => { if (live) setCollapsed(v); }).catch(() => {});
    return () => { live = false; };
  }, []);
  // 「全部 / 未读 N」(board #449,conversation-tab.ts):只在会话列表(能置顶的那个)上出现,每台设备记住选了哪个。
  // 首帧用内存 / localStorage 里的值(peekConversationTab),手机从会话返回时不会先闪「全部」。
  const showTabs = rowMenu;
  const [tab, setTabState] = useState<ConversationTab>(() => peekConversationTab() ?? 'all');
  useEffect(() => {
    if (peekConversationTab()) return;
    let live = true;
    loadConversationTab().then(v => { if (live) setTabState(v); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const setTab = useCallback((next: ConversationTab) => {
    setTabState(next);
    void saveConversationTab(next);
  }, []);
  const effectiveTab: ConversationTab = showTabs ? tab : 'all';
  const toggleGroup = useCallback((title: string) => {
    setCollapsed(prev => {
      const next = toggleCollapsed(prev, title);
      void saveCollapsedGroups(next);
      return next;
    });
  }, []);
  // 指针在列表行间移动 / 滚动的这一小段时间里,先按住上一份分组输入,停手 1.2s 后再换成最新的 ——
  // 否则新消息把行顶下去,光标底下的那一行会跳走。只按住「活动中」,鼠标停在列表上不动时照常上浮。
  const [listActive, setListActive] = useState(false);
  const activeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markListActive = useCallback(() => {
    setListActive(true);
    if (activeTimer.current) clearTimeout(activeTimer.current);
    activeTimer.current = setTimeout(() => setListActive(false), 1200);
  }, []);
  useEffect(() => () => { if (activeTimer.current) clearTimeout(activeTimer.current); }, []);
  const heldUnread = useRef<typeof liveUnread | null>(null);
  const floatInput = holdWhileActive(heldUnread.current, liveUnread, listActive);
  heldUnread.current = floatInput;

  // RN Web's bubbling onContextMenu can run after WKWebView has already
  // decided to show its native "Reload" menu. Intercept in the capture phase
  // at document level so desktop agent rows only ever show our own menu.
  // 手机布局的 web 导出(安卓 UA 的浏览器)行上也挂了 data-agent-alias,右键同样出这份菜单。
  useEffect(() => {
    const doc = (globalThis as any).document;
    if (!rowMenu || Platform.OS !== 'web' || !doc?.addEventListener) return;
    const handleContextMenu = (event: any) => {
      const row = event.target?.closest?.('[data-agent-alias]');
      const alias = row?.getAttribute?.('data-agent-alias');
      if (!alias) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      event.stopImmediatePropagation?.();
      // 夹进窗口由 anchorRowMenu 做(菜单高度随项数变,这里不猜)。
      openRowMenu(alias, event.clientX ?? event.pageX ?? 180, event.clientY ?? event.pageY ?? 180);
    };
    doc.addEventListener('contextmenu', handleContextMenu, true);
    return () => doc.removeEventListener('contextmenu', handleContextMenu, true);
  }, [rowMenu, openRowMenu]);

  const load = useCallback(async () => {
    if (preview) {
      setSessions(preview.sessions);
      setFailed(false);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    // First load consumes the boot prefetch if it's still in-flight/fresh;
    // polls and later loads fall through to a normal fetch.
    const statusRead = takeStatusPrefetch(cfg) ?? fetchStatus(cfg);
    // The two unread reads don't depend on the status read: start all three together. Chained,
    // the badges landed three round trips after launch (~2.3 s China → US on desktop) instead of
    // one. They are still applied in the same order as before.
    const userMessagesRead = fetchUserMessages(cfg, 50);
    const inboxRead = fetchReplyInbox(cfg);
    userMessagesRead.catch(() => {});
    inboxRead.catch(() => {});
    try {
      const data = await statusRead;
      const next = data.sessions ?? [];
      setSessions(next);
      rememberAgentNetworks(cfg, next);
      setFailed(false);
      // Persist for the next cold start's stale-while-revalidate paint.
      saveSessionsCache(next, cfg.profileId);
    } catch {
      /* keep last good list; with nothing loaded yet, surface the failure */
      setFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
      void retryUnreadPersistFromPoll();
    }
    try {
      ingestUserMessagesBody(await userMessagesRead);
    } catch {
      /* 列表照常显示；服务端未读拿不到时 unreadCountForAgentRow 退回 ledger */
    }
    try {
      // agent 回给用户的消息在 inbox 表(alias 分支),不在 user_inbox —— 红点的另一半(reply-unread.ts)
      ingestInboxMessagesBody(await inboxRead, cfg.username);
    } catch {
      /* 拿不到就沿用上一份 replyRows */
    }
  }, [cfg, preview]);

  // Perf (load time): paint the last-known agents from the disk cache
  // immediately so cold start shows content instead of a blank spinner; the
  // live fetch below refreshes within the same tick. Only fills in if the
  // fetch hasn't already populated the list (prev.length guard), so fresh
  // data always wins the race.
  useEffect(() => {
    if (preview) return;
    let live = true;
    loadSessionsCache(cfg.profileId).then(cached => {
      if (live && cached && cached.length) {
        setSessions(prev => (prev.length ? prev : cached));
        setLoading(false);
      }
    });
    return () => { live = false; };
  }, [cfg.profileId]);

  // Foreground-only polling: 10s while visible, paused in background, instant
  // refresh on resume (shared hook — see usePoll).
  usePoll(load, 10000, [load]);

  // 153 agents on the real hub made the flat list unusable. Vincent (tg
  // 1094): group by team so agents are findable, and stop showing offline
  // ones up front. We bucket by team prefix (derived from the alias), order
  // rows inside each team working → idle-online → offline, and sink teams
  // that have no online member to the bottom — so offline never floats up.
  // NOTE: this useMemo MUST stay above the early returns below — a hook after
  // a conditional return changes hook order between renders and crashes (the
  // v0.1.28 launch-crash regression, Vincent tg 1098).
  // 分组/过滤/排序全部下沉到 agents-list.ts(纯逻辑,有 21 条断言钉住;
  // 组内排序的三级与 web 的数据源差异见那边的注释)。
  // NOTE: 这个 useMemo 必须留在下面的 early return 之上 —— hook 出现在条件
  // 返回之后会改变 hook 顺序并崩溃(v0.1.28 launch-crash,Vincent tg 1098)。
  const q = query.trim();
  // 「不显示该对话」的行不进分组,收在列表底部「已隐藏的对话」里;来了更新的消息自动回来(agent-row-menu.ts)。
  const { visible: visibleSessions, hidden: hiddenSessions } = useMemo(
    () => partitionHidden(sessions, convFlags, alias => liveUnread.lastAt[alias] ?? 0, !!q),
    [sessions, convFlags, liveUnread, q],
  );
  useEffect(() => {
    updateConversationFlags(f => pruneRevivedHidden(f, liveUnread.lastAt));
  }, [liveUnread]);
  // 未读视图:只留有未读的会话 + 正打开着的那一个(读完也不在用户眼前抽走,离开它之后才消失)。
  // 判据用 floatInput —— 与「新消息」组同一份(指针在列表上移动时按住),行不会在光标底下消失。
  const tabbedSessions = useMemo(
    () => applyConversationTab(visibleSessions, effectiveTab, { counts: floatInput.counts, manualUnread: convFlags.manualUnread }, selectedAlias),
    [visibleSessions, effectiveTab, floatInput, convFlags, selectedAlias],
  );
  // 「未读 N」:实时数(不按住),只数列表里会出现的会话(可见的 agent + 人员)。
  const unreadTabCount = unreadConversationCount(
    visibleSessions.map(s => s.alias),
    { counts: liveUnread.counts, manualUnread: convFlags.manualUnread },
    [...(onOpenPerson ? people : []), ...(groups ?? [])],
  );
  const sections = useMemo(
    () => buildSections(applyAgentFilter(tabbedSessions, activeFilter), query, {
      match: pinyinMatch,
      sort: {
        pinned: alias => pinnedAliases.includes(alias),
        sortByActivity: SORT_BY_ACTIVITY,
        activityAt: alias => activityByAlias.get(alias) ?? 0,
      },
      unread: { count: alias => floatInput.counts[alias] ?? 0, lastMessageAt: alias => floatInput.lastAt[alias] ?? 0 },
    }),
    [tabbedSessions, activeFilter, query, pinnedAliases, floatInput, activityByAlias],
  );
  // #725: only rows that prove a registered identity, minus aliases the list already
  // shows as real sessions (double-rendering the same name would be worse than hiding it).
  const registeredRows = useMemo(() => {
    const sessionAliases = new Set(sessions.map(s => s.alias));
    return registeredAgentRows(agentDirectory.rows, { query, match: pinyinMatch })
      .filter(row => !sessionAliases.has(row.alias));
  }, [agentDirectory.rows, sessions, query]);
  const shownCount = countShown(sections);
  const shownSections = useMemo(() => applyCollapsed(sections, collapsed, query), [sections, collapsed, query]);
  // 更紧凑 (two-pane): tell the nav rail where the first row is and how tall rows are, so rail item n
  // sits beside row n (list-rail-align.ts). Only when the first section has rows on screen
  // (row height/pitch is not measured: both sides compute it with denserRowPitch).
  // 人员区块在列表最上面(ListHeaderComponent):搜索也过滤人,折叠状态与分组同存。
  const peopleShown = useMemo(
    () => shownPeople(onOpenPerson ? applyConversationTabToPeople(people, effectiveTab, selectedPerson) : [], query, collapsed, pinyinMatch),
    [people, !!onOpenPerson, query, collapsed, effectiveTab, selectedPerson],
  );
  const peopleExpanded = peopleShown.visible && peopleShown.rows.length > 0;
  // 群聊区块在「人员」上面:按最后一条消息时间排(Hub 同序);搜索按群名过滤;「未读」视图只留有未读的。
  const GROUPS_KEY = '\u0000groups';
  const groupsAll = useMemo(() => applyConversationTabToGroups(groups ?? [], effectiveTab, selectedGroup), [groups, effectiveTab, selectedGroup]);
  const groupsMatched = useMemo(() => shownGroups(groupsAll, query, pinyinMatch), [groupsAll, query]);
  const groupsVisible = !!groups && groupsMatched.length > 0;
  const groupsCollapsed = !query.trim() && collapsed.includes(GROUPS_KEY);
  const groupsShown = groupsCollapsed ? [] : groupsMatched;
  const groupsHeaderHRef = useRef<number | null>(null);
  const groupsSectionHRef = useRef<number | null>(null);
  const peopleGroups = useMemo(() => groupPeopleByDepartment(org, peopleShown.rows), [org, peopleShown.rows]);
  const peopleGroupHeadHRef = useRef<number | null>(null);
  // 第一行 = 列表里真正的第一行:人员展开时是第一个人,否则是第一个分组的第一行(人员折叠时要加上它的标题行高)。
  const alignFirstRow = !compact && uiScale().listDense && (groupsShown.length > 0 || peopleExpanded || (shownSections[0]?.data?.length ?? 0) > 0);
  const listYRef = useRef<number | null>(null); // bottom of head + filter bar
  const firstHeaderHRef = useRef<number | null>(null);
  const peopleHeaderHRef = useRef<number | null>(null);
  const peopleSectionHRef = useRef<number | null>(null);
  const publishFirstRowTop = () => {
    if (listYRef.current == null) return;
    // 群聊区块在最上面:展开时第一行是第一个群;折叠时整块(只剩标题)算进偏移,再按人员 / 分组算。
    if (groupsVisible && groupsShown.length) {
      if (groupsHeaderHRef.current == null) return;
      publishListFirstRowTop(listYRef.current + groupsHeaderHRef.current);
      return;
    }
    const groupsOffset = groupsVisible ? groupsSectionHRef.current : 0;
    if (groupsOffset == null) return;
    const top = listYRef.current + groupsOffset;
    if (peopleShown.visible) {
      if (peopleExpanded) {
        if (peopleHeaderHRef.current == null) return;
        // 按部门分组时第一行上面还有一个部门小标题。
        if (peopleGroups && peopleGroupHeadHRef.current == null) return;
        publishListFirstRowTop(top + peopleHeaderHRef.current + (peopleGroups ? peopleGroupHeadHRef.current ?? 0 : 0));
        return;
      }
      if (peopleSectionHRef.current == null || firstHeaderHRef.current == null) return;
      publishListFirstRowTop(top + peopleSectionHRef.current + firstHeaderHRef.current);
      return;
    }
    if (firstHeaderHRef.current == null) return;
    publishListFirstRowTop(top + firstHeaderHRef.current);
  };
  const nowMs = Date.now();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  // First load failed with nothing cached: a spinner forever is a dead end
  // (Vincent tg 841) — say so and give a retry button.
  if (failed && sessions.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>连接失败</Text>
        <Text style={styles.errorHint}>网络不稳定或 Hub 未响应，请重试</Text>
        <Pressable
          style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.7 }]}
          onPress={() => {
            setLoading(true);
            load();
          }}
        >
          <Text style={styles.retryBtnText}>重试</Text>
        </Pressable>
      </View>
    );
  }

  // Unread badge for one row — the same computation for the desktop row and the phone row.
  const rowUnreadCount = (alias: string) => unreadCountForAgentRow(
    preview?.serverBody ?? unreadSnap.serverBody,
    preview?.ledger ?? unreadSnap.ledger,
    alias,
    preview ? undefined : replyUnreadCounts(unreadSnap),
  );
  // 手动「标为未读」且没有真实未读时:一个不带数字的红点(微信同款),打开会话即消失。
  // #692 守护节点(host_supervisor)没有对话可读:它的行不画红点(daemon-node.ts agentRowBadge)。
  const rowBadge = (alias: string) => agentRowBadge(rowBadgeWithManual(formatUnreadBadge(rowUnreadCount(alias)), convFlags.manualUnread.includes(alias)), isHostSupervisorAlias(alias));

  const menuItems = menuFor ? agentRowMenuItems({
    unread: rowIsUnread(rowUnreadCount(menuFor.alias), convFlags.manualUnread.includes(menuFor.alias)),
    pinned: pinnedAliases.includes(menuFor.alias),
    muted: mutedAliases.includes(menuFor.alias),
    hidden: isConversationHidden(convFlags, menuFor.alias, liveUnread.lastAt[menuFor.alias] ?? 0),
    canPin: !!onTogglePin,
    canMute: !!onToggleMute,
    canOpenWindow: !!onOpenChatWindow,
  }) : [];
  const onRowMenu = (key: AgentRowMenuKey, alias: string) => {
    switch (key) {
      case 'read':
        if (rowIsUnread(rowUnreadCount(alias), convFlags.manualUnread.includes(alias))) {
          // 标为已读:手动红点去掉 + 真实未读按「会话渲染到底」同一套清法清掉(本地 + hub ack)。
          updateConversationFlags(f => clearManualUnread(f, alias));
          if (preview) return;
          markAgentReadLocally(alias);
          if (hubHasAgentUnread()) {
            void ackAgentUnread(alias, {
              ackAgent: agent => ackAgentMessages(cfg, agent),
              ackIds: ids => ackUserMessages(cfg, ids),
              idsFor: agent => unackedIdsForAgent(agent),
              clearServerUnread: agent => markAgentServerUnreadCleared(agent),
              warn: (message, error) => console.warn(message, error),
            });
          }
        } else {
          updateConversationFlags(f => markManualUnread(f, alias));
        }
        return;
      case 'pin': onTogglePin?.(alias); return;
      case 'mute': onToggleMute?.(alias); return;
      case 'openWindow': onOpenChatWindow?.(alias); return;
      case 'detail': onOpenNodeDetail(alias); return;
      case 'hide':
        if (isConversationHidden(convFlags, alias, liveUnread.lastAt[alias] ?? 0)) updateConversationFlags(f => restoreConversation(f, alias));
        else updateConversationFlags(f => hideConversation(f, alias, liveUnread.lastAt[alias] ?? 0));
        return;
    }
  };
  // 点开一条隐藏的会话 = 把它找回来(和微信从搜索里点开隐藏会话一样)。
  const openChat = (alias: string, networkId?: string | null) => {
    if (alias in convFlags.hidden) updateConversationFlags(f => restoreConversation(f, alias));
    onOpenChat(alias, networkId ?? undefined);
  };

  // Desktop (Tauri) sidebar row — unchanged by the 0.2.106 phone / two-pane redesign.
  const renderCompactRow = (item: Session) => {
    const rowDraft = draftFor({ kind: 'node', alias: item.alias }, selectedAlias === item.alias);
    return (
    <Pressable
      testID={`agent-row-${item.alias}`}
      {...(compact && rowMenu ? ({ dataSet: { agentAlias: item.alias } } as any) : {})}
      onHoverIn={compact ? () => { setHoveredAlias(item.alias); markListActive(); } : undefined}
      onHoverOut={compact ? () => setHoveredAlias(current => current === item.alias ? null : current) : undefined}
      style={({ pressed }) => [
        styles.card,
        compact && ({ userSelect: 'none', cursor: 'default' } as any),
        compact && {
          borderWidth: 0,
          borderBottomWidth: 0,
          borderRadius: radius.control,
          paddingHorizontal: spacing.md,
          paddingVertical: 10,
          marginBottom: 2,
          // 极简:两种主题的行都是平铺(不成卡片),只靠悬停/选中的一档中性底色表达状态。
          backgroundColor: 'transparent',
        },
        compact && hoveredAlias === item.alias && { backgroundColor: colors.rowHover },
        selectedAlias === item.alias && { backgroundColor: colors.rowActive },
        item.status === 'offline' && styles.cardOffline,
        pressed && { opacity: 0.7 },
      ]}
      onPress={() => openChat(item.alias, item.network_id)}
      onLongPress={pointer ? undefined : () => onOpenNodeDetail(item.alias)}
      delayLongPress={400}
    >
      <View style={styles.avatarWrap}>
        <AliasAvatar alias={item.alias} size={34} />
        {/* 更像微信·round-5: 头像右下在线态圆点(带描边环·offline 灰暗) */}
        <View
          testID={`agent-dot-${item.alias}`}
          style={[
            styles.statusDot,
            { backgroundColor: statusColor(item.status ?? '', true) },
            !isAgentOnline(item.status) && styles.statusDotOffline,
          ]}
        />
        <AgentUnreadBadge badge={rowBadge(item.alias)} testID={`unread-badge-${item.alias}`} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <Text dense selectable={false} style={[styles.alias, compact && { fontSize: 13, fontWeight: '600' }, { flexShrink: 1 }]} numberOfLines={1}>
            {pinnedAliases.includes(item.alias) ? '📌 ' : ''}
            {item.alias}
            {mutedAliases.includes(item.alias) ? ' 🔕' : ''}
          </Text>
          {/* #460 降级:App Server 断开 / TUI 不在 / 需要重新登录 —— Hub 会拒收发给它的新任务。不知道时不画。 */}
          <DegradedBadge info={nodeDegraded(item)} testID={`agent-degraded-${item.alias}`} />
        </View>
        {rowDraft ? draftLine(rowDraft, [styles.task, compact && { fontSize: 11 }], `draft-preview-${item.alias}`) : item.task ? (
          <Text dense selectable={false} style={[styles.task, compact && { fontSize: 11 }]} numberOfLines={1}>
            {item.task}
          </Text>
        ) : null}
      </View>
    </Pressable>
    );
  };

  // 人员行:与 agent 行同一套几何(桌面侧栏 = renderCompactRow 的平铺行;手机 / 双栏 = renderPhoneRow 的 68 dp 行),
  // 头像(+ 在线点)· 名字 · 副标题(用户名 ·「x 分钟前在线」)· 未读角标。没有任务预览 —— 那是 agent 才有的。
  // 在线点与 agent 的点同一个样式、同一个位置(绿 = colors.running,灰 = colors.rest);hub 没给 online → 不画。
  const lastSeenText = (pr: PersonPresence): string => {
    const ls = pr && !pr.online ? pr.lastSeen : null;
    return ls ? t(`people.lastSeen.${ls.key}`, { n: ls.n ?? 0, date: ls.date ?? '' }) : '';
  };
  const renderPersonRow = (p: PersonRow) => {
    const selected = selectedPerson === p.username;
    const badge = formatUnreadBadge(p.unread);
    const presence = personPresence(p, nowMs);
    const subtitle = [p.name !== p.username ? p.username : '', lastSeenText(presence)].filter(Boolean).join(' · ');
    const rowDraft = draftFor({ kind: 'dm', userId: p.user_id || p.username }, selected);
    const presenceA11y = presence ? `，${t(presence.online ? 'people.online' : 'people.offline')}` : '';
    if (compact) {
      return (
        <Pressable
          testID={`person-row-${p.username}`}
          accessibilityRole="button"
          accessibilityLabel={t('people.a11y', { name: p.name }) + presenceA11y}
          onPress={() => onOpenPerson?.(p)}
          style={({ pressed }) => [
            styles.card,
            { userSelect: 'none', cursor: 'default' } as any,
            { borderWidth: 0, borderBottomWidth: 0, borderRadius: radius.control, paddingHorizontal: spacing.md, paddingVertical: 10, marginBottom: 2, backgroundColor: 'transparent' },
            selected && { backgroundColor: colors.rowActive },
            pressed && { opacity: 0.7 },
          ]}
        >
          <View style={styles.avatarWrap}>
            <HumanAvatar hubUrl={cfg.serverUrl} person={p} size={34} />
            {presence ? (
              <View
                testID={`person-dot-${p.username}`}
                style={[styles.statusDot, { backgroundColor: presence.online ? colors.running : colors.rest }, !presence.online && styles.statusDotOffline]}
              />
            ) : null}
            <AgentUnreadBadge badge={badge} testID={`person-unread-${p.username}`} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text dense selectable={false} style={[styles.alias, { fontSize: 13, fontWeight: '600' }]} numberOfLines={1}>{p.name}</Text>
            {rowDraft ? draftLine(rowDraft, [styles.task, { fontSize: 11 }], `draft-preview-person-${p.username}`) : subtitle ? <Text dense selectable={false} testID={`person-subtitle-${p.username}`} style={[styles.task, { fontSize: 11 }]} numberOfLines={1}>{subtitle}</Text> : null}
          </View>
        </Pressable>
      );
    }
    return (
      <Pressable
        testID={`person-row-${p.username}`}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={t('people.a11y', { name: p.name }) + presenceA11y}
        onPress={() => onOpenPerson?.(p)}
        style={({ pressed }) => [rowStyles.row, { backgroundColor: selected ? colors.rowActive : pressed ? colors.rowHover : colors.bg }]}
      >
        <View style={rowStyles.avatar}>
          <HumanAvatar hubUrl={cfg.serverUrl} person={p} size={rowGeom().avatar} fixedSize />
          {presence ? (
            <View
              testID={`person-dot-${p.username}`}
              style={[rowStyles.dot, { backgroundColor: presence.online ? colors.running : colors.rest, borderColor: selected ? colors.rowActive : colors.bg }]}
            />
          ) : null}
        </View>
        <View style={rowStyles.body}>
          <View style={rowStyles.line}>
            <Text dense selectable={false} numberOfLines={1} style={[rowStyles.name, { color: colors.text }]}>{p.name}</Text>
          </View>
          {subtitle || badge || rowDraft ? <View style={rowStyles.line}>
            {rowDraft
              ? draftLine(rowDraft, [rowStyles.preview, { color: colors.textMuted }], `draft-preview-person-${p.username}`)
              : <Text dense selectable={false} testID={`person-subtitle-${p.username}`} numberOfLines={1} style={[rowStyles.preview, { color: colors.textMuted }]}>{subtitle}</Text>}
            <AgentUnreadBadge inline badge={badge} testID={`person-unread-${p.username}`} />
          </View> : null}
        </View>
      </Pressable>
    );
  };

  // 群行(RFC-042):与人员行同一套几何。头像是「多人」图标(群没有插画);副标题 = 最后一条消息预览
  // (§10 last_message:「发信人: 正文」/「[附件] N」);Hub 没给预览 → 写时间;还没有消息写「还没有消息」。
  // 手机行的右上角是时间(微信式,与 agent 行同一个 time 样式)。
  const renderGroupRow = (g: GroupRow) => {
    const selected = selectedGroup === g.group_id;
    const badge = formatUnreadBadge(g.unread);
    const timeText = g.lastAt ? formatChatHeader(new Date(g.lastAt).toISOString()) : '';
    const subtitle = groupSubtitle(g, { selfUserId, formatTime: ms => formatChatHeader(new Date(ms).toISOString()), noMessages: t('group.noMessages') });
    const open = () => onOpenGroup?.({ group_id: g.group_id, name: g.name });
    const rowDraft = draftFor({ kind: 'group', groupId: g.group_id }, selected);
    if (compact) {
      return (
        <Pressable
          testID={`group-row-${g.group_id}`}
          accessibilityRole="button"
          accessibilityState={{ selected }}
          accessibilityLabel={t('group.a11y', { name: g.name })}
          onPress={open}
          style={({ pressed }) => [
            styles.card,
            { userSelect: 'none', cursor: 'default' } as any,
            { borderWidth: 0, borderBottomWidth: 0, borderRadius: radius.control, paddingHorizontal: spacing.md, paddingVertical: 10, marginBottom: 2, backgroundColor: 'transparent' },
            selected && { backgroundColor: colors.rowActive },
            pressed && { opacity: 0.7 },
          ]}
        >
          <View style={styles.avatarWrap}>
            <GroupAvatar size={34} />
            <AgentUnreadBadge badge={badge} testID={`group-unread-${g.group_id}`} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text dense selectable={false} style={[styles.alias, { fontSize: 13, fontWeight: '600' }]} numberOfLines={1} testID={`group-name-${g.group_id}`}>{g.name}</Text>
            {rowDraft
              ? draftLine(rowDraft, [styles.task, { fontSize: 11 }], `draft-preview-group-${g.group_id}`)
              : <Text dense selectable={false} testID={`group-subtitle-${g.group_id}`} style={[styles.task, { fontSize: 11 }]} numberOfLines={1}>{subtitle}</Text>}
          </View>
        </Pressable>
      );
    }
    return (
      <Pressable
        testID={`group-row-${g.group_id}`}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={t('group.a11y', { name: g.name })}
        onPress={open}
        style={({ pressed }) => [rowStyles.row, { backgroundColor: selected ? colors.rowActive : pressed ? colors.rowHover : colors.bg }]}
      >
        <View style={rowStyles.avatar}>
          <GroupAvatar size={rowGeom().avatar} fixedSize />
        </View>
        <View style={rowStyles.body}>
          <View style={rowStyles.line}>
            <Text dense selectable={false} numberOfLines={1} style={[rowStyles.name, { color: colors.text }]} testID={`group-name-${g.group_id}`}>{g.name}</Text>
            {g.preview && timeText ? <Text dense selectable={false} numberOfLines={1} style={[rowStyles.time, { color: colors.textMuted }]} testID={`group-time-${g.group_id}`}>{timeText}</Text> : null}
          </View>
          <View style={rowStyles.line}>
            {rowDraft
              ? draftLine(rowDraft, [rowStyles.preview, { color: colors.textMuted }], `draft-preview-group-${g.group_id}`)
              : <Text dense selectable={false} testID={`group-subtitle-${g.group_id}`} numberOfLines={1} style={[rowStyles.preview, { color: colors.textMuted }]}>{subtitle}</Text>}
            <AgentUnreadBadge inline badge={badge} testID={`group-unread-${g.group_id}`} />
          </View>
        </View>
      </Pressable>
    );
  };

  // Phone / Android two-pane row (0.2.106, WeChat-style): flat 68 dp, 44 dp avatar with the
  // online dot, name + last message on two lines, time + unread badge on the right.
  // Model (status → dot / label, time format): agent-row-model.ts.
  const renderPhoneRow = (item: Session) => {
    const pinned = pinnedAliases.includes(item.alias);
    const model = agentRowModel(item, { latest: latestByAgent[item.alias], taskAt: taskTimes.timeFor(item.alias, item.task), pinned, nowMs });
    const selected = selectedAlias === item.alias;
    const rowDraft = draftFor({ kind: 'node', alias: item.alias }, selected);
    const rowBg = selected ? colors.rowActive : colors.bg;
    const badge = rowBadge(item.alias);
    return (
      <Pressable
        testID={`agent-row-${item.alias}`}
        {...(rowMenu ? ({ dataSet: { agentAlias: item.alias } } as any) : {})}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityHint={rowMenu ? (pointer ? '右键打开会话菜单' : '长按打开会话菜单') : undefined}
        style={({ pressed }) => [
          rowStyles.row,
          // 菜单开着时,被按住的那一行保持按下态的底色(微信同款:看得出菜单是对哪一行的)。
          { backgroundColor: selected ? colors.rowActive : pressed || menuFor?.alias === item.alias ? colors.rowHover : colors.bg },
        ]}
        onPress={() => openChat(item.alias, item.network_id)}
        onLongPress={pointer ? undefined : rowMenu ? e => openRowMenu(item.alias, e.nativeEvent.pageX, e.nativeEvent.pageY) : () => onOpenNodeDetail(item.alias)}
        delayLongPress={400}
      >
        <View style={rowStyles.avatar}>
          <View style={!model.status.online ? rowStyles.avatarOffline : null}>
            <AliasAvatar alias={item.alias} size={rowGeom().avatar} fixedSize />
          </View>
          <View
            testID={`agent-dot-${item.alias}`}
            style={[rowStyles.dot, { backgroundColor: colors[model.status.dot], borderColor: rowBg }]}
          />
        </View>
        <View style={rowStyles.body}>
          <View style={rowStyles.line}>
            <Text dense selectable={false} numberOfLines={1} style={[rowStyles.name, { color: model.status.online ? colors.text : colors.textSecondary }]}>
              {item.alias}
            </Text>
            {pinned ? <Ionicons name="pin" size={12} color={colors.textMuted} accessibilityLabel="已置顶" style={rowStyles.pin} /> : null}
            {mutedAliases.includes(item.alias) ? <Ionicons name="notifications-off-outline" size={12} color={colors.textMuted} accessibilityLabel="消息免打扰" style={rowStyles.pin} testID={`agent-muted-${item.alias}`} /> : null}
            {/* #460 降级徽标(Hub 会拒收新任务);不知道时不画。 */}
            <DegradedBadge info={nodeDegraded(item)} testID={`agent-degraded-${item.alias}`} />
            <Text dense selectable={false} numberOfLines={1} style={[rowStyles.time, { color: colors.textMuted }]}>{model.time}</Text>
          </View>
          {/* No second line when there is nothing to say (and no badge): the name then centres. */}
          {model.status.label || model.preview || badge || rowDraft ? <View style={rowStyles.line}>
            {model.status.label && model.status.labelTone ? (
              <Text dense selectable={false} style={[rowStyles.label, { color: colors[model.status.labelTone] }]}>{model.status.label}</Text>
            ) : null}
            {rowDraft
              ? draftLine(rowDraft, [rowStyles.preview, { color: colors.textMuted }], `draft-preview-${item.alias}`)
              : <Text dense selectable={false} numberOfLines={1} style={[rowStyles.preview, { color: colors.textMuted }]}>{model.preview}</Text>}
            <AgentUnreadBadge inline badge={badge} testID={`unread-badge-${item.alias}`} />
          </View> : null}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: compact ? colors.listBg : colors.bg }}>
      {/* Everything above the list (head + filter bar): its height is where the first group header starts. */}
      <View onLayout={alignFirstRow ? e => { listYRef.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height; publishFirstRowTop(); } : undefined}>
      {compact ? (
        <View testID="agents-list-head" style={{ paddingHorizontal: compact ? spacing.sm : spacing.lg, paddingTop: compact ? spacing.sm : spacing.lg, backgroundColor: compact ? colors.listBg : colors.bg }}>
        <View style={styles.listHeaderRow}>
          <Text style={styles.listHeader}>
            {q ? `${shownCount} / ${sessions.length} agents` : `${sessions.length} agents`}
          </Text>
          <Pressable onPress={onOpenPicker} hitSlop={10} accessibilityLabel="新建节点" style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.6 }]}>
            <Ionicons name="add" size={24} color={colors.accent} />
          </Pressable>
        </View>
        {sessions.length > 10 || searchOpen || query ? (
          <TextInput ref={searchRef} testID="agents-search" style={[styles.search, compact && { backgroundColor: colors.subtleFill, borderWidth: 0, borderRadius: radius.control }]} placeholder={t('chat.searchAgent')} placeholderTextColor={colors.textMuted} autoCapitalize="none" autoCorrect={false} value={query} onChangeText={setQuery} onBlur={() => { if (!query) setSearchOpen(false); }} />
        ) : null}
      </View>
      ) : (
        <View testID="agents-list-head" style={[rowStyles.head, { backgroundColor: colors.bg }]}>
          <View style={rowStyles.headRow}>
            {sessions.length > 10 ? (
              <View style={[rowStyles.searchBox, { backgroundColor: colors.subtleFill }]}>
                <Ionicons name="search" size={16} color={colors.textMuted} />
                <TextInput
                  style={[rowStyles.searchInput, { color: colors.text }]}
                  placeholder={`搜索 ${sessions.length} 个 agent`}
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={query}
                  onChangeText={setQuery}
                />
              </View>
            ) : (
              <Text style={[styles.listHeader, { flex: 1 }]}>{`${sessions.length} agents`}</Text>
            )}
            <Pressable onPress={onOpenPicker} hitSlop={10} accessibilityLabel="新建节点" style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.6 }]}>
              <Ionicons name="add" size={24} color={colors.accent} />
            </Pressable>
          </View>
          {q ? <Text style={[styles.listHeader, rowStyles.searchCount]}>{`${shownCount} / ${sessions.length} agents`}</Text> : null}
        </View>
      )}
      {showTabs ? (
        // 飞书 / 微信的位置:搜索框下面、列表上面,左缘对齐行的头像(手机 = 行的 padX;桌面侧栏 = 列表内边距 + 行内边距)。
        <View testID="conversation-tabs-bar" style={[rowStyles.tabsBar, compact ? rowStyles.tabsBarCompact : null, { backgroundColor: compact ? colors.listBg : colors.bg }]}>
          <View testID="conversation-tabs" accessibilityRole="tablist" accessibilityLabel={t('chat.tabsLabel')} style={[rowStyles.tabsTrack, { backgroundColor: colors.subtleFill }]}>
            {CONVERSATION_TABS.map(k => {
              const on = tab === k;
              const n = k === 'unread' ? formatTabCount(unreadTabCount) : '';
              const label = k === 'all' ? t('chat.tabAll') : k === 'working' ? t('chat.tabWorking') : t('chat.tabUnread');
              return (
                <Pressable
                  key={k}
                  testID={`conversation-tab-${k}`}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  {...({ 'aria-selected': on } as any)}
                  accessibilityLabel={n ? `${label} ${n}` : label}
                  onPress={() => setTab(k)}
                  style={({ hovered }: any) => [
                    rowStyles.tabSeg,
                    on ? [rowStyles.tabSegOn, { backgroundColor: themeMode() === 'dark' ? colors.rowActive : colors.card }] : hovered && { backgroundColor: colors.rowHover },
                  ]}
                >
                  <View style={rowStyles.tabLabel}>
                    <Text dense selectable={false} numberOfLines={1} style={[rowStyles.tabText, { color: on ? colors.accent : colors.textSecondary }, on && rowStyles.tabTextOn]}>{label}</Text>
                    {n ? <Text dense selectable={false} numberOfLines={1} testID={`conversation-tab-${k}-count`} style={[rowStyles.tabText, { color: on ? colors.accent : colors.textSecondary }, on && rowStyles.tabTextOn]}>{n}</Text> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
      {filtering ? (
        <View testID="agent-filter-bar" style={[rowStyles.filterBar, { backgroundColor: compact ? colors.listBg : colors.bg }]}>
          {(['all', 'online', 'working', 'error', 'offline'] as const).map(k => {
            const on = k === 'all' ? !activeFilter?.status : activeFilter?.status === k;
            return (
              <Pressable
                key={k}
                testID={`agent-filter-${k}`}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setActiveFilter(f => ({ ...f, status: k === 'all' ? undefined : (k as AgentStatusFilter) }))}
                style={[rowStyles.filterChip, { backgroundColor: on ? colors.railActiveBg : colors.subtleFill }]}
              >
                <Text style={[rowStyles.filterChipText, { color: on ? colors.accent : colors.textSecondary }]}>{k === 'all' ? '全部' : STATUS_FILTER_LABEL[k]}</Text>
              </Pressable>
            );
          })}
          {activeFilter?.host ? (
            <View testID="agent-filter-host" style={[rowStyles.filterChip, { backgroundColor: colors.railActiveBg }]}>
              <Text style={[rowStyles.filterChipText, { color: colors.accent }]}>{`机器 ${activeFilter.hostLabel || activeFilter.host}`}</Text>
            </View>
          ) : null}
          {activeFilter?.group ? (
            <View style={[rowStyles.filterChip, { backgroundColor: colors.railActiveBg }]}>
              <Text style={[rowStyles.filterChipText, { color: colors.accent }]}>{`分组 ${activeFilter.group}`}</Text>
            </View>
          ) : null}
          <Pressable testID="agent-filter-clear" accessibilityRole="button" accessibilityLabel="清除筛选" hitSlop={8} onPress={() => setActiveFilter(null)} style={rowStyles.filterClear}>
            <Text style={[rowStyles.filterChipText, { color: colors.textMuted }]}>{`${shownCount} 个`}</Text>
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </Pressable>
        </View>
      ) : null}
      </View>
      <SectionList
      sections={shownSections}
      keyExtractor={s => s.alias}
      onScroll={markListActive}
      scrollEventThrottle={100}
      stickySectionHeadersEnabled={false}
      renderSectionHeader={({ section }) => (
        // Small section label + online/total; tap folds the group (not 新消息, not while searching).
        <Pressable
          onLayout={alignFirstRow && section === shownSections[0] ? e => { firstHeaderHRef.current = e.nativeEvent.layout.height; publishFirstRowTop(); } : undefined}
          testID={`agent-group-${section.title}`}
          disabled={!section.collapsible}
          onPress={() => toggleGroup(section.title)}
          accessibilityRole={section.collapsible ? 'button' : 'header'}
          accessibilityLabel={`${section.title} ${section.online}/${section.total} 在线${section.collapsible ? (section.collapsed ? ',已折叠' : ',已展开') : ''}`}
          accessibilityState={section.collapsible ? { expanded: !section.collapsed } : undefined}
          style={[rowStyles.group, compact ? rowStyles.groupCompact : null, { backgroundColor: compact ? colors.listBg : colors.bg }]}
        >
          {section.collapsible ? (
            <Ionicons name={section.collapsed ? 'chevron-forward' : 'chevron-down'} size={12} color={colors.textMuted} />
          ) : null}
          <Text selectable={false} numberOfLines={1} style={[rowStyles.groupTitle, { color: colors.textMuted }]}>{section.title}</Text>
          <Text selectable={false} style={[rowStyles.groupCount, { color: colors.textMuted }]}>{section.online}/{section.total}</Text>
        </Pressable>
      )}
      ItemSeparatorComponent={compact ? undefined : () => (
        <View style={[rowStyles.separator, { backgroundColor: colors.border }]} />
      )}
      // Perf (render time): the real fleet is 150+ agents. Without these the
      // default virtualization renders/retains far more rows than fit on
      // screen, spiking first-paint cost and scroll jank. Cap the initial
      // batch to ~one screenful and shrink the retained window. (Deliberately
      // NOT using removeClippedSubviews — it can blank rows / break taps on
      // some RN versions, and correctness beats the marginal extra saving.)
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={9}
      updateCellsBatchingPeriod={50}
      contentContainerStyle={compact ? { paddingHorizontal: spacing.sm, paddingBottom: spacing.sm } : { paddingBottom: spacing.sm }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor={colors.accent}
        />
      }
      ListEmptyComponent={effectiveTab === 'working' ? (
        <View style={styles.center} testID="agents-empty-working">
          <Text style={styles.errorTitle}>{q ? t('chat.workingSearchEmpty') : t('chat.workingEmpty')}</Text>
          <Text style={styles.errorHint}>{t('chat.workingEmptyHint')}</Text>
          <Pressable testID="agents-empty-working-show-all" style={styles.retryBtn} onPress={() => setTab('all')}>
            <Text style={styles.retryBtnText}>{t('chat.showAll')}</Text>
          </Pressable>
        </View>
      ) : effectiveTab === 'unread' && !q && !filtering ? (
        // 未读视图空了:说清楚是「没有未读」,不是列表挂了;一键回到「全部」。人员区块里还有未读私信时不出现。
        peopleShown.rows.length || groupsMatched.length ? null : (
          <View style={styles.center} testID="agents-empty-unread">
            <Text style={styles.errorTitle}>{t('chat.unreadEmpty')}</Text>
            <Text style={styles.errorHint}>{t('chat.unreadEmptyHint')}</Text>
            <Pressable testID="agents-empty-unread-show-all" style={styles.retryBtn} onPress={() => setTab('all')}>
              <Text style={styles.retryBtnText}>{t('chat.showAll')}</Text>
            </Pressable>
          </View>
        )
      ) :
        // 搜不到时必须说出"为什么空",否则用户分不清「搜挂了」和「真没有」
        // ——空白屏是这两种情况唯一相同的表现。加载中/加载失败在上面的
        // early return 里已经各自有屏,走到这里必然是"数据到了但没有匹配"。
        <View style={styles.center} testID={`agents-empty-${agentsEmptyKind({ query: q, filtering, restricted })}`}>
          <Text style={[styles.errorTitle, !q && !filtering && restricted && restrictedEmptyCopy()]}>
            {q ? `没有匹配「${q}」的 agent` : filtering ? `没有「${filterLabel(activeFilter!)}」的 agent` : restricted ? t('agents.restrictedEmpty') : '还没有 agent'}
          </Text>
          <Text style={[styles.errorHint, !q && !filtering && restricted && restrictedEmptyCopy()]}>
            {q
              ? `已在 ${sessions.length} 个 agent 里搜过(支持拼音,如 zf → 支付助手)`
              : restricted && !filtering ? t('agents.restrictedHint') : '用右上角 + 新建一个'}
          </Text>
          {q ? (
            <Pressable style={styles.retryBtn} onPress={() => setQuery('')}>
              <Text style={styles.retryBtnText}>清空搜索</Text>
            </Pressable>
          ) : filtering ? (
            <Pressable style={styles.retryBtn} onPress={() => setActiveFilter(null)}>
              <Text style={styles.retryBtnText}>清除筛选</Text>
            </Pressable>
          ) : null}
        </View>
      }
      renderItem={({ item }) => (compact ? renderCompactRow(item) : renderPhoneRow(item))}
      ListHeaderComponent={groupsVisible || peopleShown.visible || (compact && managedDepts.ids.length) || registeredRows.length > 0 ? (<>
        <RegisteredAgentsSection
          rows={registeredRows}
          loaded={agentDirectory.loaded}
          collapsed={registeredCollapsed}
          onToggle={() => setRegisteredCollapsed(v => !v)}
          compact={compact}
        />
        {compact && managedDepts.ids.length ? (
          // 「管理本部门」:只给部门负责人,放在「人员」上方(RFC-040 §6)。只在桌面侧栏(compact)出现 —— 手机在「设置」里。
          <Pressable testID="manage-dept-entry" accessibilityRole="button" accessibilityLabel={t('dept.manage')} onPress={() => setManageDeptOpen(true)}
            style={state => [{ minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, backgroundColor: colors.listBg }, ((state as { hovered?: boolean }).hovered || state.pressed) ? { backgroundColor: colors.rowHover } : null]}>
            <ManageDepartmentIcon size={16} />
            <Text selectable={false} numberOfLines={1} style={{ flex: 1, color: colors.text, fontSize: 13 }}>{t('dept.manage')}</Text>
            <Ionicons name="chevron-forward" size={12} color={colors.textMuted} />
          </Pressable>
        ) : null}
        {groupsVisible ? (
        // 群聊(RFC-042,Hub ≥ .93):部门群等。放在「人员」上面,和私信一起是「人」的会话;可折叠(与分组同存)。
        <View testID="groups-section" onLayout={alignFirstRow ? e => { groupsSectionHRef.current = e.nativeEvent.layout.height; publishFirstRowTop(); } : undefined}>
          <Pressable
            onLayout={alignFirstRow ? e => { groupsHeaderHRef.current = e.nativeEvent.layout.height; publishFirstRowTop(); } : undefined}
            testID="groups-header"
            disabled={!!query.trim()}
            onPress={() => toggleGroup(GROUPS_KEY)}
            accessibilityRole={query.trim() ? 'header' : 'button'}
            accessibilityLabel={`${t('group.title')} ${groupsMatched.length}${query.trim() ? '' : groupsCollapsed ? ',已折叠' : ',已展开'}`}
            accessibilityState={query.trim() ? undefined : { expanded: !groupsCollapsed }}
            style={[rowStyles.group, compact ? rowStyles.groupCompact : null, { backgroundColor: compact ? colors.listBg : colors.bg }]}
          >
            {query.trim() ? null : <Ionicons name={groupsCollapsed ? 'chevron-forward' : 'chevron-down'} size={12} color={colors.textMuted} />}
            <Text selectable={false} numberOfLines={1} style={[rowStyles.groupTitle, { color: colors.textMuted }]}>{t('group.title')}</Text>
            <Text selectable={false} style={[rowStyles.groupCount, { color: colors.textMuted }]} testID="groups-count">{groupsMatched.length}</Text>
          </Pressable>
          {groupsShown.map((g, i) => (
            <View key={g.group_id}>
              {i && !compact ? <View style={[rowStyles.separator, { backgroundColor: colors.border }]} /> : null}
              {renderGroupRow(g)}
            </View>
          ))}
        </View>
        ) : null}
        {peopleShown.visible ? (
        // 人员:同网络的其他人,点开是私信。放在列表**最上面**、搜索框之下、agent 分组之上(Vincent 2026-09-30
        // 「这个人员放太下面了」)。可折叠(每台设备各记各的),标题带人数;搜索时按名字过滤、不可折叠。
        <View testID="people-section" onLayout={alignFirstRow ? e => { peopleSectionHRef.current = e.nativeEvent.layout.height; publishFirstRowTop(); } : undefined}>
          <Pressable
            onLayout={alignFirstRow ? e => { peopleHeaderHRef.current = e.nativeEvent.layout.height; publishFirstRowTop(); } : undefined}
            testID="people-header"
            disabled={!peopleShown.collapsible}
            onPress={() => toggleGroup(PEOPLE_GROUP_KEY)}
            accessibilityRole={peopleShown.collapsible ? 'button' : 'header'}
            accessibilityLabel={`${t('people.title')} ${peopleShown.total}${peopleShown.collapsible ? (peopleShown.collapsed ? ',已折叠' : ',已展开') : ''}`}
            accessibilityState={peopleShown.collapsible ? { expanded: !peopleShown.collapsed } : undefined}
            style={[rowStyles.group, compact ? rowStyles.groupCompact : null, { backgroundColor: compact ? colors.listBg : colors.bg }]}
          >
            {peopleShown.collapsible ? (
              <Ionicons name={peopleShown.collapsed ? 'chevron-forward' : 'chevron-down'} size={12} color={colors.textMuted} />
            ) : null}
            <Text selectable={false} numberOfLines={1} style={[rowStyles.groupTitle, { color: colors.textMuted }]}>{t('people.title')}</Text>
            <Text selectable={false} style={[rowStyles.groupCount, { color: colors.textMuted }]} testID="people-count">{peopleShown.total}</Text>
          </Pressable>
          {peopleGroups ? peopleGroups.map((g, gi) => (
            <View key={g.key ?? '__none'} testID={`people-dept-${g.key ?? 'none'}`}>
              <View onLayout={gi === 0 && alignFirstRow ? e => { peopleGroupHeadHRef.current = e.nativeEvent.layout.height; publishFirstRowTop(); } : undefined}
                style={{ paddingHorizontal: compact ? 12 : 16, paddingTop: 6, paddingBottom: 2, backgroundColor: compact ? colors.listBg : colors.bg }}>
                <Text selectable={false} numberOfLines={1} style={{ color: colors.textMuted, fontSize: 11 }} testID={`people-dept-title-${g.key ?? 'none'}`}>{g.title ?? t('people.noDept')}</Text>
              </View>
              {g.people.map((p, i) => (
                <View key={p.user_id}>
                  {i && !compact ? <View style={[rowStyles.separator, { backgroundColor: colors.border }]} /> : null}
                  {renderPersonRow(p)}
                </View>
              ))}
            </View>
          )) : peopleShown.rows.map((p, i) => (
            <View key={p.user_id}>
              {i && !compact ? <View style={[rowStyles.separator, { backgroundColor: colors.border }]} /> : null}
              {renderPersonRow(p)}
            </View>
          ))}
        </View>
        ) : null}
      </>) : null}
      ListFooterComponent={<>{hiddenSessions.length && effectiveTab === 'all' ? (
        // 「不显示该对话」收在这里:列表最底下一行入口,点开就地展开,每行长按 → 恢复显示(点开会话也会恢复)。
        <View testID="agent-hidden-footer">
          <Pressable
            testID="agent-hidden-toggle"
            accessibilityRole="button"
            accessibilityState={{ expanded: showHidden }}
            accessibilityLabel={`已隐藏的对话 ${hiddenSessions.length} 个,${showHidden ? '已展开' : '已折叠'}`}
            onPress={() => setShowHidden(v => !v)}
            style={[rowStyles.group, compact ? rowStyles.groupCompact : null, { backgroundColor: compact ? colors.listBg : colors.bg }]}
          >
            <Ionicons name={showHidden ? 'chevron-down' : 'chevron-forward'} size={12} color={colors.textMuted} />
            <Text selectable={false} numberOfLines={1} style={[rowStyles.groupTitle, { color: colors.textMuted }]}>已隐藏的对话</Text>
            <Text selectable={false} style={[rowStyles.groupCount, { color: colors.textMuted }]}>{hiddenSessions.length}</Text>
          </Pressable>
          {showHidden ? hiddenSessions.map(item => (
            <View key={item.alias}>{compact ? renderCompactRow(item) : renderPhoneRow(item)}</View>
          )) : null}
        </View>
      ) : null}</>}
      />
      {rowMenu ? (
        <AgentRowMenu target={menuFor} items={menuItems} touch={!pointer} onSelect={onRowMenu} onClose={() => setMenuFor(null)} />
      ) : null}
      {manageDeptOpen && cfg.networkId ? (
        <ManageDepartmentDesktop cfg={cfg} networkId={cfg.networkId} networkName={managedDepts.networkName} managed={managedDepts.ids} onClose={() => setManageDeptOpen(false)} />
      ) : null}
    </View>
  );
}

// Phone / two-pane list chrome (0.2.106). No colours here — they are passed inline from `colors` at
// render time. Rebuilt on every restyle (theme or 界面密度, src/ui-scale.ts): the row geometry goes
// through ds(), and `spacing` itself is density-scaled.
const rowGeom = () => agentRowGeometry(uiScale().listDense, uiScale().densityFactor);
const makeRowStyles = () => ({
  head: { paddingHorizontal: ds(AGENT_ROW_PAD_X), paddingTop: spacing.sm, paddingBottom: spacing.xs },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: ds(36) },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: ds(6), minHeight: ds(36), borderRadius: radius.control, paddingHorizontal: ds(10) },
  searchInput: { flex: 1, minWidth: 0, fontSize: type.body, paddingVertical: 0, height: Math.max(ds(36), fs(type.body) + 14) },
  searchCount: { marginTop: spacing.xs },
  // 服务器页带来的筛选:一行小胶囊,只在有筛选时出现(平时列表不变)。
  filterBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingHorizontal: ds(AGENT_ROW_PAD_X), paddingVertical: spacing.xs },
  filterChip: { minHeight: ds(26), borderRadius: radius.pill, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  filterChipText: { fontSize: type.small, fontWeight: weight.medium },
  filterClear: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto' },
  // 「全部 / 未读 N」:左缘 = 行头像的左缘(手机 padX;桌面侧栏 = 列表 sm + 行 md)。飞书同款胶囊轨道 + 选中段浮起。
  tabsBar: { flexDirection: 'row', paddingHorizontal: rowGeom().padX, paddingTop: spacing.xs, paddingBottom: spacing.xs },
  tabsBarCompact: { paddingHorizontal: spacing.sm + spacing.md },
  tabsTrack: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.pill, padding: 3, gap: 2 },
  tabSeg: { minHeight: ds(28), minWidth: ds(56), paddingHorizontal: ds(14), borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  tabSegOn: themeMode() === 'dark' ? {} : { ...shadowOnly('raised') },
  tabLabel: { flexDirection: 'row', alignItems: 'center', gap: ds(4) },
  tabText: { fontSize: type.small, fontWeight: weight.medium },
  tabTextOn: { fontWeight: weight.strong },
  group: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: rowGeom().padX, paddingTop: rowGeom().groupPadTop, paddingBottom: rowGeom().groupPadBottom },
  groupCompact: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  groupTitle: { flexShrink: 1, ...listText('meta'), fontWeight: weight.medium, letterSpacing: 0.4 },
  groupCount: { ...listText('count'), marginLeft: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: rowGeom().gap,
    // agentRowGeometry (agent-row-model.ts): 标准 68 dp / 44 dp avatar; 紧凑 58 / 37; 宽松 78 / 51;
    // 更紧凑 (the Android wide default) 44 / 28 with 14/18 + 12/16 text — the rail's scale. Two text
    // lines + 2 × padY can make a row taller than minHeight (OS font 1.15), never shorter than 44.
    // 更紧凑: every row is exactly the pitch (one- and two-line rows alike) so the rail can match it.
    ...(uiScale().listDense ? { height: denserRowPitch(uiScale().denseFontMultiplier) } : { minHeight: rowGeom().height }),
    paddingHorizontal: rowGeom().padX,
    paddingVertical: rowGeom().padY,
  },
  // AliasAvatar gets the same resolved size with fixedSize, so the dot sits on the avatar's corner.
  avatar: { width: rowGeom().avatar, height: rowGeom().avatar },
  avatarOffline: { opacity: 0.45 },
  dot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: rowGeom().dot,
    height: rowGeom().dot,
    borderRadius: radius.pill,
    borderWidth: 2,
  },
  body: { flex: 1, minWidth: 0, gap: rowGeom().bodyGap },
  line: { flexDirection: 'row', alignItems: 'center', gap: ds(6), minHeight: rowGeom().lineMin },
  // listText(): 16 / 14 / 12 at 紧凑·标准·宽松; 14 / 12 / 10 at 更紧凑 (time + group = the rail label).
  name: { flexShrink: 1, ...listText('name'), fontWeight: weight.medium },
  pin: { marginLeft: -2 },
  // #683: the time never shrinks — the name (flexShrink 1) is the part that gives way. RN-web Text is a CSS flex item
  // with flex-shrink 1 unless told otherwise, so this has to be explicit for the desktop shell too.
  time: { marginLeft: 'auto', ...listText('meta'), paddingLeft: spacing.sm, flexShrink: 0 },
  label: { ...listText('meta'), fontWeight: weight.medium },
  preview: { flex: 1, minWidth: 0, ...listText('preview') },
  // 更紧凑: the hairline overlaps the row above (negative margin) so the row pitch is exactly the
  // row height — the rail's item pitch is set to the same number (list-rail-align.ts).
  separator: { height: StyleSheet.hairlineWidth, marginLeft: rowGeom().padX + rowGeom().avatar + rowGeom().gap, ...(rowGeom().separatorOverlap ? { marginTop: -StyleSheet.hairlineWidth } : null) },
} as const);
let rowStyles = makeRowStyles();
onThemeChange(() => { rowStyles = makeRowStyles(); });
