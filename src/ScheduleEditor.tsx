// 定时任务编辑器 —— 定时任务页(ScheduledTasksScreen)和节点页「定时任务」分区(NodeSchedulesSection)共用这一个。
//
// 表单:名称 / 执行节点 / 任务内容 / 优先级 / 类型 + 频率 / 错过执行 / 时区;保存走 PATCH(编辑)或 POST(新建 / 复制),
// 409 revision_conflict 按字段三方合并(schedule-editor-model.ts saveScheduleEdit + schedule-edit-merge.ts)。
// manage(节点页传):编辑已有计划时,表单上方再给「立即执行 / 暂停·恢复 / 复制 / 取消计划」,下方给最近几次执行记录
// —— 节点页点一行就在原地改,不再跳去定时任务页(owner 2026-10-07)。定时任务页的详情栏本来就有这些,不传。
// 关闭(✕ / 取消 / Esc / 点遮罩 / 安卓返回):有没保存的修改先确认(closeIntent)。
// 外壳:桌面居中对话框;手机全高底部 sheet(sheet)或整屏 pageSheet(改时间 / 意向记录)。
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Ionicons } from './icons';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text, TextInput } from './ui-text';
import {
  cancelScheduledTask,
  createScheduledTask,
  fetchHubNodes,
  fetchScheduledRuns,
  fetchScheduledTasks,
  fetchStatus,
  fetchTaskDetail,
  runScheduledTaskNow,
  ScheduledTaskError,
  setScheduledTaskStatus,
  updateScheduledTask,
  type HubConfig,
  type HubMisfirePolicy,
  type HubNode,
  type HubScheduledRun,
  type HubScheduledTask,
  type HubScheduleSpec,
  type HubTask,
  type Session,
} from './api';
import MacTitleStrip from './mac-title-strip';
import WinTitleBar from './win-title-bar';
import NodePickerSheet, { NodePickerField } from './NodePicker';
import { pickerChoices } from './node-picker-model';
import { listRequirementPeople } from './requirement-people-api';
import type { RequirementPerson } from './requirement-people';
import RequirementPeoplePicker from './RequirementPeoplePicker';
import AliasAvatar from './AliasAvatar';
import { useModalSafePadding } from './safe-area-runtime';
import { pointerUi } from './pointer-ui';
import { withBasePadding } from './modal-safe-area';
import { loadChatPins } from './chat-pins';
import { loadScheduleTargetRecents, rememberScheduleTarget } from './schedule-target-recents';
import { colors, radius, spacing, type as fontSize, weight } from './theme';
import { elevated } from './elevation';
import { scheduledTaskActions } from './scheduled-task-actions';
import TaskDescriptionEditor from './TaskDescriptionEditor';
import { contentDirty, SCHEDULE_CONTENT_MAX } from './schedule-content-edit';
import { runDisplay, runDurationText, runFailureText, runIsOpen } from './schedule-run-result';
import { describeMisfire, describeSchedule, formatAbsolute, scheduleStatusMeta } from './scheduled-view-model';
import type { StatusTone } from './scheduled-view-model';
import { t } from './i18n';
import './i18n-schedules';
import { fieldsOf, mergeDraft, type ScheduleEditFields, type ScheduleEditKey } from './schedule-edit-merge';
import { scheduleCopyDraft } from './schedule-copy';
import {
  closeIntent,
  EDITOR_RECENT_RUNS,
  formSnapshot,
  isFormDirty,
  saveScheduleEdit,
  type IntervalUnit,
  type ScheduleSaveApi,
} from './schedule-editor-model';

const DAYS = ['日', '一', '二', '三', '四', '五', '六'];

export const fmt = (value?: string | null) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : value;
};

const toLocalDateTimeInput = (value: string) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const intervalFormValue = (seconds: number): { every: string; unit: IntervalUnit } => {
  if (seconds % 86400 === 0) return { every: String(seconds / 86400), unit: 'days' };
  if (seconds % 3600 === 0) return { every: String(seconds / 3600), unit: 'hours' };
  if (seconds % 60 === 0) return { every: String(seconds / 60), unit: 'minutes' };
  return { every: String(seconds), unit: 'seconds' };
};

export const DEVICE_TIMEZONE = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; }
})();

export const toneColor = (tone: StatusTone) =>
  tone === 'running' ? colors.running : tone === 'blocked' ? colors.blocked : tone === 'failed' ? colors.failed : colors.textMuted;

export function StatusPill({ label, tone, testID }: { label: string; tone: StatusTone; testID?: string }) {
  const s = useMemo(makeStyles, [label, tone]);
  const c = toneColor(tone);
  return <Text style={[s.pill, { color: c, backgroundColor: `${c}1f` }]} testID={testID}>{label}</Text>;
}

/** 节点页:编辑已有计划时的「立即执行 / 暂停·恢复 / 复制 / 取消计划」+ 最近执行。 */
export interface ScheduleEditorManage {
  /** 「复制」:宿主把编辑器换成以这一条预填的新建(源计划不动)。 */
  onCopy: (row: HubScheduledTask) => void;
  /** 暂停 / 恢复 / 立即执行之后:宿主就地刷新列表(编辑器保持打开)。 */
  onChanged: () => void;
  /** 取消了计划:宿主关掉编辑器并刷新列表。 */
  onCancelled: () => void;
}

type SaveFailure = { latest: HubScheduledTask; keys: ScheduleEditKey[] };
type RecentRuns = { runs: HubScheduledRun[]; tasks: Record<string, HubTask | null>; error: string };

