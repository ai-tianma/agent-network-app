import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
// 任务页的「动态」视图(#429,Vincent 2026-09-30「任务有新的状态…这完成了,这是有这种动态」)。
// 数据:Hub 的 GET /api/requirements/events(capability events);逻辑在 task-activity-model.ts。
// 桌面:左边一列大日期(周几 / 30 / 9月),右边按时间一行一条;行首时刻 +「N 次」,头像,上一行「☑ #N 标题 · 项目」,
//       下一行「谁 做了什么」;同一人几分钟内对同一张卡的连续改动并成「更新了 N 项」,点「展开」看每一项。
//       筛选是工具栏上的三个下拉(项目 / 成员·Agent / 类型),下拉里带条数。
// 手机:单列;每天一个段头「今天 9月30日 周三 · 14 条」,一行 = 头像 +「谁 做了什么」+ 右上时刻,下面一行是卡片;
//       筛选是一个「筛选」按钮 → 底部面板(项目 / 成员·Agent / 事件类型,底部「查看 N 条」)。不是把桌面挤窄。
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from './ui-text';
import CommentBody from './comment-body';
import { timeTextFloor } from './chat-time-layout';
import { uiScale } from './ui-scale';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import type { HubConfig } from './api';
import { colors, radius, spacing, type as typeScale, weight } from './theme';
import { elevated } from './elevation';
import { useModalSafePadding } from './safe-area-runtime';
import { menuMaxHeight } from './modal-bounds';
import { REQ_COLUMN_LABEL, type Requirement, type RequirementProject } from './requirements-model';
import type { RequirementPerson, RequirementPersonRef } from './requirement-people';
import { fetchRequirementEvents } from './requirements-hub';
import { usePoll } from './usePoll';
import { taskText } from './i18n-tasks';
import { personDisplay } from './task-board-model';
import { PRIORITY_CODE } from './task-priority';
import { PriorityBadge, STATUS_TONE, Segmented, a11yState, type TaskStyles } from './TaskBoardParts';
import {
  ACTIVITY_TYPES, ACTIVITY_WINDOW_MS, EMPTY_ACTIVITY_FILTER, FIELD_KEY, activityFilterCount, activityType, actorKey, collapseEvents, countBy, dayLabel,
  describe, fieldSummary, filterEvents, groupByDay, mergeEvents, parseEvents, tally, type ActivityEvent, type ActivityFilter, type ActivityRow, type ActivityType, type Part,
} from './task-activity-model';

const POLL_MS = 20_000;
const PAGE = 500;
const WEEK = ['tasks.copy.167', 'tasks.copy.168', 'tasks.copy.169', 'tasks.copy.170', 'tasks.copy.171', 'tasks.copy.172', 'tasks.copy.173'];
// 切到别的视图再回来,筛选保持(本次启动内)。
let lastFilter: ActivityFilter = EMPTY_ACTIVITY_FILTER;

type Props = {
  cfg: HubConfig;
  items: readonly Requirement[];
  projects: readonly RequirementProject[] | null;
  people: readonly RequirementPerson[];
  meId: string | null;
  s: TaskStyles;
  phone: boolean;
  onOpen: (id: string) => void;
};

