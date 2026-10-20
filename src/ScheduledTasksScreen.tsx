import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ionicons } from './icons';
import { ActivityIndicator, Alert, BackHandler, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, View, useWindowDimensions } from 'react-native';
import { Text, TextInput } from './ui-text';
import {
  cancelScheduledTask,
  createExternalScheduleEdit,
  fetchExternalScheduleEdits,
  fetchExternalSchedules,
  fetchHubNodes,
  fetchScheduledRuns,
  fetchTaskDetail,
  fetchScheduledTasks,
  HubConfig,
  HubExternalSchedule,
  HubExternalScheduleEditIntent,
  HubNode,
  HubNodeExternalSchedules,
  HubScheduledRun,
  HubScheduledTask,
  ScheduledTaskError,
  runScheduledTaskNow,
  selectOpenIntents,
  setScheduledTaskStatus,
} from './api';
import AliasAvatar from './AliasAvatar';
import { pointerUi } from './pointer-ui';
import { colors, onThemeChange, radius, spacing, type as fontSize, weight } from './theme';
import { pinyinMatch } from './lib/pinyin';
import { scheduledTaskActions } from './scheduled-task-actions';
import type { ScheduleOpenRequest } from './node-schedules';
import ScheduleRunResult, { type RunTaskState } from './ScheduleRunResult';
import ScheduleContentFullscreen, { type ScheduleContentDraft } from './ScheduleContentFullscreen';
import { contentDirty } from './schedule-content-edit';
import { runDisplay, runDurationText, runFailureText, runIsOpen } from './schedule-run-result';
import { groupScheduleRuns, skipGroupText, skipGroupTimes } from './schedule-run-groups';
import { useTranslation } from './i18n-react';
import {
  DEFAULT_SCHEDULE_FILTER,
  EXTERNAL_KIND_LABEL,
  EXTERNAL_STATUS_LABEL,
  INTENT_STATUS_LABEL,
  countByStatus,
  describeMisfire,
  describeSchedule,
  emptyStateFor,
  externalEmptyState,
  externalEnabledChips,
  externalNodeOptions,
  externalSchedulesMatching,
  externalScopeActive,
  filterChips,
  filterExternalNodes,
  filterNodeOptions,
  formatAbsolute,
  formatRelative,
  isMasterDetail,
  masterListWidth,
  nodeFilterLabel,
  reconcileNodeFilter,
  reconcileSelection,
  scheduleNodeOptions,
  scheduleRowModel,
  scheduleStatusMeta,
  schedulesInScope,
  scopeNarrows,
  visibleSchedules,
} from './scheduled-view-model';
import type { ExternalEnabledFilter, ScheduleFilter, ScheduleNodeOption } from './scheduled-view-model';
import { elevated } from './elevation';
import './i18n-schedules';
// 编辑器(表单 + 外壳 + 确认框)与节点页共用:ScheduleEditor.tsx。
import ScheduleEditor, { CancelScheduleModal, DEVICE_TIMEZONE, Label, ScheduleModal, StatusPill, fmt, scheduleStyleDefs } from './ScheduleEditor';

export { scheduleDialogSize } from './ScheduleEditor';

/** 与 Hub 端 parseManagedCronExpression 同一形状预检（五段、字符白名单），
 *  只为把明显敲错的输入挡在本地；权威校验仍在 Hub。 */
const looksLikeCron = (raw: string) => {
  const fields = raw.trim().split(/ +/);
  return fields.length === 5 && fields.every(f => /^[0-9*/,-]+$/.test(f));
};

const describeIntentPatch = (patch: HubExternalScheduleEditIntent['patch']) => [
  patch.enabled !== undefined ? (patch.enabled ? '启用' : '停用') : null,
  patch.cron ? `cron → ${patch.cron}` : null,
].filter(Boolean).join('，') || '—';

export const editIntentErrorText = (e: unknown): string => {
  if (e instanceof ScheduledTaskError) {
    if (e.code === 'revision_conflict') return '计划在节点侧已变化，列表已刷新，请重新操作。';
    if (e.code === 'edit_in_flight') return '已有一条待应用的编辑意向，等节点确认后再试。';
    if (e.code === 'schedule_read_only') return '该计划为只读（仅托管 cron 条目可改）。';
    if (e.code === 'node_owner_required' || e.code === 'node_owner_unclaimed') return '仅节点 owner 能修改该节点的计划。';
    if (e.code === 'watcher_cannot_cancel') return '关注人不能取消这条计划。';
    if (e.code === 'watcher_cannot_manage_watchers') return '只有创建者能修改关注人。';
    if (e.code === 'watcher_not_in_network') return '关注人必须是这个网络里的人。';
    if (e.code === 'cross_network_node') return '节点不在当前网络内。';
  }
  return e instanceof Error ? e.message : String(e);
};


type ScheduleAction = 'toggle' | 'run' | 'cancel';