export default function ScheduleEditor({ cfg, nodes: nodesProp, visible, editing, initialTarget, copyFrom, onClose, onSaved, manage }: {
  cfg: HubConfig;
  /** 执行节点候选;不传(节点页)时编辑器打开时自己读 /api/nodes。 */
  nodes?: HubNode[];
  visible: boolean;
  editing: HubScheduledTask | null;
  /** 新建时预选的执行节点 node_id(节点页「＋ 新建」带过来)。 */
  initialTarget?: string;
  /** 「复制」的源计划:新建表单按它预填(schedule-copy.ts),源计划不动。 */
  copyFrom?: HubScheduledTask | null;
  onClose: () => void;
  onSaved: () => void;
  manage?: ScheduleEditorManage;
}) {
  const styles = useMemo(makeStyles, [visible]);
  const [name, setName] = useState(''); const [task, setTask] = useState('');
  const [watcherIds, setWatcherIds] = useState<string[]>([]);
  const [people, setPeople] = useState<RequirementPerson[]>([]);
  const [watchersOpen, setWatchersOpen] = useState(false);
  const [target, setTarget] = useState(''); const [kind, setKind] = useState<HubScheduleSpec['type']>('once');
  const [when, setWhen] = useState(''); const [every, setEvery] = useState('1'); const [unit, setUnit] = useState<IntervalUnit>('hours'); const [clock, setClock] = useState('09:00');
  const [weekdays, setWeekdays] = useState([1]); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [misfirePolicy, setMisfirePolicy] = useState<HubMisfirePolicy>('catch_up_once');
  const [priority, setPriority] = useState<'high' | 'normal' | 'low'>('normal');
  const detectedTimezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
  const [timezone, setTimezone] = useState(detectedTimezone);
  // 执行节点选择器(NodePicker.tsx):状态点来自会话表,置顶与节点列表同一份,最近使用按本设备 + Hub 账号。
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [pins, setPins] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [ownNodes, setOwnNodes] = useState<HubNode[]>([]);
  const nodes = nodesProp ?? ownNodes;
  useEffect(() => {
    if (!visible) { setPickerOpen(false); return; }
    let live = true;
    fetchStatus(cfg).then(d => { if (live) setSessions(d.sessions ?? []); }).catch(() => { /* 没有状态就全画成离线,仍可选 */ });
    loadChatPins(cfg).then(p => { if (live) setPins(p); }).catch(() => {});
    loadScheduleTargetRecents(cfg).then(r => { if (live) setRecents(r); }).catch(() => {});
    if (!nodesProp) fetchHubNodes(cfg).then(d => { if (live) setOwnNodes((d.nodes || []).filter(n => n.node_id && n.alias)); }).catch(() => {});
    return () => { live = false; };
  }, [visible, cfg, !nodesProp]);
  const choices = useMemo(() => pickerChoices(nodes, sessions), [nodes, sessions]);
  const chosen = choices.nodes.find(n => n.assignable && n.node_id === target) ?? null;
  // 409 时不丢草稿(schedule-edit-merge.ts):base = 这份草稿是基于哪一版改的;冲突后换成重新读到的那版。
  // 只在打开 / 换编辑对象时从 editing 同步 —— 列表 10 秒轮询换的是 items,不会碰到打开着的表单。
  const [base, setBase] = useState<HubScheduledTask | null>(editing);
  const [conflict, setConflict] = useState<SaveFailure | null>(null);
  // 单次计划复制时原时间已过、被顺延:记下原时间给提示用;用户一改时间就不再提。
  const [adjustedFrom, setAdjustedFrom] = useState<string | null>(null);
  const source = base ?? (editing ? null : copyFrom ?? null);
  const fallbackAlias = source && source.target_node_id === target ? source.target_alias : null;
  // 没保存的修改:pristine = 回填完那一刻的快照。'pending' = 刚回填,等下一次渲染(值已经换上)再拍。
  const [pristine, setPristine] = useState<string | null>(null);
  const snapshot = formSnapshot({ name, task, target, kind, when, every, unit, clock, weekdays, misfirePolicy, priority, timezone });
  const dirty = pristine !== 'pending' && isFormDirty(pristine, snapshot);
  useEffect(() => { if (pristine === 'pending') setPristine(snapshot); }, [pristine, snapshot]);
  // 「放弃修改？」确认之后要做的事(关闭 / 复制)。
  const [discardThen, setDiscardThen] = useState<null | (() => void)>(null);
  const guarded = (then: () => void) => { if (closeIntent(dirty, busy) === 'confirm') setDiscardThen(() => then); else then(); };
  const requestClose = () => guarded(onClose);

  const fillForm = (f: ScheduleEditFields) => {
    setName(f.name); setTask(f.task); setTarget(f.target_node_id);
    setKind(f.schedule.type); setMisfirePolicy(f.misfire_policy || 'catch_up_once');
    setPriority(f.priority); setTimezone(f.timezone);
    if (f.schedule.type === 'once') setWhen(toLocalDateTimeInput(f.schedule.run_at));
    if (f.schedule.type === 'interval') {
      const value = intervalFormValue(f.schedule.every_seconds);
      setEvery(value.every); setUnit(value.unit);
    }
    if (f.schedule.type === 'daily') setClock(f.schedule.time);
    if (f.schedule.type === 'weekly') { setClock(f.schedule.time); setWeekdays(f.schedule.weekdays); }
  };

  useEffect(() => {
    if (!visible) { setPristine(null); setDiscardThen(null); return; }
    setError(''); setConflict(null); setBase(editing); setWatcherIds((editing?.watchers ?? []).map(w => w.user_id)); setAdjustedFrom(null); setPristine('pending');
    if (!editing) {
      setName(''); setTask(''); setTarget(initialTarget ?? ''); setKind('once'); setWhen(''); setEvery('1'); setUnit('hours');
      setClock('09:00'); setWeekdays([1]); setMisfirePolicy('catch_up_once'); setPriority('normal'); setTimezone(detectedTimezone);
      if (copyFrom) {
        const copy = scheduleCopyDraft(copyFrom, Date.now(), t('schedules.copy.suffix'));
        fillForm(copy.fields); setAdjustedFrom(copy.adjustedFrom);
      }
      return;
    }
    fillForm(fieldsOf(editing));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editing, detectedTimezone, initialTarget, copyFrom]);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    void listRequirementPeople(cfg).then(rows => {
      if (live) setPeople(rows.filter(r => r.kind === 'user' && !r.unavailable));
    }).catch(() => { if (live) setPeople([]); });
    return () => { live = false; };
  }, [visible, cfg.serverUrl, cfg.token, cfg.networkId]);
  const supportsWatchers = !editing || Array.isArray(editing.watchers);
  const canManageWatchers = !editing || editing.can_manage_watchers !== false;
  const invalidSchedule = (kind === 'once' && !when) ||
    (kind === 'interval' && (!Number.isInteger(Number(every)) || Number(every) < (unit === 'seconds' ? 60 : 1))) ||
    (kind === 'weekly' && weekdays.length === 0);
  const draftInput = (): ScheduleEditFields => {
    let schedule: HubScheduleSpec;
    if (kind === 'once') schedule = { type: 'once', run_at: new Date(when).toISOString() };
    else if (kind === 'interval') {
      const multiplier = unit === 'seconds' ? 1 : unit === 'minutes' ? 60 : unit === 'hours' ? 3600 : 86400;
      schedule = { type: 'interval', every_seconds: Number(every) * multiplier };
    }
    else if (kind === 'daily') schedule = { type: 'daily', time: clock };
    else schedule = { type: 'weekly', time: clock, weekdays };
    return { name: name.trim(), target_node_id: target, task: task.trim(), priority, timezone: timezone.trim(), schedule, misfire_policy: misfirePolicy };
  };
  const saveApi: ScheduleSaveApi = {
    update: (row, input) => updateScheduledTask(cfg, row, input),
    refetch: async id => (await fetchScheduledTasks(cfg)).schedules?.find(x => x.schedule_id === id),
    is409Conflict: e => e instanceof ScheduledTaskError && e.status === 409 && e.code === 'revision_conflict',
  };
  // 409 revision_conflict:重新读 → 没有同字段冲突就合并后自动重试一次;有就停在冲突视图。草稿任何分支都不丢。
  const save = async (row: HubScheduledTask, input: ScheduleEditFields, retried: boolean): Promise<void> => {
    const out = await saveScheduleEdit(saveApi, row, input, retried);
    if (out.kind === 'saved') { onSaved(); return; }
    if (out.kind === 'refetchFailed') { setError(t('schedules.conflict.refetchFailed', { message: out.message })); return; }
    if (out.kind === 'gone') { setError(t('schedules.conflict.gone')); return; }
    if (out.kind === 'conflict') { setConflict({ latest: out.latest, keys: out.keys }); return; }
    setBase(out.base); fillForm(out.input); setError(t('schedules.conflict.retryAgain'));
  };
  const submit = async () => {
    setBusy(true); setError(''); setConflict(null);
    try {
      const input = draftInput();
      // A new plan omits an empty watcher list. Copying a schedule must keep the
      // old POST body, and an older Hub must not see a field it does not know.
      // Editing still sends the list, including [] to clear it.
      if (supportsWatchers && canManageWatchers && (base || watcherIds.length > 0)) input.watchers = watcherIds;
      if (base) await save(base, input, false);
      else { await createScheduledTask(cfg, input); onSaved(); }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    finally { setBusy(false); }
  };
  const resolveConflict = async (choice: 'mine' | 'theirs' | 'edit') => {
    if (!conflict || !base) return;
    const { latest } = conflict;
    const draft = draftInput();
    setConflict(null);
    if (choice === 'edit') { setBase(latest); return; }
    const merged = mergeDraft(base, latest, draft, choice);
    setBase(latest); fillForm(merged);
    if (choice === 'theirs') return;
    setBusy(true); setError('');
    try { await save(latest, merged, true); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const describeField = (key: ScheduleEditKey, f: ScheduleEditFields): string => {
    if (key === 'schedule') return describeSchedule(f.schedule, f.timezone, DEVICE_TIMEZONE);
    if (key === 'misfire_policy') return describeMisfire(f.misfire_policy).short;
    if (key === 'priority') return t(`schedules.priority.${f.priority}`);
    if (key === 'target_node_id') return nodes.find(n => n.node_id === f.target_node_id)?.alias ?? f.target_node_id;
    return String(f[key]);
  };

  // ── manage:编辑已有计划时的动作 + 最近执行(节点页) ──
  // current = 这条计划的最新状态(暂停 / 恢复后换成 Hub 回的那一行);表单字段仍按 base 做三方合并。
  const [current, setCurrent] = useState<HubScheduledTask | null>(editing);
  const [acting, setActing] = useState(false);
  const [cancelAsk, setCancelAsk] = useState(false);
  const [recent, setRecent] = useState<RecentRuns | null>(null);
  const managing = !!manage && !!editing;
  const loadRecent = useCallback(async (scheduleId: string) => {
    try {
      const runs = (await fetchScheduledRuns(cfg, scheduleId, EDITOR_RECENT_RUNS)).runs || [];
      // 还没结束的执行要读任务才分得出「执行中」(与定时任务页同一口径),通常 0–1 条。
      const open = await Promise.all(runs.filter(runIsOpen).map(async run => [run.task_id!, await fetchTaskDetail(cfg, run.task_id!).catch(() => null)] as const));
      setRecent({ runs, tasks: Object.fromEntries(open), error: '' });
    } catch (e) {
      setRecent({ runs: [], tasks: {}, error: e instanceof Error ? e.message : String(e) });
    }
  }, [cfg]);
  useEffect(() => {
    setCurrent(editing); setCancelAsk(false);
    if (!visible || !editing || !manage) { setRecent(null); return; }
    setRecent(null);
    void loadRecent(editing.schedule_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editing, !!manage, loadRecent]);
  const act = async (action: 'toggle' | 'run' | 'cancel') => {
    if (!current || !manage) return;
    setActing(true); setError('');
    try {
      if (action === 'toggle') {
        const res = await setScheduledTaskStatus(cfg, current, current.status === 'active' ? 'paused' : 'active');
        const next = res?.schedule ?? { ...current, status: current.status === 'active' ? 'paused' as const : 'active' as const };
        setCurrent(next);
        // 状态不是表单字段:只把 base 的 revision 跟上,用户的草稿照旧按原 base 合并。
        setBase(b => (b && b.schedule_id === next.schedule_id ? { ...b, revision: next.revision, status: next.status } : b));
      }
      if (action === 'run') { await runScheduledTaskNow(cfg, current.schedule_id); await loadRecent(current.schedule_id); }
      if (action === 'cancel') { await cancelScheduledTask(cfg, current.schedule_id); setCancelAsk(false); manage.onCancelled(); return; }
      manage.onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setActing(false); }
  };
  const actions = current ? scheduledTaskActions(current.status) : [];
  const canEdit = (!editing || actions.includes('edit')) && editing?.can_edit !== false;

  const whenMs = kind === 'once' && when ? new Date(when).getTime() : NaN;
  const timeHint = kind !== 'once' ? null
    : adjustedFrom && Number.isFinite(whenMs) ? t('schedules.copy.adjusted', { from: fmt(adjustedFrom), to: fmt(new Date(whenMs).toISOString()) })
    : Number.isFinite(whenMs) && whenMs < Date.now() ? t('schedules.once.past') : null;
  const cannotSave = busy || !name.trim() || !task.trim() || !target || !timezone.trim() || invalidSchedule;
  const now = Date.now();
  return <>
    <ScheduleModal visible={visible} onClose={requestClose} sheet testID="schedule-form" title={editing ? '编辑定时任务' : '新建定时任务'} primary={canEdit ? { label: '保存', disabled: cannotSave || !!conflict || acting, onPress: submit } : undefined}>
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        {managing && current ? (
          <View testID="schedule-editor-manage" style={styles.manage}>
            <View style={styles.manageHead}>
              <StatusPill label={scheduleStatusMeta(current.status).label} tone={scheduleStatusMeta(current.status).tone} testID="schedule-editor-status" />
              {current.status === 'active' && current.next_run_at ? <Text style={styles.manageNext} numberOfLines={1}>下次 {formatAbsolute(current.next_run_at, now)}</Text> : null}
            </View>
            <View style={styles.actions}>
              {actions.includes('run') && <Pressable testID="schedule-editor-run" disabled={acting || busy} style={[styles.primarySmall, (acting || busy) && styles.actionDisabled]} onPress={() => void act('run')}><Text style={styles.primaryText}>立即执行</Text></Pressable>}
              {actions.includes('toggle') && <Pressable testID="schedule-editor-toggle" disabled={acting || busy} style={[styles.action, (acting || busy) && styles.actionDisabled]} onPress={() => void act('toggle')}><Text style={styles.actionText}>{current.status === 'active' ? '暂停' : '恢复'}</Text></Pressable>}
              {actions.includes('copy') && <Pressable testID="schedule-editor-copy" disabled={acting || busy} style={[styles.action, (acting || busy) && styles.actionDisabled]} onPress={() => guarded(() => manage!.onCopy(current))}><Text style={styles.actionText}>{t('schedules.copy.action')}</Text></Pressable>}
              {actions.includes('cancel') && current.can_manage_watchers !== false && <Pressable testID="schedule-editor-cancel-plan" disabled={acting || busy} style={[styles.action, styles.danger, (acting || busy) && styles.actionDisabled]} onPress={() => setCancelAsk(true)}><Text style={styles.dangerText}>取消计划</Text></Pressable>}
            </View>
            {!canEdit ? <Text style={styles.meta}>这条计划已结束，不能再改；可以复制后新建。</Text> : null}
          </View>
        ) : null}
        {error ? <Text testID="schedule-form-error" style={styles.error}>{error}</Text> : null}
        {conflict && base ? (() => {
          const mine = draftInput(), theirs = fieldsOf(conflict.latest);
          return <View testID="schedule-conflict" style={styles.conflict}>
            <Text style={styles.conflictTitle}>{t('schedules.conflict.title')}</Text>
            <Text style={styles.meta}>{t('schedules.conflict.body')}</Text>
            {conflict.keys.map(key => <View key={key} testID={`schedule-conflict-${key}`} style={styles.conflictField}>
              <Text style={styles.label}>{t(`schedules.field.${key}`)}</Text>
              <Text style={styles.conflictSide}>{t('schedules.conflict.mine')}</Text>
              <Text testID={`schedule-conflict-${key}-mine`} style={styles.conflictValue} selectable>{describeField(key, mine)}</Text>
              <Text style={styles.conflictSide}>{t('schedules.conflict.theirs')}</Text>
              <Text testID={`schedule-conflict-${key}-theirs`} style={styles.conflictValue} selectable>{describeField(key, theirs)}</Text>
            </View>)}
            <View style={styles.actions}>
              <Pressable testID="schedule-conflict-mine" disabled={busy} style={styles.action} onPress={() => void resolveConflict('mine')}><Text style={styles.actionText}>{t('schedules.conflict.useMine')}</Text></Pressable>
              <Pressable testID="schedule-conflict-theirs" disabled={busy} style={styles.action} onPress={() => void resolveConflict('theirs')}><Text style={styles.actionText}>{t('schedules.conflict.useTheirs')}</Text></Pressable>
              <Pressable testID="schedule-conflict-edit" disabled={busy} style={styles.action} onPress={() => void resolveConflict('edit')}><Text style={styles.actionText}>{t('schedules.conflict.keepEditing')}</Text></Pressable>
            </View>
          </View>;
        })() : null}
        <View pointerEvents={canEdit ? 'auto' : 'none'} style={!canEdit && styles.formLocked}>
        <Label text="名称"><TextInput style={styles.input} value={name} onChangeText={setName} placeholder="每日巡检" placeholderTextColor={colors.textMuted} /></Label>
        {supportsWatchers ? (
          <View testID="schedule-watchers" style={styles.field}>
            <Text style={styles.label}>关注人</Text>
            <Text style={styles.meta}>{canManageWatchers ? '能看也能改这条计划，不能取消，也不能改关注人。' : '你是关注人，可以编辑这条计划。'}</Text>
            <View style={styles.watcherField}>
              {watcherIds.length === 0 ? (
                <Pressable testID="schedule-watchers-field" accessibilityRole="button" accessibilityLabel="添加关注人" disabled={!canManageWatchers} onPress={() => setWatchersOpen(true)} style={styles.watcherOpen}>
                  <Text style={styles.watcherPlaceholder}>{canManageWatchers ? '添加关注人' : '还没有关注人'}</Text>
                </Pressable>
              ) : (
                <View style={styles.watcherChips}>
                  {watcherIds.map(id => {
                    const person = people.find(p => p.id === id);
                    const saved = (editing?.watchers ?? []).find(w => w.user_id === id);
                    const label = person?.displayName || person?.name || saved?.display_name || saved?.username || id;
                    return (
                      <View key={id} testID={`schedule-watcher-${id}`} style={styles.watcherChip}>
                        <AliasAvatar alias={label} size={22} />
                        <Text style={styles.watcherChipText} numberOfLines={1}>{label}</Text>
                        {canManageWatchers ? (
                          <Pressable testID={`schedule-watcher-remove-${id}`} accessibilityLabel={`移除 ${label}`} hitSlop={8} onPress={() => setWatcherIds(ids => ids.filter(x => x !== id))}>
                            <Ionicons name="close" size={14} color={colors.textMuted} />
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              )}
              {canManageWatchers ? (
                <Pressable testID="schedule-watchers-manage" accessibilityRole="button" accessibilityLabel="管理关注人" hitSlop={8} onPress={() => setWatchersOpen(true)}>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </View>
            {canManageWatchers && people.length === 0 ? <Text style={styles.meta}>没有可选的人类账户</Text> : null}
          </View>
        ) : null}
        <Label text="执行节点"><NodePickerField node={chosen} fallbackAlias={fallbackAlias} onPress={() => setPickerOpen(true)} /></Label>
        {/* 任务内容:⤢ 全屏 + 🎤,和任务描述同一个编辑器(TaskDescriptionEditor);节点收到的是原文,不放图片、不走富文本。
            表单一打开就是编辑框(原来就是输入框),桌面全屏从「左右」起。 */}
        <View style={styles.field}>
          <TaskDescriptionEditor
            cfg={cfg}
            value={task}
            onChange={setTask}
            pointer={pointerUi()}
            title={name || t('schedules.field.task')}
            dirty={base ? contentDirty(base, task) : !!task.trim()}
            label={t('schedules.field.task')}
            placeholder={t('schedules.content.placeholder')}
            maxLength={SCHEDULE_CONTENT_MAX}
            images={false}
            richText={false}
            initialMode="edit"
            fullscreenA11y={t('schedules.content.fullscreenA11y')}
            chrome={{ title: t('schedules.field.task'), unsavedText: t('schedules.content.unsavedForm') }}
            testID="schedule-form-task"
          />
        </View>
        <Label text="优先级"><View style={styles.segment}>{(['high','normal','low'] as const).map((value) => <Pressable key={value} onPress={() => setPriority(value)} style={[styles.segmentItem, priority === value && styles.segmentActive]}><Text style={priority === value ? styles.segmentTextActive : styles.segmentText}>{value === 'high' ? '高' : value === 'low' ? '低' : '普通'}</Text></Pressable>)}</View></Label>
        <Label text="类型"><View style={styles.segment}>{(['once','interval','daily','weekly'] as const).map((x, i) => <Pressable key={x} onPress={() => setKind(x)} style={[styles.segmentItem, kind === x && styles.segmentActive]}><Text style={kind === x ? styles.segmentTextActive : styles.segmentText}>{['单次','间隔','每天','每周'][i]}</Text></Pressable>)}</View></Label>
        <Label text="错过执行"><View style={styles.segment}>{(['catch_up_once','skip'] as const).map((policy) => <Pressable key={policy} onPress={() => setMisfirePolicy(policy)} style={[styles.segmentItem, misfirePolicy === policy && styles.segmentActive]}><Text style={misfirePolicy === policy ? styles.segmentTextActive : styles.segmentText}>{policy === 'catch_up_once' ? '补跑一次' : '跳过本次'}</Text></Pressable>)}</View><Text style={styles.meta}>{misfirePolicy === 'catch_up_once' ? '适合新闻抓取；恢复后最多补跑一次' : '错过后等待下一周期'}</Text></Label>
        {kind === 'once' && <Label text="执行时间（ISO 或 YYYY-MM-DDTHH:mm）"><TextInput style={styles.input} autoCapitalize="none" value={when} onChangeText={v => { setWhen(v); setAdjustedFrom(null); }} placeholder="2026-08-10T09:00" placeholderTextColor={colors.textMuted} />{timeHint ? <Text testID="schedule-form-time-hint" style={styles.timeHint}>{timeHint}</Text> : null}</Label>}
        <Label text="时区（IANA）"><TextInput style={styles.input} autoCapitalize="none" value={timezone} onChangeText={setTimezone} placeholder="Asia/Shanghai" placeholderTextColor={colors.textMuted} /></Label>
        {kind === 'interval' && <Label text="固定间隔"><TextInput style={styles.input} keyboardType="number-pad" value={every} onChangeText={setEvery} /><View style={[styles.segment, { marginTop: spacing.sm }]}>{(['seconds','minutes','hours','days'] as const).map((value, index) => <Pressable key={value} onPress={() => setUnit(value)} style={[styles.segmentItem, unit === value && styles.segmentActive]}><Text style={unit === value ? styles.segmentTextActive : styles.segmentText}>{['秒','分钟','小时','天'][index]}</Text></Pressable>)}</View></Label>}
        {(kind === 'daily' || kind === 'weekly') && <Label text="时间"><TextInput style={styles.input} value={clock} onChangeText={setClock} placeholder="09:00" placeholderTextColor={colors.textMuted} /></Label>}
        {kind === 'weekly' && <View style={styles.weekdays}>{DAYS.map((d, i) => <Pressable key={d} onPress={() => setWeekdays(v => v.includes(i) ? v.filter(x => x !== i) : [...v, i].sort())} style={[styles.day, weekdays.includes(i) && styles.dayActive]}><Text style={weekdays.includes(i) ? styles.dayTextActive : styles.segmentText}>{d}</Text></Pressable>)}</View>}
        </View>
        {managing ? (
          <View testID="schedule-editor-runs">
            <Text style={styles.sectionLabel}>最近执行</Text>
            {!recent ? <ActivityIndicator color={colors.accent} style={{ alignSelf: 'flex-start' }} />
              : recent.error ? <Text style={styles.error}>{recent.error}</Text>
              : recent.runs.length === 0 ? <Text style={styles.muted}>还没有执行记录</Text>
              : <View style={styles.runs}>{recent.runs.map((run, i) => {
                const runTask = run.task_id ? recent.tasks[run.task_id] ?? null : null;
                const meta = runDisplay(run, runTask);
                const err = runFailureText(run, runTask);
                const duration = runDurationText(run, runTask);
                return (
                  <View key={run.run_id} testID={`schedule-editor-run-${run.run_id}`} style={[styles.runRow, i === recent.runs.length - 1 && styles.runRowLast]}>
                    <View style={styles.runText}>
                      <Text style={styles.runTime} numberOfLines={1}>{formatAbsolute(run.scheduled_for, now) || run.scheduled_for}{duration ? `  ·  ${duration}` : ''}</Text>
                      {err ? <Text style={styles.runError} numberOfLines={1}>{err}</Text> : null}
                    </View>
                    <StatusPill label={meta.label} tone={meta.tone} />
                  </View>
                );
              })}</View>}
          </View>
        ) : null}
      </ScrollView>
      {visible && watchersOpen && canManageWatchers && cfg.networkId ? (
        <RequirementPeoplePicker
          networkId={cfg.networkId}
          mode="participants"
          kinds={['user']}
          title="选择关注人"
          hint={n => n ? `已选 ${n} 人` : '能看也能改，不能取消或改关注人'}
          people={people}
          selected={watcherIds.map(id => ({ kind: 'user' as const, id }))}
          onClose={() => setWatchersOpen(false)}
          onConfirm={rows => { setWatcherIds(rows.filter(r => r.kind === 'user').map(r => r.id)); setWatchersOpen(false); }}
        />
      ) : null}
      <NodePickerSheet
        visible={visible && pickerOpen}
        nodes={choices.nodes}
        hiddenOffline={choices.hiddenOffline}
        selectedId={target}
        recents={recents}
        pinned={pins}
        onClose={() => setPickerOpen(false)}
        onSelect={n => { if (!n.assignable) return; setTarget(n.node_id); setRecents(rememberScheduleTarget(cfg, recents, n.node_id)); setPickerOpen(false); }}
      />
    </ScheduleModal>
    <ScheduleConfirm
      visible={visible && !!discardThen}
      title="放弃未保存的修改？"
      message="关闭后，这次对计划的修改不会保存。"
      backLabel="继续编辑"
      confirmLabel="放弃修改"
      testID="schedule-discard-confirm"
      onClose={() => setDiscardThen(null)}
      onConfirm={() => { const then = discardThen; setDiscardThen(null); then?.(); }}
    />
    <CancelScheduleModal
      value={visible && cancelAsk ? current : null}
      busy={acting}
      onClose={() => setCancelAsk(false)}
      onConfirm={() => void act('cancel')}
    />
  </>;
}

/**
 * 表单 / 改时间 / 意向记录的外壳。桌面(pointer-ui.ts,Tauri 壳任何宽度):居中对话框 —— 标题左对齐 + ✕,
 * 底部右侧「取消」「保存」,列表页留在后面(淡遮罩)(Owner 2026-09-27:桌面和安卓不该一样)。
 * 手机:sheet = 全高底部 sheet(圆角顶 + 叠在顶栏上的把手,顶边离状态栏下沿只留 spacing.xs,顶栏位置同其它整屏弹窗);否则整屏 pageSheet。
 * 两种手机外壳的顶栏都是「取消 · 标题 · 保存」(iOS 导航栏的形状)。
 * testID 各形态相同:`${testID}` 是面板,`-header` / `-title` / `-cancel` / `-save` 各是那一格。
 */
export function ScheduleModal({ visible, onClose, testID = 'schedule-modal', title, primary, cancelLabel = '取消', sheet = false, children }: {
  visible: boolean;
  onClose: () => void;
  testID?: string;
  title: string;
  /** 右侧主按钮(保存 / 提交);没有 = 只读页,只给「关闭」。 */
  primary?: { label: string; disabled: boolean; onPress: () => void };
  cancelLabel?: string;
  /** 手机上画成全高底部 sheet(编辑器);默认整屏 pageSheet。 */
  sheet?: boolean;
  children: ReactNode;
}) {
  const s = useMemo(makeStyles, [visible]);
  // Android edge-to-edge:Modal 画到状态栏 / 挖孔底下,根 View 按安全区垫(modal-safe-area.ts,#387 同一张表)。
  const safe = useModalSafePadding('pageSheet');
  // 底部 sheet:遮罩铺满整窗,安全区垫在面板上(顶边让出状态栏再多留一截)。
  const sheetSafe = useModalSafePadding('fullScreen');
  const { width, height } = useWindowDimensions();
  const phoneHeader = (
    <View testID={`${testID}-header`} style={s.modalHeader}><Pressable testID={`${testID}-cancel`} onPress={onClose} style={s.headerSide}><Text style={s.link}>{primary ? cancelLabel : '关闭'}</Text></Pressable><Text testID={`${testID}-title`} style={s.modalTitle} numberOfLines={1}>{title}</Text>{primary ? <Pressable testID={`${testID}-save`} disabled={primary.disabled} onPress={primary.onPress} style={[s.headerSide, s.headerSideEnd]}><Text style={[s.link, primary.disabled && s.linkDisabled]}>{primary.label}</Text></Pressable> : <View style={s.headerSide} />}</View>
  );
  if (pointerUi()) {
    const size = scheduleDialogSize(width, height);
    return <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={[s.dialogOverlay, withBasePadding(safe, spacing.lg)]}>
        <Pressable testID={`${testID}-backdrop`} accessibilityLabel="关闭" focusable={false} onPress={onClose} style={[StyleSheet.absoluteFill, s.dialogBackdrop]} />
        <View testID={testID} style={[s.dialogPanel, size]}>
          <View testID={`${testID}-header`} style={s.dialogHeader}>
            <Text testID={`${testID}-title`} style={s.dialogTitle} numberOfLines={1}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`关闭${title}`} testID={`${testID}-close`} hitSlop={8} onPress={onClose} style={({ hovered }: any) => [s.dialogClose, hovered && s.dialogBtnHover]}>
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </Pressable>
          </View>
          {children}
          <View testID={`${testID}-footer`} style={s.dialogFooter}>
            <Pressable accessibilityRole="button" testID={`${testID}-cancel`} onPress={onClose} style={({ hovered }: any) => [s.dialogBtn, hovered && s.dialogBtnHover]}>
              <Text style={s.dialogBtnText}>{primary ? cancelLabel : '关闭'}</Text>
            </Pressable>
            {primary ? (
              <Pressable accessibilityRole="button" testID={`${testID}-save`} disabled={primary.disabled} onPress={primary.onPress} style={[s.dialogBtn, s.dialogPrimary, primary.disabled && s.actionDisabled]}>
                <Text style={s.dialogPrimaryText}>{primary.label}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>;
  }
  if (sheet) {
    return <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.sheetOverlay}>
        <Pressable testID={`${testID}-backdrop`} accessibilityLabel="关闭" focusable={false} onPress={onClose} style={[StyleSheet.absoluteFill, s.dialogBackdrop]} />
        {/* 面板顶边 = 状态栏下沿 + 一小截(spacing.xs,露出后面的页面、看得出是 sheet);顶栏离状态栏
            ≤ 8(layout-sweep (b),和其它整屏弹窗一致)。把手叠在顶栏上方不占高度。 */}
        <View testID={testID} style={[s.sheetPanel, { marginTop: sheetSafe.paddingTop + spacing.xs, paddingBottom: sheetSafe.paddingBottom, paddingLeft: sheetSafe.paddingLeft, paddingRight: sheetSafe.paddingRight }]}>
          {phoneHeader}
          <View pointerEvents="none" style={s.sheetGrabber} />
          {children}
        </View>
      </View>
    </Modal>;
  }
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <View testID={testID} style={[s.modalRoot, safe]}>
      <MacTitleStrip />
      <WinTitleBar />
      {phoneHeader}
      {children}
    </View>
  </Modal>;
}

/** 桌面对话框:560 × 至多 720,窗口放不下时四周各留 24。 */
export function scheduleDialogSize(windowWidth: number, windowHeight: number): { width: number; height: number } {
  return { width: Math.max(0, Math.min(560, windowWidth - 48)), height: Math.max(0, Math.min(720, windowHeight - 48)) };
}

export function Label({ text, children }: { text: string; children: ReactNode }) { const s = useMemo(makeStyles, []); return <View style={s.field}><Text style={s.label}>{text}</Text>{children}</View>; }

/** 两个按钮的小确认框(取消计划 / 放弃修改)。 */
function ScheduleConfirm({ visible, title, message, backLabel, confirmLabel, busy = false, testID, onClose, onConfirm }: {
  visible: boolean;
  title: string;
  message?: string;
  backLabel: string;
  confirmLabel: string;
  busy?: boolean;
  testID?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const s = useMemo(makeStyles, [visible]);
  const safe = useModalSafePadding('fullScreen');
  return <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
    <View style={[s.confirmOverlay, withBasePadding(safe, spacing.xl)]}>
      <View style={s.confirmCard} testID={testID}>
        <Text style={s.confirmTitle}>{title}</Text>
        {message ? <Text style={s.confirmMessage}>{message}</Text> : null}
        <View style={s.confirmActions}>
          <Pressable testID={testID ? `${testID}-back` : undefined} disabled={busy} style={[s.confirmButton, busy && s.actionDisabled]} onPress={onClose}><Text style={s.actionText}>{backLabel}</Text></Pressable>
          <Pressable testID={testID ? `${testID}-ok` : undefined} disabled={busy} style={[s.confirmButton, s.confirmDanger, busy && s.actionDisabled]} onPress={onConfirm}><Text style={s.dangerText}>{confirmLabel}</Text></Pressable>
        </View>
      </View>
    </View>
  </Modal>;
}

export function CancelScheduleModal({ value, busy, onClose, onConfirm }: {
  value: HubScheduledTask | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return <ScheduleConfirm visible={!!value} title="取消计划？" message={value?.name} backLabel="返回" confirmLabel="取消计划" busy={busy} testID="schedule-cancel-confirm" onClose={onClose} onConfirm={onConfirm} />;
}

/** 编辑器 + 定时任务页共用的样式(定时任务页的 makeStyles 在它上面再加列表 / 详情自己的)。按主题现取颜色。 */
export function scheduleStyleDefs() { return {
  flex: { flex: 1 },
  primarySmall: { backgroundColor: colors.accent, borderRadius: radius.control, paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center' }, primaryText: { color: colors.onAccent, fontWeight: weight.strong, fontSize: fontSize.body },
  pill: { flexShrink: 0, fontSize: fontSize.caption, fontWeight: weight.medium, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  timeHint: { color: colors.blocked, fontSize: 11, marginTop: spacing.xs },
  sectionLabel: { color: colors.textMuted, fontSize: fontSize.small, fontWeight: weight.medium, marginTop: spacing.xl, marginBottom: spacing.sm },
  meta: { color: colors.textMuted, fontSize: 11, marginTop: spacing.xs }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }, action: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center' }, actionText: { color: colors.textSecondary, fontSize: fontSize.body }, danger: { borderColor: `${colors.failed}50` }, dangerText: { color: colors.failed, fontSize: fontSize.body },
  error: { color: colors.failed, marginHorizontal: spacing.lg, marginBottom: spacing.md, fontSize: 13 },
  conflict: { borderWidth: 1, borderColor: `${colors.blocked}80`, borderRadius: radius.control, padding: spacing.md, marginBottom: spacing.md, gap: spacing.xs },
  conflictTitle: { color: colors.text, fontSize: fontSize.body, fontWeight: weight.strong },
  conflictField: { marginTop: spacing.sm },
  conflictSide: { color: colors.textMuted, fontSize: 11, marginTop: spacing.xs },
  conflictValue: { color: colors.text, fontSize: 13 }, muted: { color: colors.textMuted, fontSize: 13 },
  modalRoot: { flex: 1, backgroundColor: colors.bg }, modalHeader: { minHeight: 58, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border }, modalTitle: { flex: 1, textAlign: 'center', color: colors.text, fontWeight: '600', fontSize: 16 }, link: { color: colors.accent, fontSize: 15 }, headerSide: { minWidth: 56, minHeight: 44, justifyContent: 'center' }, headerSideEnd: { alignItems: 'flex-end' }, form: { padding: spacing.lg, paddingBottom: 60 }, field: { marginBottom: spacing.lg }, label: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.sm }, input: { color: colors.text, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.control, paddingHorizontal: spacing.md, paddingVertical: 11 }, textarea: { minHeight: 100, textAlignVertical: 'top' },
  watcherField: { minHeight: 48, marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.control },
  watcherOpen: { flex: 1 },
  watcherPlaceholder: { color: colors.textMuted, fontSize: fontSize.body },
  watcherChips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  watcherChip: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%', height: 28, paddingLeft: 3, paddingRight: 8, borderRadius: radius.pill, backgroundColor: colors.subtleFill },
  watcherChipText: { color: colors.text, fontSize: 13, flexShrink: 1 },
  segment: { flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, overflow: 'hidden' }, segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 10, backgroundColor: colors.card }, segmentActive: { backgroundColor: colors.accent }, segmentText: { color: colors.textMuted, fontSize: 12 }, segmentTextActive: { color: colors.onAccent, fontSize: 12, fontWeight: '600' }, weekdays: { flexDirection: 'row', justifyContent: 'space-between' }, day: { width: 38, height: 38, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }, dayActive: { backgroundColor: colors.accent, borderColor: colors.accent }, dayTextActive: { color: colors.onAccent, fontWeight: '600' },
  linkDisabled: { opacity: 0.4 },
  actionDisabled: { opacity: 0.4 },
  // 桌面对话框(ScheduleModal):居中卡片,标题左对齐 + ✕,底部右对齐「取消」「保存」,按钮 32 高。
  dialogOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dialogBackdrop: { backgroundColor: 'rgba(0,0,0,0.38)' },
  // 按 size 的 height 定高:不叠 modalRoot(flex: 1)再用 flexBasis: 'auto' 撤回 —— 那招只在 RN-web 生效,
  // 原生 Yoga 里 flex > 0 时 flexBasis: 'auto' 等于没写,基准取 0(flex-basis-auto-rule.test.ts)。
  dialogPanel: { flexShrink: 1, backgroundColor: colors.bg, borderRadius: radius.surface, overflow: 'hidden', ...elevated('floating') } as any,
  dialogHeader: { minHeight: 52, paddingLeft: spacing.lg, paddingRight: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  dialogTitle: { flex: 1, color: colors.text, fontWeight: '600', fontSize: 15 },
  dialogClose: { width: 28, height: 28, borderRadius: radius.item, alignItems: 'center', justifyContent: 'center' },
  dialogFooter: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  dialogBtn: { height: 32, minWidth: 72, paddingHorizontal: spacing.md, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  dialogBtnHover: { backgroundColor: colors.rowHover },
  dialogBtnText: { color: colors.text, fontSize: 13 },
  dialogPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  dialogPrimaryText: { color: colors.onAccent, fontSize: 13, fontWeight: '600' },
  // 手机全高底部 sheet(ScheduleModal sheet):遮罩铺满,面板贴底、顶边圆角 + 把手。
  sheetOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheetPanel: { flex: 1, backgroundColor: colors.bg, borderTopLeftRadius: radius.surface, borderTopRightRadius: radius.surface, overflow: 'hidden', ...elevated('floating', 'top') } as any,
  sheetGrabber: { position: 'absolute', top: spacing.xs, left: '50%', marginLeft: -18, width: 36, height: 4, borderRadius: radius.pill, backgroundColor: colors.border },
  confirmOverlay: { flex: 1, backgroundColor: '#00000099', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  confirmCard: { width: '100%', maxWidth: 420, backgroundColor: colors.card, borderRadius: radius.surface, padding: spacing.xl, ...elevated('floating') },
  confirmTitle: { color: colors.text, fontSize: 18, fontWeight: '600' },
  confirmMessage: { color: colors.textSecondary, fontSize: 14, marginTop: spacing.md },
  confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.xl },
  confirmButton: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, paddingHorizontal: 16, paddingVertical: 9 },
  confirmDanger: { borderColor: `${colors.failed}70` },
} as const; }

function makeStyles() { return StyleSheet.create({
  ...scheduleStyleDefs(),
  formLocked: { opacity: 0.5 },
  manage: { marginBottom: spacing.lg, paddingBottom: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  manageHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  manageNext: { flexShrink: 1, color: colors.textMuted, fontSize: fontSize.small },
  runs: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.control, paddingHorizontal: spacing.md },
  runRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10, minHeight: 44, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  runRowLast: { borderBottomWidth: 0 },
  runText: { flex: 1, minWidth: 0 },
  runTime: { color: colors.text, fontSize: fontSize.body },
  runError: { color: colors.textMuted, fontSize: fontSize.small, marginTop: 2 },
}); }
