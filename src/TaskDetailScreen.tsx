import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import { taskText } from './i18n-tasks';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import {
  fetchTaskInspection,
  fetchTaskEvents,
  HubConfig,
  HubTask,
  HubTaskEvent,
  FetchTaskEventsResult,
} from './api';
import {
  eventsResultToState,
  statusBucket,
  POLL_DETAIL_MS,
  type StatusBucket,
} from './tasks-filter';
import { colors, onThemeChange, spacing, radius } from './theme';
import { formatTime } from './time';
import { usePoll } from './usePoll';
import { PANE_BACK_TEST_ID, paneShowsBack } from './pane-header';
import { elevated, buttonStyle, buttonTextStyle } from './elevation';
import TaskExecutionNotice from './TaskExecutionNotice';
import type { TaskDiagnostic } from './task-execution';

// Detail screen for one task. Mirrors the dashboard `/tasks` detail
// pane's four blocks (timeline, info, content, result), pared down for
// the phone: full-screen list of stacked cards, no side pane, no
// keyboard input. Events feed is a distinct fifth block with an
// explicit "not-wired" state — see api.ts fetchTaskEvents + eventsResultToState.

const BUCKET_COLOR: Record<StatusBucket, string> = {
  running: colors.running,
  failed: colors.failed,
  replied: colors.accent,
  pending: colors.blocked,
  unknown: colors.rest,
};

interface TimelineStep {
  key: string;
  label: string;
  at?: string;
}

function buildTimeline(task: HubTask): TimelineStep[] {
  return [
    { key: 'created',   label: tr('tasks.copy.122'),   at: task.created_at },
    { key: 'delivered', label: tr('tasks.copy.147'), at: task.delivered_at },
    { key: 'started',   label: tr('tasks.copy.148'),   at: task.started_at },
    { key: 'completed', label: tr('tasks.copy.149'),   at: task.completed_at },
  ];
}