export default function ScheduledTasksScreen({ cfg, onOpenChat, open }: {
  cfg: HubConfig;
  /** 「去会话」:打开与该节点的会话,并尽量定位到这次执行的那条任务。 */
  onOpenChat?: (alias: string, taskId?: string) => void;
  /** 从节点页「定时任务」分区来:落在那一条(Hub 计划选中并显示详情;节点计划滚到并高亮),或直接打开预填了该节点的新建表单。 */
  open?: ScheduleOpenRequest;
}) {
  const [themeVersion, setThemeVersion] = useState(0);
  useEffect(() => onThemeChange(() => setThemeVersion(v => v + 1)), []);
  const styles = useMemo(makeStyles, [themeVersion]);
  const [items, setItems] = useState<HubScheduledTask[]>([]);
  const [nodes, setNodes] = useState<HubNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<HubScheduledTask | null>(null);
  // 「复制」:用这条预填**新建**表单(不是编辑表单),保存走 POST,源计划不动。
  const [copySource, setCopySource] = useState<HubScheduledTask | null>(null);
  const [cancelCandidate, setCancelCandidate] = useState<HubScheduledTask | null>(null);
  // 任务内容的全屏编辑(ScheduleContentFullscreen):草稿按计划存,没保存就退出全屏也不丢(卡片上「继续编辑 / 放弃修改」)。
  // base 是打开时那一份 —— 列表 10 秒轮询换的是 items,不动草稿;保存时按 base.revision 走 409 处理。
  const [contentDrafts, setContentDrafts] = useState<Record<string, ScheduleContentDraft>>({});
  const [contentOpen, setContentOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<'hub' | 'node'>('hub');
  const [filter, setFilter] = useState<ScheduleFilter>(DEFAULT_SCHEDULE_FILTER);
  // 两个 tab 各记一份:切走再回来,搜索和节点筛选还在。节点计划的「状态」是快照上的启用/停用。
  const [hubQuery, setHubQuery] = useState('');
  const [hubNodeId, setHubNodeId] = useState('');
  const [extQuery, setExtQuery] = useState('');
  const [extNodeId, setExtNodeId] = useState('');
  const [extEnabled, setExtEnabled] = useState<ExternalEnabledFilter>('all');
  const [nodePicker, setNodePicker] = useState<'hub' | 'node' | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<{ id: string; runs: HubScheduledRun[]; error: string } | null>(null);
  // 执行记录展开的那一行 + 每条执行绑定任务的读取结果(按 task_id;只读展开的和还没结束的)。
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [runTasks, setRunTasks] = useState<Record<string, RunTaskState>>({});
  const [external, setExternal] = useState<HubNodeExternalSchedules[]>([]);
  const [externalLoaded, setExternalLoaded] = useState(false);
  const [cronEdit, setCronEdit] = useState<{ node: HubNodeExternalSchedules; schedule: HubExternalSchedule } | null>(null);
  const [intents, setIntents] = useState<{ title: string; edits: HubExternalScheduleEditIntent[] } | null>(null);
  const [openIntents, setOpenIntents] = useState<Record<string, HubExternalScheduleEditIntent>>({});
  // 节点页带过来的落点:Hub 计划等列表到了再选中(要先把筛选切到它的状态);节点计划记下键,渲染时高亮 + 滚到。
  const [pendingHubFocus, setPendingHubFocus] = useState<string | null>(null);
  const [focusedExternal, setFocusedExternal] = useState<string | null>(null);
  const [createTarget, setCreateTarget] = useState<string | undefined>(undefined);
  const nodeListRef = useRef<ScrollView>(null);
  const externalOffsets = useRef<{ cards: Record<string, number>; rows: Record<string, number> }>({ cards: {}, rows: {} });
  // 双栏按本屏实际宽度判断(Android 展开时本屏在导航栏右侧,不是整窗宽)。
  const { width: windowWidth } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const wide = isMasterDetail(measuredWidth ?? windowWidth);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const [scheduleData, nodeData] = await Promise.all([fetchScheduledTasks(cfg), fetchHubNodes(cfg)]);
      setItems(scheduleData.schedules || []);
      setNodes((nodeData.nodes || []).filter(n => n.node_id && n.alias));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [cfg]);

  const loadExternal = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const rows = await fetchExternalSchedules(cfg);
      setExternal(rows);
      // 只查带托管条目的节点；非 owner 的 GET 会 403（node_owner_required）——
      // 静默跳过，代价只是那台节点看不到在途意向徽标。
      const lists = await Promise.all(rows.filter(n => n.schedules.some(x => x.editable === true)).map(async n => {
        try { return (await fetchExternalScheduleEdits(cfg, n.node_id)).edits || []; }
        catch { return []; }
      }));
      setOpenIntents(selectOpenIntents(lists.flat(), Date.now()));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExternalLoaded(true); setRefreshing(false);
    }
  }, [cfg]);

  useEffect(() => {
    const tick = tab === 'hub' ? load : loadExternal;
    void tick();
    const timer = setInterval(tick, 10_000);
    return () => clearInterval(timer);
  }, [tab, load, loadExternal]);

  useEffect(() => {
    if (!open) return;
    if (open.kind === 'create') { setTab('hub'); setEditing(null); setCopySource(null); setCreateTarget(open.nodeId); setShowForm(true); return; }
    if (open.kind === 'hub') { setTab('hub'); setPendingHubFocus(open.scheduleId); return; }
    setTab('node'); setExtQuery(''); setExtNodeId(''); setExtEnabled('all'); setFocusedExternal(`${open.nodeId}:${open.scheduleId}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.seq]);

  useEffect(() => {
    if (!pendingHubFocus || loading) return;
    const row = items.find(item => item.schedule_id === pendingHubFocus);
    // 从节点页落进来时清掉搜索和节点筛选,否则那一条可能被滤掉、选不中。
    setHubQuery('');
    setHubNodeId('');
    if (row) { setFilter(row.status); setSelectedId(row.schedule_id); }
    setPendingHubFocus(null);
  }, [pendingHubFocus, loading, items]);

  // 节点计划的落点:卡片在列表里的 y + 行在卡片里的 y,两个都量到了才滚(只滚一次)。
  const scrollToFocusedExternal = () => {
    if (!focusedExternal) return;
    const nodeId = focusedExternal.slice(0, focusedExternal.indexOf(':'));
    const cardY = externalOffsets.current.cards[nodeId];
    const rowY = externalOffsets.current.rows[focusedExternal];
    if (cardY === undefined || rowY === undefined) return;
    nodeListRef.current?.scrollTo({ y: Math.max(0, cardY + rowY - spacing.lg), animated: false });
  };

  const hubNodeOptions = useMemo(() => scheduleNodeOptions(items), [items]);
  const hubNodeIdLive = reconcileNodeFilter(hubNodeOptions, hubNodeId);
  const hubScope = useMemo(() => ({ query: hubQuery, nodeId: hubNodeIdLive }), [hubQuery, hubNodeIdLive]);
  const hubScoped = useMemo(() => schedulesInScope(items, hubScope), [items, hubScope]);
  const hubNarrowed = scopeNarrows(hubScope);
  const counts = useMemo(() => countByStatus(hubScoped), [hubScoped]);
  const visible = useMemo(() => visibleSchedules(hubScoped, filter), [hubScoped, filter]);
  const extNodeOptions = useMemo(() => externalNodeOptions(external), [external]);
  const extNodeIdLive = reconcileNodeFilter(extNodeOptions, extNodeId);
  const extTextScope = useMemo(() => ({ query: extQuery, nodeId: extNodeIdLive }), [extQuery, extNodeIdLive]);
  const extMatching = useMemo(() => externalSchedulesMatching(external, extTextScope), [external, extTextScope]);
  const extVisible = useMemo(() => filterExternalNodes(external, { ...extTextScope, enabled: extEnabled }), [external, extTextScope, extEnabled]);
  const extNarrowed = externalScopeActive({ ...extTextScope, enabled: extEnabled });
  const pickerOptions = nodePicker === 'node' ? extNodeOptions : hubNodeOptions;
  const pickerSelected = nodePicker === 'node' ? extNodeIdLive : hubNodeIdLive;
  const pickerAllCount = nodePicker === 'node' ? external.reduce((sum, node) => sum + node.schedules.length, 0) : items.length;
  // 选中项由当前筛选派生:宽屏总有一条(第一条),窄屏只有点过才有。
  const activeId = reconcileSelection(visible, selectedId, wide);
  const selected = visible.find(row => row.schedule_id === activeId) ?? null;
  const now = Date.now();

  // GET /api/tasks?task_id=…&network_id=… —— 与执行记录同一个 network 作用域,不多要任何权限。
  const loadRunTask = useCallback(async (taskId: string) => {
    setRunTasks(prev => ({ ...prev, [taskId]: { loading: true, task: prev[taskId]?.task ?? null, error: '' } }));
    try {
      const task = await fetchTaskDetail(cfg, taskId);
      setRunTasks(prev => ({ ...prev, [taskId]: { loading: false, task, error: '' } }));
    } catch (e) {
      setRunTasks(prev => ({ ...prev, [taskId]: { loading: false, task: prev[taskId]?.task ?? null, error: e instanceof Error ? e.message : String(e) } }));
    }
  }, [cfg]);

  const loadRuns = useCallback(async (scheduleId: string) => {
    try {
      const data = await fetchScheduledRuns(cfg, scheduleId);
      const list = data.runs || [];
      setRuns({ id: scheduleId, runs: list, error: '' });
      // run 行在终态前一直是「已送达」;要分出「执行中」只能读任务。只读还没结束的(通常 0–1 条),
      // 已结束的等展开再读 —— 桌面端经中继访问 Hub 很慢,不为 50 行全文预取。
      for (const run of list) if (runIsOpen(run)) void loadRunTask(run.task_id!);
    } catch (e) {
      setRuns({ id: scheduleId, runs: [], error: e instanceof Error ? e.message : String(e) });
    }
  }, [cfg, loadRunTask]);

  // 执行记录跟着选中项走;计划被执行过(last_run_at/revision 变了)再拉一次。
  const runsKey = selected ? `${selected.schedule_id}:${selected.last_run_at ?? ''}:${selected.revision}` : '';
  useEffect(() => {
    if (!selected) return;
    void loadRuns(selected.schedule_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runsKey, loadRuns]);

  // 有还没结束的执行时,15 秒重读一次执行记录(送达 → 执行中 → 已完成 要能在页面上走完)。
  const hasOpenRun = !!selected && runs?.id === selected.schedule_id && runs.runs.some(runIsOpen);
  useEffect(() => {
    if (!hasOpenRun || !selected) return;
    const id = selected.schedule_id;
    const timer = setInterval(() => void loadRuns(id), 15_000);
    return () => clearInterval(timer);
  }, [hasOpenRun, selected?.schedule_id, loadRuns]);

  const toggleRun = (run: HubScheduledRun) => {
    const next = expandedRun === run.run_id ? null : run.run_id;
    setExpandedRun(next);
    if (next && run.task_id && (!runTasks[run.task_id] || runIsOpen(run) || runTasks[run.task_id].error)) void loadRunTask(run.task_id);
  };

  // 窄屏详情:系统返回键回到列表(后注册的监听先被调用,盖过 App 的返回处理)。
  useEffect(() => {
    if (wide || !selected) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setSelectedId(null); return true; });
    return () => sub.remove();
  }, [wide, selected]);

  const act = async (row: HubScheduledTask, action: ScheduleAction) => {
    setBusy(true); setError('');
    try {
      if (action === 'toggle') await setScheduledTaskStatus(cfg, row, row.status === 'active' ? 'paused' : 'active');
      if (action === 'run') await runScheduledTaskNow(cfg, row.schedule_id);
      if (action === 'cancel') await cancelScheduledTask(cfg, row.schedule_id);
      await load();
      if (action === 'run') await loadRuns(row.schedule_id);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const submitEditIntent = async (node: HubNodeExternalSchedules, schedule: HubExternalSchedule, patch: { enabled?: boolean; cron?: string }) => {
    if (typeof schedule.revision !== 'number') return;
    setBusy(true); setError('');
    try {
      await createExternalScheduleEdit(cfg, node.node_id, { schedule_id: schedule.id, base_revision: schedule.revision, patch });
      setCronEdit(null);
      Alert.alert('意向已提交', '节点在线时会自行应用并回执；结果见「意向记录」。');
    } catch (e) {
      setError(editIntentErrorText(e));
    } finally {
      setBusy(false);
      await loadExternal();
    }
  };

  const showIntents = async (node: HubNodeExternalSchedules) => {
    setBusy(true); setError('');
    try {
      const data = await fetchExternalScheduleEdits(cfg, node.node_id);
      setIntents({ title: `${node.alias} · 意向记录`, edits: data.edits || [] });
    } catch (e) { setError(editIntentErrorText(e)); }
    finally { setBusy(false); }
  };

  const setContentDraft = (id: string, draft: ScheduleContentDraft | null) => setContentDrafts(prev => {
    const next = { ...prev };
    if (draft) next[id] = draft; else delete next[id];
    return next;
  });
  const openContent = (row: HubScheduledTask) => {
    if (!contentDrafts[row.schedule_id]) setContentDraft(row.schedule_id, { base: row, text: row.task_content });
    setContentOpen(row.schedule_id);
  };
  const openContentDraft = contentOpen ? contentDrafts[contentOpen] ?? null : null;

  const openCreate = () => { setEditing(null); setCopySource(null); setCreateTarget(undefined); setShowForm(true); };
  const openCopy = (row: HubScheduledTask) => { setEditing(null); setCreateTarget(undefined); setCopySource(row); setShowForm(true); };

  const detail = selected ? (
    <ScheduleDetail
      row={selected}
      now={now}
      busy={busy}
      runs={runs?.id === selected.schedule_id ? runs : null}
      cfg={cfg}
      expandedRun={expandedRun}
      runTasks={runTasks}
      onToggleRun={toggleRun}
      onRetryRun={run => { if (run.task_id) void loadRunTask(run.task_id); }}
      onOpenChat={onOpenChat ? run => onOpenChat(selected.target_alias, run.task_id ?? undefined) : undefined}
      onBack={wide ? undefined : () => setSelectedId(null)}
      onEdit={row => { setEditing(row); setShowForm(true); }}
      onCopy={openCopy}
      onAction={(row, action) => void act(row, action)}
      onCancel={row => setCancelCandidate(row)}
      contentDraft={contentDrafts[selected.schedule_id] ?? null}
      onOpenContent={openContent}
      onDiscardContent={row => setContentDraft(row.schedule_id, null)}
    />
  ) : null;

  const hubBody = loading ? <View style={styles.center}><ActivityIndicator color={colors.accent} /></View> : (
    <View style={styles.hubBody}>
      <ScheduleFilterBar
        testID="schedule-search"
        query={hubQuery}
        onQuery={setHubQuery}
        placeholder="搜索任务标题或内容"
        nodeLabel={nodeFilterLabel(hubNodeOptions, hubNodeIdLive)}
        nodeSelected={!!hubNodeIdLive}
        onOpenNode={() => setNodePicker('hub')}
        onClearNode={() => setHubNodeId('')}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll} contentContainerStyle={styles.chips}>
        {filterChips(counts, filter).map(chip => (
          <Pressable
            key={chip.status}
            testID={`schedule-filter-${chip.status}`}
            accessibilityRole="button"
            accessibilityState={{ selected: chip.selected }}
            onPress={() => { setFilter(chip.status); setSelectedId(null); }}
            style={[styles.chip, chip.selected && styles.chipActive]}
          >
            <Text style={chip.selected ? styles.chipTextActive : styles.chipText}>{chip.label}</Text>
            <Text style={chip.selected ? styles.chipCountActive : styles.chipCount}>{chip.count}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.masterDetail}>
        <View style={wide ? [styles.masterList, { width: masterListWidth(measuredWidth ?? windowWidth) }] : styles.flex}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}
        >
          {visible.length === 0 ? (() => {
            const empty = emptyStateFor(filter, hubNarrowed ? hubScoped.length : items.length, hubNarrowed);
            return (
              <View style={styles.empty} testID="schedule-empty">
                <Text style={styles.emptyTitle}>{empty.title}</Text>
                <Text style={styles.emptyBody}>{empty.body}</Text>
                {empty.showCreate ? <Pressable style={[styles.primarySmall, { marginTop: spacing.lg }]} onPress={openCreate}><Text style={styles.primaryText}>新建定时任务</Text></Pressable> : null}
              </View>
            );
          })() : visible.map(row => (
            <ScheduleRow
              key={row.schedule_id}
              row={row}
              now={now}
              busy={busy}
              selected={wide && row.schedule_id === activeId}
              onOpen={() => setSelectedId(row.schedule_id)}
              onToggle={() => void act(row, 'toggle')}
            />
          ))}
        </ScrollView>
        </View>
        {wide ? (
          <View style={styles.detailPane} testID="schedule-detail-pane">
            {detail ?? <View style={styles.center}><Text style={styles.muted}>选择一个计划查看详情</Text></View>}
          </View>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={styles.root} onLayout={e => setMeasuredWidth(e.nativeEvent.layout.width)}>
      {!wide && selected ? detail : <>
        <View style={styles.header} testID="screen-header">
          <Text style={styles.title} numberOfLines={1}>定时任务</Text>
          <View style={styles.tabs}>
            {(['hub', 'node'] as const).map(value => (
              <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)} style={[styles.tabItem, tab === value && styles.tabActive]}>
                <Text style={tab === value ? styles.tabTextActive : styles.tabText}>{value === 'hub' ? 'Hub 计划' : '节点计划'}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.flex} />
          {tab === 'hub' ? <Pressable style={styles.primarySmall} onPress={openCreate}><Text style={styles.primaryText}>新建</Text></Pressable> : null}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {tab === 'node' ? (
          !externalLoaded ? <View style={styles.center}><ActivityIndicator color={colors.accent} /></View> : (
            <View style={styles.hubBody}>
            <ScheduleFilterBar
              testID="external-schedule-search"
              query={extQuery}
              onQuery={setExtQuery}
              placeholder="搜索计划名称或频率"
              nodeLabel={nodeFilterLabel(extNodeOptions, extNodeIdLive)}
              nodeSelected={!!extNodeIdLive}
              onOpenNode={() => setNodePicker('node')}
              onClearNode={() => setExtNodeId('')}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll} contentContainerStyle={styles.chips}>
              {externalEnabledChips(extMatching, extEnabled).map(chip => (
                <Pressable
                  key={chip.status}
                  testID={`external-filter-${chip.status}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: chip.selected }}
                  onPress={() => setExtEnabled(chip.status)}
                  style={[styles.chip, chip.selected && styles.chipActive]}
                >
                  <Text style={chip.selected ? styles.chipTextActive : styles.chipText}>{chip.label}</Text>
                  <Text style={chip.selected ? styles.chipCountActive : styles.chipCount}>{chip.count}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <ScrollView
              ref={nodeListRef}
              style={styles.flex}
              contentContainerStyle={styles.list}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadExternal(true)} tintColor={colors.accent} />}
            >
              <Text style={[styles.muted, { marginBottom: spacing.md }]}>节点上报的本机计划 · owner 可改托管 cron</Text>
              {extVisible.length === 0 ? (() => {
                const empty = externalEmptyState(external.length, extNarrowed);
                return (
                  <View style={styles.empty} testID="external-schedule-empty">
                    <Text style={styles.emptyTitle}>{empty.title}</Text>
                    <Text style={styles.emptyBody}>{empty.body}</Text>
                  </View>
                );
              })() : extVisible.map(node => (
                <View key={node.node_id} style={styles.card} onLayout={e => { externalOffsets.current.cards[node.node_id] = e.nativeEvent.layout.y; scrollToFocusedExternal(); }}>
                  <View style={styles.cardTop}>
                    <Text style={styles.cardTitle}>{node.alias}</Text>
                    <Pressable disabled={busy} style={styles.action} onPress={() => void showIntents(node)}><Text style={styles.actionText}>意向记录</Text></Pressable>
                  </View>
                  <Text style={styles.meta}>快照：{fmt(node.observed_at)}{node.error ? ` · 上报异常（${node.error}）` : ''}</Text>
                  {node.schedules.length === 0 ? <Text style={[styles.muted, { marginTop: spacing.sm }]}>该节点未上报计划</Text> : node.schedules.map(sch => (
                    <View
                      key={sch.id}
                      style={[styles.extRow, focusedExternal === `${node.node_id}:${sch.id}` && styles.extRowFocused]}
                      testID={`external-schedule-${node.node_id}-${sch.id}`}
                      aria-selected={focusedExternal === `${node.node_id}:${sch.id}`}
                      onLayout={e => { externalOffsets.current.rows[`${node.node_id}:${sch.id}`] = e.nativeEvent.layout.y; scrollToFocusedExternal(); }}
                    >
                      <View style={styles.cardTop}>
                        <Text style={styles.cardTitle}>{sch.name}</Text>
                        <Text style={[styles.badge, sch.enabled ? styles.badgeActive : styles.badgeIdle]}>{sch.enabled ? '启用' : '停用'}</Text>
                      </View>
                      <Text style={styles.meta}>{EXTERNAL_KIND_LABEL[sch.kind]} · {sch.frequency}</Text>
                      <Text style={styles.meta}>上次：{fmt(sch.last_run_at)}（{EXTERNAL_STATUS_LABEL[sch.last_status]}）　下次：{fmt(sch.next_run_at)}</Text>
                      {sch.last_error ? <Text style={styles.extError}>{sch.last_error}</Text> : null}
                      {sch.editable === true && sch.kind === 'cron' && typeof sch.revision === 'number' ? (() => {
                        const open = openIntents[`${node.node_id}:${sch.id}`];
                        return <>
                          {open ? <Text style={styles.intentBadge}>意向在途（{INTENT_STATUS_LABEL[open.status]}）：{describeIntentPatch(open.patch)}</Text> : null}
                          <View style={styles.actions}>
                            <Pressable disabled={busy || !!open} style={[styles.action, open && styles.actionDisabled]} onPress={() => void submitEditIntent(node, sch, { enabled: !sch.enabled })}><Text style={styles.actionText}>{sch.enabled ? '停用' : '启用'}</Text></Pressable>
                            <Pressable disabled={busy || !!open} style={[styles.action, open && styles.actionDisabled]} onPress={() => setCronEdit({ node, schedule: sch })}><Text style={styles.actionText}>改时间</Text></Pressable>
                          </View>
                        </>;
                      })() : null}
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>
            </View>
          )
        ) : hubBody}
      </>}
      <ScheduleEditor
        cfg={cfg}
        nodes={nodes}
        visible={showForm}
        editing={editing}
        initialTarget={createTarget}
        copyFrom={copySource}
        onClose={() => { setShowForm(false); setEditing(null); setCopySource(null); }}
        onSaved={async () => { setShowForm(false); setEditing(null); setCopySource(null); await load(); }}
      />
      <CancelScheduleModal
        value={cancelCandidate}
        busy={busy}
        onClose={() => setCancelCandidate(null)}
        onConfirm={() => {
          const row = cancelCandidate;
          setCancelCandidate(null);
          if (row) void act(row, 'cancel');
        }}
      />
      <CronEditModal
        value={cronEdit}
        busy={busy}
        onClose={() => setCronEdit(null)}
        onSubmit={cron => { if (cronEdit) void submitEditIntent(cronEdit.node, cronEdit.schedule, { cron }); }}
      />
      <IntentsModal value={intents} onClose={() => setIntents(null)} />
      <NodeFilterSheet
        visible={nodePicker !== null}
        options={pickerOptions}
        selectedId={pickerSelected}
        allCount={pickerAllCount}
        onSelect={id => {
          if (nodePicker === 'node') setExtNodeId(id);
          else setHubNodeId(id);
          setNodePicker(null);
        }}
        onClose={() => setNodePicker(null)}
      />
      {openContentDraft ? (
        <ScheduleContentFullscreen
          cfg={cfg}
          draft={openContentDraft}
          pointer={pointerUi()}
          onDraft={draft => setContentDraft(draft.base.schedule_id, draft)}
          onClose={() => {
            // 没改就不留草稿;改了留着,卡片上可以继续编辑或放弃。
            if (!contentDirty(openContentDraft.base, openContentDraft.text)) setContentDraft(openContentDraft.base.schedule_id, null);
            setContentOpen(null);
          }}
          onSaved={() => {
            setContentDraft(openContentDraft.base.schedule_id, null);
            setContentOpen(null);
            void load();
          }}
        />
      ) : null}
    </View>
  );
}