/** 读:先读近 7 天,之后每 POLL_MS 读 server_time 之后的;「加载更早」按 next_cursor 往前翻。 */
function useActivity(cfg: HubConfig) {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [error, setError] = useState('');
  const [older, setOlder] = useState<{ cursor: string | null; loading: boolean }>({ cursor: null, loading: false });
  const since = useRef<string | null>(null);
  const key = `${cfg.serverUrl}|${cfg.networkId ?? ''}|${cfg.token}`;
  const keyRef = useRef(key);
  if (keyRef.current !== key) { keyRef.current = key; since.current = null; }
  const load = useCallback(async () => {
    const k = key;
    try {
      const first = since.current === null;
      const page = parseEvents(await fetchRequirementEvents(cfg, { since: first ? new Date(Date.now() - ACTIVITY_WINDOW_MS).toISOString() : since.current, limit: PAGE }));
      if (keyRef.current !== k) return;
      // 一拍里新事件多到一页装不下:从头再读一遍(按 id 去重,不会重复)。
      if (!first && page.hasMore) { since.current = null; setEvents(null); return; }
      since.current = page.serverTime ?? since.current;
      setEvents(prev => (first ? page.events : mergeEvents(prev ?? [], page.events)));
      if (first) setOlder({ cursor: page.nextCursor ?? (page.events.length ? page.events[page.events.length - 1].id : null), loading: false });
      setError('');
    } catch (e) {
      if (keyRef.current === k) setError(e instanceof Error ? e.message : String(e));
    }
  }, [key]);
  usePoll(load, POLL_MS, [load]);
  const loadOlder = useCallback(async () => {
    if (!older.cursor || older.loading) return;
    setOlder(o => ({ ...o, loading: true }));
    try {
      const page = parseEvents(await fetchRequirementEvents(cfg, { cursor: older.cursor, limit: PAGE }));
      setEvents(prev => mergeEvents(prev ?? [], page.events));
      setOlder({ cursor: page.hasMore ? page.nextCursor : null, loading: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOlder(o => ({ ...o, loading: false }));
    }
  }, [key, older.cursor, older.loading]);
  return { events, error, reload: load, older, loadOlder };
}

const pad = (n: number) => String(n).padStart(2, '0');
const hm = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const weekdayIdx = (day: string) => { const [y, m, d] = day.split('-').map(Number); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; };
/** 预计完成 / 开始:「10月3日」,带时刻的「10月3日 18:00」(本地)。 */
const dueText = (v: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return tr('tasks.monthDay', { m: +v.slice(5, 7), d: +v.slice(8, 10) });
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return v;
  const d = new Date(ms);
  return `${tr('tasks.monthDay', { m: d.getMonth() + 1, d: d.getDate() })} ${hm(ms)}`;
};

export default function TaskActivity(props: Props) {
  useTranslation();
  const c = useMemo(makeStyles, []);
  const { events, error, reload, older, loadOlder } = useActivity(props.cfg);
  const [filter, setFilterState] = useState<ActivityFilter>(lastFilter);
  const setFilter = (f: ActivityFilter) => { lastFilter = f; setFilterState(f); };
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const cards = useMemo(() => new Map(props.items.map(i => [i.id, i])), [props.items]);
  const all = events ?? [];
  const shown = useMemo(() => filterEvents(all, filter, cards, props.meId), [all, filter, cards, props.meId]);
  const days = useMemo(() => groupByDay(collapseEvents(shown)), [shown]);
  const toggle = (key: string) => setExpanded(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const view: ViewCtx = { ...props, c, cards, expanded, toggle };

  if (!events) {
    return (
      <View style={c.center} testID="activity-loading">
        {error ? (
          <>
            <Text style={props.s.err}>{tr('act.loadFailed', { msg: error })}</Text>
            <Pressable onPress={() => { void reload(); }} accessibilityRole="button" testID="activity-retry"><Text style={props.s.link}>{tr('act.retry')}</Text></Pressable>
          </>
        ) : <Text style={props.s.muted}>{tr('act.loading')}</Text>}
      </View>
    );
  }
  const toolbar = props.phone
    ? <PhoneToolbar {...view} all={all} filter={filter} setFilter={setFilter} />
    : <DesktopToolbar {...view} all={all} filter={filter} setFilter={setFilter} />;
  const now = Date.now();
  return (
    <View style={{ flex: 1 }} testID="task-activity">
      {toolbar}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={props.phone ? c.phoneBody : c.desktopBody} testID="activity-scroll">
        {days.length === 0 ? (
          <Text style={[props.s.muted, c.empty]} testID="activity-empty">{shown.length === all.length ? tr('act.empty') : tr('act.emptyFiltered')}</Text>
        ) : days.map(d => (props.phone ? <PhoneDay key={d.day} {...view} day={d.day} rows={d.rows} count={d.count} now={now} /> : <DesktopDay key={d.day} {...view} day={d.day} rows={d.rows} count={d.count} now={now} />))}
        {older.cursor ? (
          <Pressable accessibilityRole="button" onPress={() => { void loadOlder(); }} style={({ pressed }) => [c.older, pressed && { opacity: 0.7 }]} testID="activity-older">
            <Text style={props.s.link}>{older.loading ? tr('act.loading') : tr('act.older')}</Text>
          </Pressable>
        ) : days.length ? <Text style={[props.s.muted, c.end]} testID="activity-end">{tr('act.end')}</Text> : null}
      </ScrollView>
    </View>
  );
}

type ViewCtx = Props & { c: Styles; cards: ReadonlyMap<string, Requirement>; expanded: ReadonlySet<string>; toggle: (key: string) => void };

// ── 片段 ──

function Who({ who, people, c, strong = true }: { who: RequirementPersonRef | null; people: readonly RequirementPerson[]; c: Styles; strong?: boolean }) {
  if (!who) return <Text style={c.who}>{tr('act.unknown')}</Text>;
  const name = personDisplay(who, people).name;
  return (
    <>
      <Text style={strong ? c.who : c.text}>{name}</Text>
      {who.kind === 'node' ? <View style={c.agentTag}><Text style={c.agentTagText}>{tr('act.agent')}</Text></View> : null}
    </>
  );
}

function Avatar({ who, people, size, c }: { who: RequirementPersonRef | null; people: readonly RequirementPerson[]; size: number; c: Styles }) {
  const name = who ? personDisplay(who, people).name : '?';
  return (
    <View style={{ width: size, height: size }}>
      <AliasAvatar alias={name} size={size} />
      {who?.kind === 'node' ? <View style={c.agentBadge}><Ionicons name="hardware-chip-outline" size={9} color={colors.onAccent} /></View> : null}
    </View>
  );
}

function PartView({ part, v }: { part: Part; v: ViewCtx }) {
  const { c, s, people, projects } = v;
  switch (part.t) {
    case 'text': {
      const vars = part.key === 'act.setField' && part.vars ? { field: tr(FIELD_KEY[String(part.vars.field)] ?? 'act.f.other') } : part.vars;
      return <Text style={c.text}>{tr(part.key, vars)}</Text>;
    }
    case 'quote': return <Text style={[c.text, part.strike && c.strike]} numberOfLines={2}>{`「${part.v}」`}</Text>;
    case 'status':
      return (
        <View style={[c.pill, { backgroundColor: colors.subtleFill }]}>
          <View style={[c.dot, { backgroundColor: STATUS_TONE[part.v]() }]} />
          <Text style={c.pillText}>{taskText(REQ_COLUMN_LABEL[part.v])}</Text>
        </View>
      );
    case 'priority': return <PriorityBadge p={part.v} s={s} testID="activity-prio" />;
    case 'project': {
      const p = part.id ? (projects ?? []).find(x => x.id === part.id) : undefined;
      return (
        <View style={[c.pill, { backgroundColor: p ? p.color + '1f' : colors.subtleFill }]}>
          <View style={[c.dot, { backgroundColor: p?.color ?? colors.textMuted }]} />
          <Text style={c.pillText} numberOfLines={1}>{p?.name ?? tr('act.noProject')}</Text>
        </View>
      );
    }
    case 'tag': return <View style={[c.pill, c.tagPill]}><Text style={c.tagText} numberOfLines={1}>{part.v}</Text></View>;
    case 'person':
      return (
        <View style={c.personInline}>
          <Avatar who={part.ref} people={people} size={18} c={c} />
          <Who who={part.ref} people={people} c={c} strong={false} />
        </View>
      );
    case 'date': return <Text style={[c.text, part.strike && c.strike]}>{dueText(part.v)}</Text>;
    case 'check': return <Ionicons name={part.done ? 'checkbox' : 'square-outline'} size={16} color={part.done ? colors.accent : colors.textMuted} />;
    case 'arrow': return <Text style={c.arrow}>→</Text>;
    // 评论整段换行显示(最多 8 行),不是一个小引号块:Agent 的进展说明往往有好几行。
    // #1831:正文按 Markdown 渲染;MarkdownMessage 不吃 numberOfLines,折叠交给 CommentBody 的 maxHeight + 展开。
    case 'comment': return (
      <View style={{ flexBasis: '100%', paddingLeft: spacing.sm, borderLeftWidth: 2, borderLeftColor: colors.border }}>
        <CommentBody text={part.v} clampLines={8} testID="activity-comment" />
      </View>
    );
  }
}

const Parts = ({ parts, v }: { parts: Part[]; v: ViewCtx }) => <>{parts.map((p, i) => <PartView key={i} part={p} v={v} />)}</>;

/** 这一行说了什么:单条 = 整句;并起来的 =「更新了 N 项:字段…」+ 展开。 */
function Sentence({ row, v, withWho = true }: { row: ActivityRow; v: ViewCtx; withWho?: boolean }) {
  const { c } = v;
  const single = row.events.length === 1;
  const d = single ? describe(row.events[0]) : null;
  const open = v.expanded.has(row.key);
  return (
    <View style={c.sentence}>
      {d?.done ? <Ionicons name="checkmark-circle" size={18} color={colors.running} /> : null}
      {withWho ? <Who who={row.actor} people={v.people} c={c} /> : null}
      {d ? <Parts parts={d.lead} v={v} /> : (
        <>
          <Text style={c.text}>{tr('act.updatedN', { n: row.events.length })}</Text>
          <Text style={c.fields} numberOfLines={1}>{fieldSummary(row).map(f => `${tr(FIELD_KEY[f.field] ?? 'act.f.other')}${f.n > 1 ? ` ×${f.n}` : ''}`).join('、')}</Text>
          <Pressable accessibilityRole="button" {...a11yState({ expanded: open })} onPress={() => v.toggle(row.key)} hitSlop={8} testID={`activity-expand-${row.key}`}>
            <Text style={c.expand}>{open ? tr('act.collapse') : tr('act.expand')} {open ? '▴' : '▾'}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function Details({ row, v }: { row: ActivityRow; v: ViewCtx }) {
  const { c } = v;
  if (row.events.length === 1 || !v.expanded.has(row.key)) return null;
  return (
    <View style={c.details} testID={`activity-details-${row.key}`}>
      {row.events.map(e => (
        <View key={e.id} style={c.detailRow}>
          {v.phone ? null : <Text style={c.detailTime}>{hm(e.ms)}</Text>}
          <View style={c.sentence}><Parts parts={describe(e).detail} v={v} /></View>
        </View>
      ))}
    </View>
  );
}

/** 「☑ #124 标题 · ● 项目」:卡在看板上就用它现在的标题和项目,删了 / 看不到就用事件里记的标题。 */
function CardLine({ row, v }: { row: ActivityRow; v: ViewCtx }) {
  const { c } = v;
  const card = v.cards.get(row.requirementId);
  const e = row.events[0];
  const project = card?.projectId ? (v.projects ?? []).find(p => p.id === card.projectId) : undefined;
  const seq = card?.seq ?? e.seq;
  const gone = row.events.some(x => x.kind === 'deleted');
  return (
    <View style={c.cardLine}>
      <Ionicons name="checkbox-outline" size={13} color={colors.textMuted} />
      <Text style={c.cardText} numberOfLines={1}>{seq ? `#${seq}  ` : ''}{card?.name ?? e.title}</Text>
      {project ? (
        <>
          <Text style={c.cardText}>·</Text>
          <View style={[c.dot, { backgroundColor: project.color }]} />
          <Text style={c.cardText} numberOfLines={1}>{project.name}</Text>
        </>
      ) : null}
      {gone ? <Text style={c.goneTag}>{tr('act.deletedCard')}</Text> : null}
    </View>
  );
}

// ── 桌面 ──

function DesktopDay({ day, rows, count, now, ...v }: ViewCtx & { day: string; rows: ActivityRow[]; count: number; now: number }) {
  const { c } = v;
  const label = dayLabel(day, now);
  return (
    <View style={c.dayBlock} testID={`activity-day-${day}`}>
      <View style={c.dateCol}>
        <Text style={c.dateWeek}>{tr('act.weekday', { wd: tr(WEEK[weekdayIdx(day)]) })}</Text>
        <Text style={[c.dateNum, label !== 'today' && { color: colors.textSecondary }]}>{+day.slice(8, 10)}</Text>
        <Text style={c.dateMonth}>{tr('act.month', { m: +day.slice(5, 7) })}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={c.dayRule}>
          <View style={c.ruleLine} />
          <Text style={c.ruleText}>{label ? `${tr(label === 'today' ? 'act.today' : 'act.yesterday')} · ` : ''}{tr('act.dayCount', { n: count })}</Text>
        </View>
        {rows.map(r => <DesktopRow key={r.key} row={r} v={v} />)}
      </View>
    </View>
  );
}

function DesktopRow({ row, v }: { row: ActivityRow; v: ViewCtx }) {
  const { c } = v;
  const [hover, setHover] = useState(false);
  const openable = v.cards.has(row.requirementId) && !row.events.some(e => e.kind === 'deleted');
  return (
    <View
      style={[c.row, hover && c.rowHover]}
      {...({ onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) } as object)}
      testID={`activity-row-${row.key}`}
    >
      <View style={c.timeCol}>
        <Text style={c.time}>{hm(row.ms)}</Text>
        {row.events.length > 1 ? <Text style={c.times}>{tr('act.times', { n: row.events.length })}</Text> : null}
      </View>
      <Avatar who={row.actor} people={v.people} size={32} c={c} />
      <View style={c.main}>
        <CardLine row={row} v={v} />
        <Sentence row={row} v={v} />
        <Details row={row} v={v} />
      </View>
      {openable && hover ? (
        <Pressable accessibilityRole="button" onPress={() => v.onOpen(row.requirementId)} style={c.openBtn} testID={`activity-open-${row.key}`}>
          <Text style={c.expand}>{tr('act.open')} →</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function DesktopToolbar({ all, filter, setFilter, ...v }: ViewCtx & { all: readonly ActivityEvent[]; filter: ActivityFilter; setFilter: (f: ActivityFilter) => void }) {
  const { c, s } = v;
  const [menu, setMenu] = useState<{ kind: 'project' | 'people' | 'type'; x: number; y: number } | null>(null);
  const refs = useRef<Record<string, any>>({});
  const open = (kind: 'project' | 'people' | 'type') => {
    const el = refs.current[kind];
    if (el?.measureInWindow) el.measureInWindow((x: number, y: number, _w: number, h: number) => setMenu({ kind, x, y: y + h + 4 }));
    else setMenu({ kind, x: spacing.xl, y: 96 });
  };
  const t = tally(all);
  const projectName = filter.project === 'none' ? tr('act.noProject') : (v.projects ?? []).find(p => p.id === filter.project)?.name;
  const chip = (kind: 'project' | 'people' | 'type', icon: string, label: string, on: boolean) => (
    <View ref={(r: any) => { refs.current[kind] = r; }} collapsable={false}>
      <Pressable accessibilityRole="button" {...a11yState({ selected: on })} onPress={() => open(kind)} style={[s.chip, on && s.chipOn]} testID={`activity-filter-${kind}`}>
        <Ionicons name={icon as any} size={14} color={on ? colors.accent : colors.textMuted} />
        <Text style={[s.chipText, on && s.chipTextOn]} numberOfLines={1}>{label}</Text>
        <Ionicons name="chevron-down" size={12} color={on ? colors.accent : colors.textMuted} />
      </Pressable>
    </View>
  );
  return (
    <View style={c.toolbar} testID="activity-toolbar">
      <Segmented s={s} items={[{ key: 'all', label: tr('act.all') }, { key: 'mine', label: tr('act.mine') }]} value={filter.mine ? 'mine' : 'all'} onChange={k => setFilter({ ...filter, mine: k === 'mine' })} testID="activity-scope" />
      {chip('project', 'folder-outline', projectName ?? tr('act.project'), !!filter.project)}
      {chip('people', 'person-outline', filter.actors.length ? tr('act.peopleN', { n: filter.actors.length }) : tr('act.people'), filter.actors.length > 0)}
      {chip('type', 'flash-outline', filter.types.length ? tr('act.typeN', { n: filter.types.length }) : tr('act.type'), filter.types.length > 0)}
      <Text style={c.tally} numberOfLines={1} testID="activity-tally">{tr('act.tally', t)}</Text>
      <FilterPopover {...v} all={all} filter={filter} setFilter={setFilter} menu={menu} onClose={() => setMenu(null)} />
    </View>
  );
}

/** 桌面下拉:勾选行 + 右边条数(按「除了这一项的其余筛选」数),底部「清除」。 */
function FilterPopover({ all, filter, setFilter, menu, onClose, ...v }: ViewCtx & { all: readonly ActivityEvent[]; filter: ActivityFilter; setFilter: (f: ActivityFilter) => void; menu: { kind: 'project' | 'people' | 'type'; x: number; y: number } | null; onClose: () => void }) {
  const safe = useModalSafePadding('fullScreen');
  const viewport = useWindowDimensions();
  const { c } = v;
  const width = 260;
  const opts = menuOptions(menu?.kind ?? 'type', all, filter, v);
  return (
    <Modal visible={!!menu} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} testID="activity-filter-scrim" />
      {menu ? (
        <View style={[c.popover, { left: Math.max(8, Math.min(menu.x, viewport.width - width - 8)), top: menu.y, width, maxHeight: menuMaxHeight(menu.y, viewport.height, safe.paddingTop, safe.paddingBottom, 440) }]} testID={`activity-menu-${menu.kind}`} accessibilityRole="menu">
          {menu.kind === 'type' ? <Text style={c.popTitle}>{tr('act.eventTypes')}</Text> : null}
          <ScrollView style={{ flexGrow: 0, flexShrink: 1 }}>
            {opts.map(o => (
              <Pressable key={o.key} accessibilityRole="checkbox" {...a11yState({ checked: o.on })} onPress={() => { setFilter(o.toggle()); if (menu.kind === 'project') onClose(); }}
                style={state => [c.popRow, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]} testID={`activity-opt-${o.key}`}>
                <Ionicons name={o.on ? 'checkbox' : 'square-outline'} size={16} color={o.on ? colors.accent : colors.textMuted} />
                {o.lead}
                <Text style={c.popLabel} numberOfLines={1}>{o.label}</Text>
                <Text style={c.popCount}>{o.n}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={c.popFoot}>
            <Pressable onPress={() => setFilter(clearKind(filter, menu.kind))} accessibilityRole="button" testID="activity-menu-clear"><Text style={c.popClear}>{tr('act.clear')}</Text></Pressable>
            {menu.kind === 'type' && filter.types.length ? <Text style={c.expand}>{tr('act.pickedTypes', { n: filter.types.length })}</Text> : null}
          </View>
        </View>
      ) : null}
    </Modal>
  );
}

const clearKind = (f: ActivityFilter, kind: 'project' | 'people' | 'type'): ActivityFilter =>
  kind === 'project' ? { ...f, project: '' } : kind === 'people' ? { ...f, actors: [] } : { ...f, types: [] };

type Opt = { key: string; label: string; n: number; on: boolean; lead: ReactNode; toggle: () => ActivityFilter };
/** 一个下拉 / 一组筛选里的选项;条数 = 其余筛选不变、只放开这一项时有几条。 */
function menuOptions(kind: 'project' | 'people' | 'type', all: readonly ActivityEvent[], f: ActivityFilter, v: ViewCtx): Opt[] {
  const base = filterEvents(all, clearKind(f, kind), v.cards, v.meId);
  if (kind === 'type') {
    const n = countBy(base, activityType);
    return ACTIVITY_TYPES.map(t => ({
      key: t, label: tr(`act.t.${t}`), n: n.get(t) ?? 0, on: f.types.includes(t), lead: null,
      toggle: () => ({ ...f, types: f.types.includes(t) ? f.types.filter(x => x !== t) : [...f.types, t] as ActivityType[] }),
    }));
  }
  if (kind === 'people') {
    const n = countBy(base, e => actorKey(e.actor));
    const keys = [...new Set([...all.map(e => actorKey(e.actor)).filter(Boolean), ...f.actors])];
    return keys.map(k => {
      const [kindPart, ...rest] = k.split(':');
      const who = { kind: kindPart as 'user' | 'node', id: rest.join(':') };
      return {
        key: k, label: personDisplay(who, v.people).name + (who.kind === 'node' ? ' · Agent' : ''), n: n.get(k) ?? 0, on: f.actors.includes(k),
        lead: <Avatar who={who} people={v.people} size={20} c={v.c} />,
        toggle: () => ({ ...f, actors: f.actors.includes(k) ? f.actors.filter(x => x !== k) : [...f.actors, k] }),
      };
    }).sort((a, b) => b.n - a.n || (a.label < b.label ? -1 : 1));
  }
  const n = countBy(base, e => { const card = v.cards.get(e.requirementId); return card ? card.projectId ?? 'none' : ''; });
  return [...(v.projects ?? []).filter(p => !p.archived), { id: 'none', name: tr('act.noProject'), color: colors.textMuted } as RequirementProject].map(p => ({
    key: p.id, label: p.name, n: n.get(p.id) ?? 0, on: f.project === p.id, lead: <View style={[v.c.dot, { backgroundColor: p.color }]} />,
    toggle: () => ({ ...f, project: f.project === p.id ? '' : p.id }),
  }));
}

// ── 手机 ──

function PhoneDay({ day, rows, count, now, ...v }: ViewCtx & { day: string; rows: ActivityRow[]; count: number; now: number }) {
  const { c } = v;
  const label = dayLabel(day, now);
  const md = tr('tasks.monthDay', { m: +day.slice(5, 7), d: +day.slice(8, 10) });
  return (
    <View testID={`activity-day-${day}`}>
      <View style={c.phoneDayHead}>
        <Text style={c.phoneDayLabel}>{label ? tr(label === 'today' ? 'act.today' : 'act.yesterday') : md}</Text>
        <Text style={c.phoneDaySub}>{label ? `${md} ` : ''}{tr('act.weekday', { wd: tr(WEEK[weekdayIdx(day)]) })}</Text>
        <View style={{ flex: 1 }} />
        <Text style={c.phoneDaySub}>{tr('act.dayCount', { n: count })}</Text>
      </View>
      {rows.map(r => <PhoneRow key={r.key} row={r} v={v} />)}
    </View>
  );
}

function PhoneRow({ row, v }: { row: ActivityRow; v: ViewCtx }) {
  const { c } = v;
  const openable = v.cards.has(row.requirementId) && !row.events.some(e => e.kind === 'deleted');
  return (
    <Pressable
      accessibilityRole={openable ? 'button' : undefined}
      onPress={openable ? () => v.onOpen(row.requirementId) : undefined}
      style={({ pressed }) => [c.phoneRow, pressed && openable && { backgroundColor: colors.rowHover }]}
      testID={`activity-row-${row.key}`}
    >
      <Avatar who={row.actor} people={v.people} size={36} c={c} />
      <View style={c.main}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
          <View style={{ flex: 1, minWidth: 0 }}><Sentence row={row} v={v} /></View>
          <Text style={c.time}>{hm(row.ms)}</Text>
        </View>
        <Details row={row} v={v} />
        <CardLine row={row} v={v} />
      </View>
    </Pressable>
  );
}

function PhoneToolbar({ all, filter, setFilter, ...v }: ViewCtx & { all: readonly ActivityEvent[]; filter: ActivityFilter; setFilter: (f: ActivityFilter) => void }) {
  const { c, s } = v;
  const [open, setOpen] = useState(false);
  const n = activityFilterCount(filter);
  return (
    <View style={c.phoneToolbar} testID="activity-toolbar">
      <Segmented s={s} items={[{ key: 'all', label: tr('act.all') }, { key: 'mine', label: tr('act.mine') }]} value={filter.mine ? 'mine' : 'all'} onChange={k => setFilter({ ...filter, mine: k === 'mine' })} testID="activity-scope" />
      <View style={{ flex: 1 }} />
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={[c.filterBtn, n > 0 && { backgroundColor: colors.tonalBg }]} testID="activity-filter-open">
        <Ionicons name="filter-outline" size={16} color={n ? colors.accent : colors.text} />
        <Text style={[c.text, n > 0 && { color: colors.accent }]}>{tr('act.filter')}</Text>
        {n ? <View style={c.filterCount}><Text style={c.filterCountText}>{n}</Text></View> : null}
      </Pressable>
      {open ? <FilterSheet {...v} all={all} filter={filter} onApply={f => { setFilter(f); setOpen(false); }} onClose={() => setOpen(false)} /> : null}
    </View>
  );
}

/** 手机底部面板:改的是草稿,「查看 N 条」才生效(N 按草稿实时数)。 */
function FilterSheet({ all, filter, onApply, onClose, ...v }: ViewCtx & { all: readonly ActivityEvent[]; filter: ActivityFilter; onApply: (f: ActivityFilter) => void; onClose: () => void }) {
  const { c } = v;
  const safe = useModalSafePadding('fullScreen');
  const [draft, setDraft] = useState(filter);
  const n = filterEvents(all, draft, v.cards, v.meId).length;
  const group = (kind: 'project' | 'people' | 'type', title: string, hint?: string) => {
    const opts = menuOptions(kind, all, draft, v);
    const none = kind === 'project' ? !draft.project : kind === 'people' ? !draft.actors.length : false;
    return (
      <View style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row' }}>
          <Text style={c.sheetGroup}>{title}</Text>
          <View style={{ flex: 1 }} />
          {hint ? <Text style={c.phoneDaySub}>{hint}</Text> : null}
        </View>
        <View style={c.chipWrap}>
          {kind !== 'type' ? (
            <Pressable onPress={() => setDraft(clearKind(draft, kind))} style={[c.sheetChip, none && c.sheetChipOn]} testID={`activity-sheet-${kind}-all`}>
              <Text style={[c.text, none && { color: colors.accent, fontWeight: weight.strong }]}>{tr('act.all')}</Text>
            </Pressable>
          ) : null}
          {opts.map(o => (
            <Pressable key={o.key} accessibilityRole="checkbox" {...a11yState({ checked: o.on })} onPress={() => setDraft(o.toggle())} style={[c.sheetChip, o.on && c.sheetChipOn]} testID={`activity-sheet-${o.key}`}>
              {o.lead}
              <Text style={[c.text, o.on && { color: colors.accent, fontWeight: weight.strong }]} numberOfLines={1}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} onPress={onClose} testID="activity-sheet-scrim" />
      <View style={[c.sheet, { paddingBottom: spacing.lg + safe.paddingBottom }]} testID="activity-sheet">
        <View style={c.sheetHandle} />
        <Text style={c.sheetTitle}>{tr('act.filterTitle')}</Text>
        <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.md }}>
          {group('project', tr('act.project'))}
          {group('people', tr('act.people'), tr('act.multi'))}
          {group('type', tr('act.eventTypes'))}
        </ScrollView>
        <View style={c.sheetFoot}>
          <Pressable onPress={() => setDraft({ ...EMPTY_ACTIVITY_FILTER, mine: draft.mine })} style={c.sheetReset} accessibilityRole="button" testID="activity-sheet-reset"><Text style={c.sheetResetText}>{tr('act.reset')}</Text></Pressable>
          <Pressable onPress={() => onApply(draft)} style={c.sheetApply} accessibilityRole="button" testID="activity-sheet-apply"><Text style={c.sheetApplyText}>{tr('act.show', { n })}</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ── 样式 ──

const makeStyles = () => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  empty: { textAlign: 'center', paddingVertical: spacing.xl * 2 },
  end: { textAlign: 'center', paddingVertical: spacing.lg, fontSize: typeScale.small },
  older: { alignSelf: 'center', paddingVertical: spacing.lg, paddingHorizontal: spacing.xl },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  tally: { color: colors.textMuted, fontSize: typeScale.small, flexShrink: 1 },
  desktopBody: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xl * 2 },
  phoneBody: { paddingBottom: spacing.xl * 2 },
  // 桌面:左边日期列 + 右边一天的行
  dayBlock: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.xl },
  dateCol: { width: 72, paddingTop: 2 },
  dateWeek: { color: colors.textSecondary, fontSize: typeScale.small },
  dateNum: { color: colors.accent, fontSize: 36, lineHeight: 42, fontWeight: weight.strong, fontVariant: ['tabular-nums'] },
  dateMonth: { color: colors.textSecondary, fontSize: typeScale.small },
  dayRule: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, height: 24, marginBottom: spacing.sm },
  ruleLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  ruleText: { color: colors.textMuted, fontSize: typeScale.small },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.sm, borderRadius: radius.control },
  rowHover: { backgroundColor: colors.rowHover },
  // #683: a fixed 48 cut 「HH:MM」 at the larger font settings (×1.5 needs ~53) — the column is as wide as the
  // time drawn at the current font size needs (timeTextFloor), never narrower than the old 48.
  timeCol: { width: Math.max(48, timeTextFloor('00:00', typeScale.small * uiScale().fontMultiplier)), alignItems: 'flex-end', paddingTop: 2 },
  time: { color: colors.textMuted, fontSize: typeScale.small, fontVariant: ['tabular-nums'], flexShrink: 0 }, // #683: phone row: the sentence shrinks, not the time
  times: { color: colors.textMuted, fontSize: typeScale.caption },
  main: { flex: 1, minWidth: 0, gap: 4 },
  openBtn: { alignSelf: 'center', paddingHorizontal: spacing.sm },
  cardLine: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  cardText: { color: colors.textSecondary, fontSize: typeScale.small, flexShrink: 1 },
  goneTag: { color: colors.textMuted, fontSize: typeScale.caption, paddingHorizontal: 6, borderRadius: radius.pill, backgroundColor: colors.subtleFill },
  sentence: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 4, minWidth: 0 },
  who: { color: colors.text, fontSize: typeScale.body, fontWeight: weight.strong },
  text: { color: colors.text, fontSize: typeScale.body },
  strike: { textDecorationLine: 'line-through', color: colors.textMuted },
  arrow: { color: colors.textMuted, fontSize: typeScale.body },
  fields: { color: colors.textSecondary, fontSize: typeScale.body, flexShrink: 1 },
  comment: { flexBasis: '100%', color: colors.text, lineHeight: 20, paddingLeft: spacing.sm, borderLeftWidth: 2, borderLeftColor: colors.border },
  expand: { color: colors.accent, fontSize: typeScale.small, fontWeight: weight.strong },
  agentTag: { paddingHorizontal: 5, height: 18, justifyContent: 'center', borderRadius: radius.mark, backgroundColor: colors.tonalBg },
  agentTagText: { color: colors.accent, fontSize: 11, fontWeight: weight.strong },
  agentBadge: { position: 'absolute', right: -3, bottom: -3, width: 14, height: 14, borderRadius: radius.pill, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.bg },
  personInline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 22, paddingHorizontal: 8, borderRadius: radius.pill, maxWidth: 220 },
  pillText: { color: colors.text, fontSize: typeScale.small },
  tagPill: { backgroundColor: colors.running + '1f' },
  tagText: { color: colors.running, fontSize: typeScale.small },
  dot: { width: 7, height: 7, borderRadius: radius.pill },
  details: { marginTop: 4, paddingLeft: spacing.md, borderLeftWidth: 2, borderLeftColor: colors.border, gap: 6 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  // #683: was a fixed 36 — 「HH:MM」 at 字体 大 / 特大 is wider than that. Floor from the string at the drawn size.
  detailTime: { color: colors.textMuted, fontSize: typeScale.caption, width: Math.max(36, timeTextFloor('00:00', typeScale.caption * uiScale().fontMultiplier)), fontVariant: ['tabular-nums'], flexShrink: 0 },
  // 桌面下拉
  popover: { position: 'absolute', padding: 6, borderRadius: radius.control, backgroundColor: colors.card, ...elevated('floating') },
  popTitle: { color: colors.textMuted, fontSize: typeScale.small, paddingHorizontal: spacing.md, paddingVertical: 6 },
  popRow: { height: 34, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.md, borderRadius: radius.item },
  popLabel: { flex: 1, color: colors.text, fontSize: 13 },
  popCount: { color: colors.textMuted, fontSize: typeScale.small, fontVariant: ['tabular-nums'] },
  popFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.sm, marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  popClear: { color: colors.textSecondary, fontSize: typeScale.small },
  // 手机
  phoneToolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  filterBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: spacing.md, borderRadius: radius.control, backgroundColor: colors.subtleFill },
  filterCount: { minWidth: 18, height: 18, borderRadius: radius.pill, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  filterCountText: { color: colors.onAccent, fontSize: 11, fontWeight: weight.strong },
  phoneDayHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  phoneDayLabel: { color: colors.text, fontSize: typeScale.title, fontWeight: weight.strong },
  phoneDaySub: { color: colors.textMuted, fontSize: typeScale.small },
  phoneRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '85%', paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopLeftRadius: radius.surface, borderTopRightRadius: radius.surface, backgroundColor: colors.card, gap: spacing.md },
  sheetHandle: { alignSelf: 'center', width: 36, height: 4, borderRadius: radius.pill, backgroundColor: colors.border },
  sheetTitle: { alignSelf: 'center', color: colors.text, fontSize: typeScale.title, fontWeight: weight.strong },
  sheetGroup: { color: colors.textSecondary, fontSize: typeScale.small, fontWeight: weight.medium },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  sheetChip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.subtleFill, borderWidth: 1, borderColor: 'transparent' },
  sheetChipOn: { backgroundColor: colors.tonalBg, borderColor: colors.accent },
  sheetFoot: { flexDirection: 'row', gap: spacing.md },
  sheetReset: { flex: 1, height: 44, borderRadius: radius.control, backgroundColor: colors.subtleFill, alignItems: 'center', justifyContent: 'center' },
  sheetResetText: { color: colors.text, fontSize: typeScale.body, fontWeight: weight.strong },
  sheetApply: { flex: 2, height: 44, borderRadius: radius.control, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  sheetApplyText: { color: colors.onAccent, fontSize: typeScale.body, fontWeight: weight.strong },
});
type Styles = ReturnType<typeof makeStyles>;