export default function TaskDetailScreen({
  cfg,
  taskId,
  onBack,
  desktop = false,
}: {
  cfg: HubConfig;
  taskId: string;
  onBack: () => void;
  /** Tauri desktop workspace: the rail's 任务 is the way back — no phone back (pane-header.ts). */
  desktop?: boolean;
}) {
  useTranslation();
  const [task, setTask] = useState<HubTask | null>(null);
  const [diagnostic, setDiagnostic] = useState<TaskDiagnostic | null>(null);
  const [taskLoaded, setTaskLoaded] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [eventsResult, setEventsResult] = useState<FetchTaskEventsResult | null>(null);
  const scope = useRef({ cfg, taskId });
  scope.current = { cfg, taskId };

  const load = useCallback(async () => {
    try {
      const inspection = await fetchTaskInspection(cfg, taskId);
      if (scope.current.cfg !== cfg || scope.current.taskId !== taskId) return;
      setTask(inspection.task);
      setDiagnostic(inspection.diagnostic);
      setTaskError(null);
    } catch (e) {
      if (scope.current.cfg !== cfg || scope.current.taskId !== taskId) return;
      setTaskError(e instanceof Error ? e.message : String(e));
    } finally {
      if (scope.current.cfg === cfg && scope.current.taskId === taskId) setTaskLoaded(true);
    }
    // Events feed: fetch in parallel via its discriminated helper. Its
    // return type already encodes the three failure kinds — we never
    // swallow them. See tasks-filter.eventsResultToState().
    const evR = await fetchTaskEvents(cfg, taskId);
    if (scope.current.cfg !== cfg || scope.current.taskId !== taskId) return;
    setEventsResult(evR);
  }, [cfg, taskId]);

  useEffect(() => {
    setTask(null);
    setDiagnostic(null);
    setTaskLoaded(false);
    setTaskError(null);
    setEventsResult(null);
  }, [taskId, cfg]);

  usePoll(load, POLL_DETAIL_MS, [load]);

  const eventsState = eventsResultToState(eventsResult);

  return (
    <View
      style={styles.root}
      testID={`task-detail-screen-poll-detail-ms-${POLL_DETAIL_MS}`}
    >
      <View style={styles.header} testID="screen-header">
        {paneShowsBack(desktop) ? (
          <Pressable onPress={onBack} style={styles.backBtn} testID={PANE_BACK_TEST_ID}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
            <Text style={styles.backText}>{tr('tasks.copy.41')}</Text>
          </Pressable>
        ) : (
          <Text style={styles.paneTitle}>{tr('tasks.copy.145')}</Text>
        )}
        <Text style={styles.taskIdChip} numberOfLines={1}>
          {taskId}
        </Text>
      </View>

      {!taskLoaded ? (
        <View style={styles.center} testID="task-detail-loading">
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : taskError && !task ? (
        <View style={styles.center} testID="task-detail-error">
          <Text style={styles.errTitle}>{tr('tasks.copy.150')}</Text>
          <Text style={styles.errBody}>{taskError}</Text>
          <Pressable onPress={load} style={styles.retryBtn}>
            <Text style={styles.retryText}>{tr('tasks.copy.57')}</Text>
          </Pressable>
        </View>
      ) : !task ? (
        <View style={styles.center} testID="task-detail-not-found">
          <Text style={styles.errTitle}>{tr('tasks.copy.151')}</Text>
          <Text style={styles.errBody}>task_id = {taskId}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          {taskError ? <Text style={styles.errBody} testID="task-execution-stale">{tr('execution.stale')}</Text> : null}
          <Section title={tr('execution.title')} testID="task-detail-block-execution">
            <TaskExecutionNotice task={task} diagnostic={diagnostic} detail />
          </Section>
          {/* Block 1 — TIMELINE */}
          <Section title={tr('tasks.copy.152')} testID="task-detail-block-timeline">
            <View style={styles.timelineRow}>
              {buildTimeline(task).map((step, i, arr) => (
                <View key={step.key} style={styles.timelineStep}>
                  <View
                    style={[
                      styles.timelineDot,
                      { backgroundColor: step.at ? colors.accent : colors.border },
                    ]}
                  />
                  <Text style={styles.timelineLabel}>{step.label}</Text>
                  <Text style={styles.timelineTime}>
                    {step.at ? formatTime(step.at) : '—'}
                  </Text>
                  {i < arr.length - 1 ? <View style={styles.timelineBar} /> : null}
                </View>
              ))}
            </View>
          </Section>

          {/* Block 2 — INFO */}
          <Section title={tr('tasks.copy.153')} testID="task-detail-block-info">
            <InfoRow label="task_id" value={task.task_id ?? '—'} monospace />
            <InfoRow
              label={tr('tasks.copy.54')}
              valueNode={
                <View style={styles.statusInline}>
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: BUCKET_COLOR[statusBucket(task.status)] },
                    ]}
                  />
                  <Text style={styles.infoVal}>{task.status || 'pending'}</Text>
                </View>
              }
            />
            <InfoRow
              label={tr('tasks.copy.32')}
              value={task.priority === 'high' ? 'HIGH' : task.priority || 'normal'}
            />
            <InfoRow
              label={tr('tasks.copy.154')}
              valueNode={
                <View style={styles.aliasInline}>
                  <AliasAvatar alias={task.from_name || '?'} size={20} />
                  <Text style={styles.infoVal}>{task.from_name || '?'}</Text>
                </View>
              }
            />
            <InfoRow
              label={tr('tasks.copy.155')}
              valueNode={
                <View style={styles.aliasInline}>
                  <AliasAvatar alias={task.to_name || '?'} size={20} />
                  <Text style={styles.infoVal}>{task.to_name || '?'}</Text>
                </View>
              }
            />
            {task.expires_at ? (
              <InfoRow label={tr('tasks.copy.156')} value={formatTime(task.expires_at)} />
            ) : null}
          </Section>

          {/* Block 3 — CONTENT */}
          <Section title={tr('tasks.copy.157')} testID="task-detail-block-content">
            <Text style={styles.bodyText} selectable>
              {task.content || tr('tasks.copy.158')}
            </Text>
          </Section>

          {/* Block 4 — RESULT (only if the task actually has a reply). Absence
              of a result is real (the task hasn't been replied yet) — render
              a visible "尚未回复" placeholder rather than dropping the block
              silently, per the /messages parity discipline that "empty" and
              "not wired" must look different. */}
          <Section title={tr('tasks.copy.159')} testID="task-detail-block-result">
            <Text
              style={[styles.bodyText, !task.result ? styles.bodyMuted : null]}
              selectable
            >
              {task.result || tr('tasks.copy.160')}
            </Text>
          </Section>

          {/* Block 5 — EVENTS FEED — 4-state render, never silently omitted.
              🔴 A blank block can't distinguish "hub 未暴露" from "本来无 events"
              from "connection failed" — an unknown UI state has to say what
              it doesn't know AND where the user can look. Each state gets
              its own banner + testID so QA can tell them apart. */}
          <Section title={tr('tasks.copy.161')} testID="task-detail-block-events">
            {eventsState.kind === 'loading' ? (
              <ActivityIndicator color={colors.textMuted} testID="task-events-loading" />
            ) : eventsState.kind === 'ok' ? (
              eventsState.count === 0 ? (
                <Text
                  style={[styles.bodyText, styles.bodyMuted]}
                  testID="task-events-ok-empty"
                >
                  {tr('tasks.copy.162')}</Text>
              ) : (
                <View testID="task-events-ok-list">
                  {eventsState.events.map((ev, i) => (
                    <EventRow key={ev.id ?? i} ev={ev} />
                  ))}
                </View>
              )
            ) : eventsState.kind === 'not-wired' ? (
              <View style={styles.notWiredBanner} testID="task-events-not-wired">
                <Text style={styles.notWiredTitle}>{tr('tasks.copy.163')}</Text>
                <Text style={styles.notWiredBody}>
                  {tr('tasks.copy.164')}</Text>
                <Text style={styles.notWiredErr} numberOfLines={2}>
                  {eventsState.error}
                </Text>
              </View>
            ) : (
              <View style={styles.errorBanner} testID="task-events-error">
                <Text style={styles.errorTitleSm}>{tr('tasks.copy.165')}</Text>
                <Text style={styles.errorBodySm}>{eventsState.error}</Text>
              </View>
            )}
          </Section>

          {/* Transient task-detail refresh error — the previously loaded
              task stays visible; we surface the error non-intrusively. */}
          {taskError && task ? (
            <Text
              style={styles.transientError}
              testID="task-detail-transient-error"
            >
              {tr('tasks.copy.166')}{taskError}
            </Text>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function Section({
  title,
  children,
  testID,
}: {
  title: string;
  children: React.ReactNode;
  testID: string;
}) {
  useTranslation();
  return (
    <View style={styles.section} testID={testID}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function InfoRow({
  label,
  value,
  valueNode,
  monospace,
}: {
  label: string;
  value?: string;
  valueNode?: React.ReactNode;
  monospace?: boolean;
}) {
  useTranslation();
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLbl}>{label}</Text>
      {valueNode ? (
        <View style={{ flexShrink: 1 }}>{valueNode}</View>
      ) : (
        <Text
          style={[styles.infoVal, monospace ? styles.mono : null]}
          numberOfLines={1}
        >
          {value}
        </Text>
      )}
    </View>
  );
}

function EventRow({ ev }: { ev: HubTaskEvent }) {
  useTranslation();
  return (
    <View style={styles.eventRow}>
      <View style={styles.eventBullet} />
      <View style={{ flex: 1 }}>
        <Text style={styles.eventTitle} numberOfLines={1}>
          {ev.event_type || '(unnamed)'}
          {ev.from_status && ev.to_status ? (
            <Text style={styles.eventTransition}>
              {' '}
              {ev.from_status} → {ev.to_status}
            </Text>
          ) : null}
        </Text>
        {ev.detail ? (
          <Text style={styles.eventDetail} numberOfLines={2}>
            {ev.detail}
          </Text>
        ) : null}
        <Text style={styles.eventTime}>{formatTime(ev.created_at)}</Text>
      </View>
    </View>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: spacing.md,
    },
    backBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
    backText: { color: colors.text, fontSize: 15 },
    paneTitle: { color: colors.text, fontSize: 17, fontWeight: '600', paddingVertical: spacing.xs },
    taskIdChip: {
      flex: 1,
      color: colors.textMuted,
      fontSize: 12,
      fontFamily: 'monospace',
      textAlign: 'right',
    },
    section: {
      backgroundColor: colors.card,
      borderRadius: radius.surface,
      padding: spacing.lg,
      gap: spacing.sm,
      ...elevated('raised'),
    },
    sectionTitle: { color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' },
    sectionBody: { gap: spacing.sm },
    timelineRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    timelineStep: { flex: 1, alignItems: 'center', gap: 4, position: 'relative' },
    timelineDot: { width: 10, height: 10, borderRadius: radius.pill },
    timelineLabel: { color: colors.textSecondary, fontSize: 11 },
    timelineTime: { color: colors.textMuted, fontSize: 10, textAlign: 'center' },
    timelineBar: {
      position: 'absolute',
      top: 4,
      left: '60%',
      right: '-40%',
      height: 2,
      backgroundColor: colors.border,
      zIndex: -1,
    },
    infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    infoLbl: { color: colors.textMuted, fontSize: 12 },
    infoVal: { color: colors.text, fontSize: 13, flexShrink: 1 },
    mono: { fontFamily: 'monospace', fontSize: 11 },
    statusInline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    statusDot: { width: 8, height: 8, borderRadius: radius.pill },
    aliasInline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    bodyText: { color: colors.text, fontSize: 14, lineHeight: 20 },
    bodyMuted: { color: colors.textMuted, fontStyle: 'italic' },
    notWiredBanner: {
      padding: spacing.md,
      backgroundColor: colors.blocked + '15',
      borderColor: colors.blocked,
      borderWidth: 1,
      borderRadius: radius.control,
      gap: spacing.xs,
    },
    notWiredTitle: { color: colors.blocked, fontSize: 13, fontWeight: '600' },
    notWiredBody: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
    notWiredErr: { color: colors.textMuted, fontSize: 10, fontFamily: 'monospace' },
    errorBanner: {
      padding: spacing.md,
      backgroundColor: colors.failed + '15',
      borderColor: colors.failed,
      borderWidth: 1,
      borderRadius: radius.control,
      gap: 4,
    },
    errorTitleSm: { color: colors.failed, fontSize: 12, fontWeight: '600' },
    errorBodySm: { color: colors.textSecondary, fontSize: 11 },
    eventRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      paddingVertical: spacing.xs + 2,
    },
    eventBullet: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: colors.accent, marginTop: 6 },
    eventTitle: { color: colors.text, fontSize: 12, fontWeight: '600' },
    eventTransition: { color: colors.textMuted, fontWeight: '400' },
    eventDetail: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
    eventTime: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
    retryBtn: { ...buttonStyle('secondary'), marginTop: spacing.md },
    retryText: { ...buttonTextStyle('secondary') },
    errTitle: { color: colors.failed, fontSize: 14, fontWeight: '600', marginBottom: spacing.sm },
    errBody: { color: colors.textSecondary, fontSize: 12, textAlign: 'center' },
    transientError: {
      color: colors.failed,
      fontSize: 11,
      textAlign: 'center',
      marginTop: spacing.sm,
    },
  });

let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