/** 列表行:56–72dp。头像 = 执行节点;没有下次也没有上次时不画时间(不出「—」)。 */
function ScheduleRow({ row, now, busy, selected, onOpen, onToggle }: {
  row: HubScheduledTask;
  now: number;
  busy: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const s = useMemo(makeStyles, [row, selected]);
  const vm = scheduleRowModel(row, now, DEVICE_TIMEZONE);
  return (
    <View style={[s.row, selected && s.rowSelected]} testID={`schedule-row-${row.schedule_id}`}>
      <Pressable style={s.rowMain} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${vm.name}，${vm.status.label}`}>
        <AliasAvatar alias={vm.target} size={36} />
        <View style={s.rowText}>
          <View style={s.rowLine}>
            <Text style={s.rowName} numberOfLines={1}>{vm.name}</Text>
            <StatusPill label={vm.status.label} tone={vm.status.tone} />
          </View>
          <View style={s.rowLine}>
            <Text style={s.rowTarget} numberOfLines={1}>{vm.target}</Text>
            <Text style={s.scheduleChip} numberOfLines={1}>{vm.scheduleText}</Text>
            {vm.when ? <Text style={s.rowWhen} numberOfLines={1}>{vm.when.text}</Text> : null}
          </View>
        </View>
      </Pressable>
      {vm.toggle !== null ? (
        <Switch
          accessibilityLabel={vm.toggle ? `暂停 ${vm.name}` : `恢复 ${vm.name}`}
          value={vm.toggle}
          disabled={busy}
          onValueChange={onToggle}
          trackColor={{ true: colors.accent, false: colors.border }}
          thumbColor={colors.card}
        />
      ) : null}
    </View>
  );
}

function ScheduleDetail({ row, now, busy, runs, cfg, expandedRun, runTasks, onToggleRun, onRetryRun, onOpenChat, onBack, onEdit, onCopy, onAction, onCancel, contentDraft, onOpenContent, onDiscardContent }: {
  row: HubScheduledTask;
  now: number;
  busy: boolean;
  runs: { runs: HubScheduledRun[]; error: string } | null;
  cfg: HubConfig;
  expandedRun: string | null;
  runTasks: Record<string, RunTaskState>;
  onToggleRun: (run: HubScheduledRun) => void;
  onRetryRun: (run: HubScheduledRun) => void;
  onOpenChat?: (run: HubScheduledRun) => void;
  onBack?: () => void;
  onEdit: (row: HubScheduledTask) => void;
  onCopy: (row: HubScheduledTask) => void;
  onAction: (row: HubScheduledTask, action: ScheduleAction) => void;
  onCancel: (row: HubScheduledTask) => void;
  /** 任务内容有没保存的全屏草稿(没有 = null)。 */
  contentDraft: ScheduleContentDraft | null;
  onOpenContent: (row: HubScheduledTask) => void;
  onDiscardContent: (row: HubScheduledTask) => void;
}) {
  const s = useMemo(makeStyles, [row]);
  // 折叠的「上一次还没结束」跳过组展开哪一个(只影响本页显示,和单条执行的 expandedRun 分开)。
  const [expandedSkipGroup, setExpandedSkipGroup] = useState<string | null>(null);
  const { t } = useTranslation();
  const status = scheduleStatusMeta(row.status);
  const availableActions = scheduledTaskActions(row.status);
  const misfire = describeMisfire(row.misfire_policy);
  const timeLine = (raw: string | null | undefined, none: string) => {
    const abs = formatAbsolute(raw, now);
    return abs ? `${abs}（${formatRelative(raw, now)}）` : none;
  };
  return (
    <View style={s.flex} testID="schedule-detail">
      {onBack ? (
        <View style={s.detailBar}>
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="返回定时任务" style={s.backButton}>
            <Text style={s.backText}>‹ 定时任务</Text>
          </Pressable>
          {availableActions.includes('copy') ? (
            <Pressable testID="schedule-copy" disabled={busy} onPress={() => onCopy(row)} accessibilityRole="button" style={[s.backButton, busy && s.actionDisabled]}>
              <Text style={s.backText}>{t('schedules.copy.action')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <ScrollView contentContainerStyle={s.detailContent}>
        <View style={s.rowLine}>
          <Text style={s.detailTitle} selectable>{row.name}</Text>
          <StatusPill label={status.label} tone={status.tone} />
        </View>
        <View style={[s.rowLine, { marginTop: spacing.sm }]}>
          <AliasAvatar alias={row.target_alias} size={22} />
          <Text style={s.detailTarget}>{row.target_alias}</Text>
          {row.priority !== 'normal' ? <Text style={s.metaInline}>{row.priority === 'high' ? '高优先级' : '低优先级'}</Text> : null}
        </View>
        {availableActions.some(a => a !== 'history' && !(a === 'copy' && onBack)) ? <View style={s.actionsRow}>
          {availableActions.includes('run') && <Pressable disabled={busy} style={[s.primarySmall, busy && s.actionDisabled]} onPress={() => onAction(row, 'run')}><Text style={s.primaryText}>立即执行</Text></Pressable>}
          {availableActions.includes('toggle') && <Pressable disabled={busy} style={[s.action, busy && s.actionDisabled]} onPress={() => onAction(row, 'toggle')}><Text style={s.actionText}>{row.status === 'active' ? '暂停' : '恢复'}</Text></Pressable>}
          {availableActions.includes('edit') && <Pressable disabled={busy} style={[s.action, busy && s.actionDisabled]} onPress={() => onEdit(row)}><Text style={s.actionText}>编辑</Text></Pressable>}
          {/* 手机单栏:五个按钮在 390 宽里折行(实测 376 > 342),「复制」放到顶栏右侧,这一行保持四个。 */}
          {availableActions.includes('copy') && !onBack && <Pressable testID="schedule-copy" disabled={busy} style={[s.action, busy && s.actionDisabled]} onPress={() => onCopy(row)}><Text style={s.actionText}>{t('schedules.copy.action')}</Text></Pressable>}
          {availableActions.includes('cancel') && <Pressable disabled={busy} style={[s.action, s.danger, busy && s.actionDisabled]} onPress={() => onCancel(row)}><Text style={s.dangerText}>取消计划</Text></Pressable>}
        </View> : null}

        {/* 任务内容:⤢ 全屏看 / 改 / 语音输入(ScheduleContentFullscreen,任务描述同一套)。只有能编辑的计划(进行中 / 已暂停)给;
            手机上点卡片本身也进全屏(先是阅读,顶栏切「编辑」),桌面卡片保持可选中复制。 */}
        <View style={s.sectionHead}>
          <Text style={[s.sectionLabel, s.sectionHeadLabel]}>任务内容</Text>
          {availableActions.includes('edit') ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('schedules.content.fullscreenA11y')}
              onPress={() => onOpenContent(row)}
              hitSlop={6}
              style={({ hovered }: any) => [s.fullscreenButton, hovered && s.fullscreenButtonHover]}
              testID="schedule-content-fullscreen"
            >
              <Text style={s.fullscreenGlyph}>⤢</Text>
              <Text style={s.fullscreenText} numberOfLines={1}>{t('schedules.content.fullscreen')}</Text>
            </Pressable>
          ) : null}
        </View>
        {contentDraft && contentDirty(contentDraft.base, contentDraft.text) ? (
          <View style={s.contentDraft} testID="schedule-content-draft">
            <Text style={s.contentDraftText} numberOfLines={1}>{t('schedules.content.draft')}</Text>
            <Pressable accessibilityRole="button" onPress={() => onOpenContent(row)} hitSlop={6} testID="schedule-content-draft-resume"><Text style={s.contentDraftLink}>{t('schedules.content.resume')}</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => onDiscardContent(row)} hitSlop={6} testID="schedule-content-draft-discard"><Text style={s.contentDraftMuted}>{t('schedules.content.discard')}</Text></Pressable>
          </View>
        ) : null}
        {!pointerUi() && availableActions.includes('edit') ? (
          <Pressable onPress={() => onOpenContent(row)} accessibilityRole="button" accessibilityLabel={t('schedules.content.fullscreenA11y')} testID="schedule-content-card">
            <Text style={s.prompt}>{row.task_content}</Text>
          </Pressable>
        ) : (
          <Text style={s.prompt} selectable testID="schedule-content-card">{row.task_content}</Text>
        )}

        <Text style={s.sectionLabel}>计划</Text>
        <View style={s.facts}>
          <Fact label="频率" value={describeSchedule(row.schedule, row.timezone, DEVICE_TIMEZONE, now)} />
          <Fact label="时区" value={row.timezone} />
          <Fact label="错过执行" value={misfire.short} hint={misfire.long} />
          <Fact label="下次执行" value={row.status === 'active' ? timeLine(row.next_run_at, '暂无') : row.status === 'paused' ? '已暂停，恢复后继续' : '不会再执行'} />
          <Fact label="上次执行" value={timeLine(row.last_run_at, '还没执行过')} last />
        </View>

        <Text style={s.sectionLabel}>执行记录</Text>
        {!runs ? <ActivityIndicator color={colors.accent} style={{ alignSelf: 'flex-start', marginTop: spacing.sm }} />
          : runs.error ? <Text style={s.error}>{runs.error}</Text>
          : runs.runs.length === 0 ? <Text style={s.muted}>还没有执行记录</Text>
          : <View style={s.facts}>{groupScheduleRuns(runs.runs).map((item, i, items) => {
            const last = i === items.length - 1;
            if (item.kind === 'skipGroup') {
              const text = skipGroupText(item, row.target_alias, now);
              const open = expandedSkipGroup === item.key;
              const blocker = item.blocker;
              return (
                <View key={item.key} testID={`schedule-skip-group-${item.key}`} style={[s.runRow, last && s.lastFact]}>
                  <Pressable
                    style={s.runHead}
                    onPress={() => setExpandedSkipGroup(open ? null : item.key)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: open }}
                    accessibilityLabel={t('schedule.skipGroup.a11y', { summary: text.summary, detail: text.detail })}
                    testID={`schedule-skip-group-toggle-${item.key}`}
                  >
                    <View style={s.runText}>
                      <Text style={s.runTime} numberOfLines={1}>{text.summary}</Text>
                      <View style={s.skipDetail} testID={`schedule-skip-group-detail-${item.key}`}>
                        <Text style={[s.runError, s.skipWho]} numberOfLines={open ? undefined : 1}>{text.wait ? `${text.who}${t('schedule.skipGroup.sep')}` : text.who}</Text>
                        {text.wait ? <Text style={[s.runError, s.skipWait]} numberOfLines={1} testID={`schedule-skip-group-wait-${item.key}`}>{text.wait}</Text> : null}
                      </View>
                    </View>
                    <StatusPill label={t('schedule.skipGroup.status')} tone="rest" />
                    <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
                  </Pressable>
                  {open ? (
                    <View style={s.skipTimes} testID={`schedule-skip-group-times-${item.key}`}>
                      <Text style={s.runError}>{t('schedule.skipGroup.why')}</Text>
                      <Text style={s.skipTimesLabel}>{t('schedule.skipGroup.times')}</Text>
                      <Text style={s.skipTimesList} selectable>{skipGroupTimes(item.runs, raw => formatAbsolute(raw, now)).join('  ')}</Text>
                      {blocker ? (
                        <Pressable
                          style={s.skipLink}
                          onPress={() => { if (expandedRun !== blocker.run_id) onToggleRun(blocker); }}
                          accessibilityRole="link"
                          testID={`schedule-skip-group-blocker-${item.key}`}
                        >
                          <Text style={s.skipLinkText}>{t('schedule.skipGroup.open', { at: text.blockerAt })}</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              );
            }
            const run = item.run;
            const task = run.task_id ? runTasks[run.task_id]?.task : null;
            const meta = runDisplay(run, task);
            const err = runFailureText(run, task);
            const duration = runDurationText(run, task);
            const expanded = expandedRun === run.run_id;
            const time = formatAbsolute(run.scheduled_for, now) || run.scheduled_for;
            return (
              <View key={run.run_id} style={[s.runRow, last && s.lastFact]} testID={`schedule-run-${run.run_id}`}>
                <Pressable
                  style={s.runHead}
                  onPress={() => onToggleRun(run)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  accessibilityLabel={`${time}，${meta.label}${duration ? `，${duration}` : ''}`}
                  testID={`schedule-run-toggle-${run.run_id}`}
                >
                  <View style={s.runText}>
                    <View style={s.runLine}>
                      <Text style={s.runTime} numberOfLines={1} testID={`schedule-run-time-${run.run_id}`}>{time}</Text>
                      {duration ? <Text style={s.runDuration} numberOfLines={1} testID={`schedule-run-duration-${run.run_id}`}>{duration}</Text> : null}
                    </View>
                    {err && !expanded ? <Text style={s.runError} numberOfLines={1}>{err}</Text> : null}
                  </View>
                  <StatusPill label={meta.label} tone={meta.tone} testID={`schedule-run-status-${run.run_id}`} />
                  <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} testID={`schedule-run-chevron-${run.run_id}`} />
                </Pressable>
                {expanded ? (
                  <ScheduleRunResult
                    cfg={cfg}
                    run={run}
                    state={run.task_id ? runTasks[run.task_id] : undefined}
                    onRetry={() => onRetryRun(run)}
                    onOpenChat={onOpenChat ? () => onOpenChat(run) : undefined}
                  />
                ) : null}
              </View>
            );
          })}</View>}
      </ScrollView>
    </View>
  );
}

function Fact({ label, value, hint, last }: { label: string; value: string; hint?: string; last?: boolean }) {
  const s = useMemo(makeStyles, [label, value]);
  return (
    <View style={[s.fact, last && s.lastFact]}>
      <Text style={s.factLabel}>{label}</Text>
      <View style={s.flex}>
        <Text style={s.factValue} selectable>{value}</Text>
        {hint ? <Text style={s.factHint}>{hint}</Text> : null}
      </View>
    </View>
  );
}

function CronEditModal({ value, busy, onClose, onSubmit }: {
  value: { node: HubNodeExternalSchedules; schedule: HubExternalSchedule } | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (cron: string) => void;
}) {
  const s = useMemo(makeStyles, [value]);
  const [cron, setCron] = useState('');
  useEffect(() => { setCron(''); }, [value?.schedule.id]);
  const valid = looksLikeCron(cron);
  return <ScheduleModal visible={!!value} onClose={onClose} testID="cron-edit" title="改执行时间" primary={{ label: '提交', disabled: busy || !valid, onPress: () => onSubmit(cron.trim().split(/ +/).join(' ')) }}>
      <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
        <Text style={s.meta}>{value?.node.alias} · {value?.schedule.name}</Text>
        <Text style={[s.meta, { marginBottom: spacing.md }]}>当前：{value?.schedule.frequency}</Text>
        <Label text="新的五段 cron（分 时 日 月 周）">
          <TextInput style={s.input} autoCapitalize="none" autoCorrect={false} value={cron} onChangeText={setCron} placeholder="*/30 * * * *" placeholderTextColor={colors.textMuted} />
        </Label>
        {cron && !valid ? <Text style={s.error}>需要五段，只能含数字和 * / , -（不含命令）。</Text> : null}
        <Text style={s.muted}>提交后生成编辑意向，由节点自行应用；只改时间与启停，绝不下发命令。</Text>
      </ScrollView>
  </ScheduleModal>;
}

function useLocalStyles() {
  const [themeVersion, setThemeVersion] = useState(0);
  useEffect(() => onThemeChange(() => setThemeVersion(v => v + 1)), []);
  return useMemo(makeStyles, [themeVersion]);
}

function ScheduleFilterBar({ testID, query, onQuery, placeholder, nodeLabel, nodeSelected, onOpenNode, onClearNode }: {
  testID: string;
  query: string;
  onQuery: (value: string) => void;
  placeholder: string;
  nodeLabel: string;
  nodeSelected: boolean;
  onOpenNode: () => void;
  onClearNode: () => void;
}) {
  const s = useLocalStyles();
  return (
    <View style={s.filterBar}>
      <View style={s.searchField} testID={testID} accessibilityRole={'search' as never}>
        <Ionicons name="search-outline" size={16} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={onQuery}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={placeholder}
          style={[s.searchInput, { outlineStyle: 'none' } as object]}
          testID={`${testID}-input`}
        />
        {query ? (
          <Pressable accessibilityRole="button" accessibilityLabel="清除搜索" onPress={() => onQuery('')} hitSlop={8} testID={`${testID}-clear`}>
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      <View style={[s.nodeButton, nodeSelected && s.nodeButtonOn]}>
        <Pressable
          style={s.nodeButtonMain}
          onPress={onOpenNode}
          accessibilityRole="button"
          accessibilityLabel={nodeSelected ? `节点 ${nodeLabel}` : '按节点筛选'}
          accessibilityState={{ selected: nodeSelected }}
          testID={`${testID}-node`}
        >
          <Text style={s.nodeButtonLabel} numberOfLines={1}>{nodeSelected ? nodeLabel : '全部节点'}</Text>
          {nodeSelected ? null : <Ionicons name="chevron-down" size={14} color={colors.textMuted} />}
        </Pressable>
        {nodeSelected ? (
          <Pressable accessibilityRole="button" accessibilityLabel="清除节点筛选" onPress={onClearNode} hitSlop={8} testID={`${testID}-node-clear`}>
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function NodeFilterSheet({ visible, options, selectedId, allCount, onSelect, onClose }: {
  visible: boolean;
  options: readonly ScheduleNodeOption[];
  selectedId: string;
  allCount: number;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const s = useLocalStyles();
  const [query, setQuery] = useState('');
  useEffect(() => { if (visible) setQuery(''); }, [visible]);
  const shown = useMemo(() => filterNodeOptions(options, query, pinyinMatch), [options, query]);
  return (
    <ScheduleModal visible={visible} onClose={onClose} sheet testID="schedule-node-picker" title="筛选节点">
      <View style={s.pickerBody}>
        <View style={s.pickerSearchWrap}>
          <View style={s.searchField}>
            <Ionicons name="search-outline" size={16} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="搜索节点"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="搜索节点"
              style={[s.searchInput, { outlineStyle: 'none' } as object]}
              testID="schedule-node-picker-search"
            />
          </View>
        </View>
        <ScrollView style={s.flex} keyboardShouldPersistTaps="handled" contentContainerStyle={s.pickerList}>
          <Pressable
            testID="schedule-node-option-all"
            accessibilityRole="button"
            accessibilityState={{ selected: !selectedId }}
            onPress={() => onSelect('')}
            style={[s.pickerRow, !selectedId && s.pickerRowOn]}
          >
            <Text style={s.pickerLabel} numberOfLines={1}>全部节点</Text>
            <Text style={s.pickerCount}>{allCount}</Text>
            {!selectedId ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : <View style={s.pickerCheck} />}
          </Pressable>
          {shown.length === 0 ? <Text style={[s.muted, s.pickerEmpty]}>没有匹配的节点</Text> : shown.map(option => {
            const selected = option.id === selectedId;
            return (
              <Pressable
                key={option.id}
                testID={`schedule-node-option-${option.id}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${option.label}，${option.count} 个计划`}
                onPress={() => onSelect(option.id)}
                style={[s.pickerRow, selected && s.pickerRowOn]}
              >
                <Text style={s.pickerLabel} numberOfLines={1}>{option.label}</Text>
                <Text style={s.pickerCount}>{option.count}</Text>
                {selected ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : <View style={s.pickerCheck} />}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </ScheduleModal>
  );
}

function IntentsModal({ value, onClose }: { value: { title: string; edits: HubExternalScheduleEditIntent[] } | null; onClose: () => void }) {
  const s = useMemo(makeStyles, [value]);
  return <ScheduleModal visible={!!value} onClose={onClose} testID="intents" title={value?.title || '意向记录'}>
      <ScrollView contentContainerStyle={s.form}>
        {value?.edits.length ? value.edits.map(edit => (
          <View key={edit.intent_id} style={s.run}>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>{edit.schedule_id} · {INTENT_STATUS_LABEL[edit.status] || edit.status}</Text>
              <Text style={s.meta}>{describeIntentPatch(edit.patch)}</Text>
              <Text style={s.meta}>{fmt(edit.created_at)}{edit.error_code ? ` · ${edit.error_code}` : ''}</Text>
            </View>
          </View>
        )) : <Text style={s.muted}>还没有编辑意向</Text>}
      </ScrollView>
  </ScheduleModal>;
}

function makeStyles() { return StyleSheet.create({
  // 表单 / 对话框 / 确认框 / 分段控件等与编辑器共用的那一份在 ScheduleEditor.tsx(scheduleStyleDefs),这里只加列表和详情自己的。
  ...scheduleStyleDefs(),
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { color: colors.text, fontSize: fontSize.heading, fontWeight: weight.strong },
  tabs: { flexDirection: 'row', backgroundColor: colors.subtleFill, borderRadius: radius.control, padding: 3 },
  tabItem: { paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radius.item },
  tabActive: { backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  tabText: { color: colors.textMuted, fontSize: fontSize.small },
  tabTextActive: { color: colors.text, fontSize: fontSize.small, fontWeight: weight.strong },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }, list: { padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  hubBody: { flex: 1 },
  chipsScroll: { flexGrow: 0 },
  chips: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm, flexDirection: 'row' },
  filterBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  searchField: { flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 140, minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.control, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, minWidth: 0, minHeight: 40, paddingVertical: 0, color: colors.text, fontSize: fontSize.body },
  nodeButton: { flexDirection: 'row', alignItems: 'center', maxWidth: 240, minHeight: 40, paddingLeft: spacing.md, paddingRight: spacing.sm, borderRadius: radius.control, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  nodeButtonOn: { borderColor: colors.accent, backgroundColor: colors.tonalBg },
  nodeButtonMain: { flexShrink: 1, minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
  nodeButtonLabel: { flexShrink: 1, color: colors.text, fontSize: fontSize.small },
  pickerBody: { flex: 1 },
  pickerSearchWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  pickerList: { paddingBottom: spacing.xl },
  pickerRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pickerRowOn: { backgroundColor: colors.rowActive },
  pickerLabel: { flex: 1, color: colors.text, fontSize: fontSize.body },
  pickerCount: { color: colors.textMuted, fontSize: fontSize.small },
  pickerCheck: { width: 18 },
  pickerEmpty: { padding: spacing.lg },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 6, minHeight: 32 },
  chipActive: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { color: colors.textSecondary, fontSize: fontSize.small },
  chipTextActive: { color: colors.bg, fontSize: fontSize.small, fontWeight: weight.strong },
  chipCount: { color: colors.textMuted, fontSize: fontSize.small },
  chipCountActive: { color: colors.bg, fontSize: fontSize.small, opacity: 0.75 },
  masterDetail: { flex: 1, flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border },
  masterList: { flexShrink: 0, borderRightWidth: 1, borderRightColor: colors.border },
  listContent: { paddingVertical: spacing.xs, paddingBottom: spacing.xl },
  detailPane: { flex: 1, backgroundColor: colors.bg },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingRight: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowSelected: { backgroundColor: colors.rowActive },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingLeft: spacing.lg, paddingRight: spacing.sm, paddingVertical: 10 },
  rowText: { flex: 1, minWidth: 0, gap: 4 },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 0 },
  rowName: { flexShrink: 1, color: colors.text, fontSize: fontSize.body + 1, fontWeight: weight.strong },
  rowTarget: { flexShrink: 1, color: colors.textSecondary, fontSize: fontSize.small, maxWidth: 110 },
  scheduleChip: { flexShrink: 0, color: colors.textSecondary, fontSize: fontSize.caption, backgroundColor: colors.subtleFill, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  rowWhen: { flexShrink: 1, color: colors.textMuted, fontSize: fontSize.caption },
  detailBar: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  backButton: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  backText: { color: colors.accent, fontSize: fontSize.title },
  detailContent: { padding: spacing.xl, paddingBottom: 60, maxWidth: 760 },
  detailTitle: { flexShrink: 1, color: colors.text, fontSize: fontSize.heading, fontWeight: weight.strong },
  detailTarget: { color: colors.textSecondary, fontSize: fontSize.body },
  metaInline: { color: colors.textMuted, fontSize: fontSize.small },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  // 「任务内容 · ⤢ 全屏」一行:标题的上下外边距挪到这一行上,按钮和标题同一条中线。
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xl, marginBottom: spacing.sm },
  sectionHeadLabel: { marginTop: 0, marginBottom: 0 },
  fullscreenButton: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 28, paddingHorizontal: spacing.sm, borderRadius: radius.item },
  fullscreenButtonHover: { backgroundColor: colors.rowHover },
  fullscreenGlyph: { color: colors.textSecondary, fontSize: 14, lineHeight: 16 },
  fullscreenText: { color: colors.textSecondary, fontSize: 12 },
  contentDraft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  contentDraftText: { flex: 1, color: colors.textMuted, fontSize: 12 },
  contentDraftLink: { color: colors.accent, fontSize: 12 },
  contentDraftMuted: { color: colors.textMuted, fontSize: 12 },
  prompt: { color: colors.text, fontSize: fontSize.body, lineHeight: 21, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.control, padding: spacing.md },
  facts: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.control, paddingHorizontal: spacing.md },
  fact: { flexDirection: 'row', gap: spacing.md, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  lastFact: { borderBottomWidth: 0 },
  factLabel: { width: 72, color: colors.textMuted, fontSize: fontSize.small, paddingTop: 1 },
  factValue: { color: colors.text, fontSize: fontSize.body },
  factHint: { color: colors.textMuted, fontSize: fontSize.small, marginTop: 2, lineHeight: 17 },
  runRow: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  runHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10, minHeight: 44 },
  runText: { flex: 1, minWidth: 0 },
  runLine: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, minWidth: 0 },
  runTime: { flexShrink: 0, color: colors.text, fontSize: fontSize.body },
  runDuration: { flexShrink: 1, color: colors.textMuted, fontSize: fontSize.small },
  runError: { color: colors.textMuted, fontSize: fontSize.small, marginTop: 2 },
  // 「在等谁」可以省略号截断;「已等 N 分钟」是一个整体,放不下就整段换到下一行。
  skipDetail: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline' },
  skipWho: { flexShrink: 1 },
  skipWait: { flexShrink: 0 },
  skipTimes: { paddingBottom: 10, gap: spacing.xs },
  skipTimesLabel: { color: colors.textMuted, fontSize: fontSize.small, marginTop: spacing.xs },
  skipTimesList: { color: colors.text, fontSize: fontSize.small, lineHeight: 19 },
  skipLink: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
  skipLinkText: { color: colors.accent, fontSize: fontSize.small },
  card: { backgroundColor: colors.card, borderRadius: radius.surface, padding: spacing.md, marginBottom: spacing.md, ...elevated('raised') }, cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, cardTitle: { color: colors.text, fontWeight: '600', fontSize: 15, flex: 1 }, badge: { fontSize: 11, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill }, badgeActive: { color: colors.running, backgroundColor: `${colors.running}20` }, badgeIdle: { color: colors.textMuted, backgroundColor: colors.bg },
  empty: { paddingVertical: 64, paddingHorizontal: spacing.xl, alignItems: 'center' }, emptyTitle: { color: colors.text, fontSize: fontSize.title, fontWeight: weight.strong, marginBottom: spacing.sm }, emptyBody: { color: colors.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 19, maxWidth: 300 },
  run: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  extRow: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.md, paddingTop: spacing.md },
  extRowFocused: { backgroundColor: colors.rowActive, marginHorizontal: -spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  extError: { color: colors.failed, fontSize: 11, marginTop: spacing.xs },
  intentBadge: { color: colors.accent, fontSize: 11, marginTop: spacing.sm },
}); }
