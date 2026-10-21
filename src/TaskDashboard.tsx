import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
// 任务页的「仪表盘」视图。数据在 task-dashboard-model.ts,分享图在 task-share-card.ts。
//
// Owner 2026-09-30:「任务模块,需要加一个视图,就是仪表盘,总览那种,1 天内完成了多少个任务,这种很唬人的效果,
// 拿去发社交媒体」;设计稿通过后加了主角「最近完成的任务是什么」。
// 桌面:一行四个大数字(进场数字滚动)→ 整行「最近完成」时间线(新完成的滑进来,点一行开详情)→
//       近 30 天柱图 + 完成榜 → 全年热力图 + 按项目。
// 手机:单列 ——「今天完成」大卡 → 最近完成 5 行 + 展开 → 三个小数 → 柱图 → 完成榜 → 按项目 → 近 6 个月。
//       不是把桌面挤窄。
// 数据:Hub 有 stats(capability,#2168)就问 Hub(真完成时刻、含归档、按可见范围);否则本机从整张表(含归档,
//       按 cursor 翻页)估,用 updatedAt 的地方标「近似」。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, PixelRatio, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { captureShareCard, shareCardFile } from './share-card-capture';
import DialogFrame from './DialogFrame';
import ShareCardNative from './ShareCardNative';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import type { HubConfig } from './api';
import { colors, mixHex, onThemeChange, radius, spacing, themeMode, type as typeScale, weight } from './theme';
import { titleText, type Requirement, type RequirementProject } from './requirements-model';
import type { RequirementPerson } from './requirement-people';
import { fetchRequirementStats, listAllRequirementsForDashboard } from './requirements-hub';
import { usePoll } from './usePoll';
import { Segmented, a11yState, cardBg, softShadow, type TaskStyles } from './TaskBoardParts';
import { shortIdLabel } from './task-short-id';
import {
  DASH_DAYS, DASH_PERIODS, DASH_RECENT, agentShare, busiestDay, deltaPct, fromHubStats, fromItems, heatCells, localTimeZone, newlyCompleted,
  parseHubStats, periodStart, relativeTime, streaks, ymd, type DashCompletion, type DashData, type DashPeriod,
} from './task-dashboard-model';
import { SHARE_W, renderShareCardPng, shareCardLayout, shareFileName, specOf, type ShareOptions, type ShareSize, type ShareTheme } from './task-share-card';
import { shareModel } from './task-share-model';
import { saveImageObjectUrl } from './web-image-download';
import { copyImageBlob } from './image-clipboard';
import TaskTagStatusChart from './TaskTagStatusChart';
import { inStatsProject, loadedTagSnapshot, parseTagSnapshot, type TagSnapshot } from './task-tag-status';
import type { ReqColumn } from './requirements-model';
import { SelectField } from './TaskSelectMenu';

const POLL_MS = 15_000;
/** 本机估的时候整张表读得比较重(含归档):一分钟一次就够,看板自己的 15 秒轮询会把没归档的卡带进来。 */
const CLIENT_POLL_MS = 60_000;
const PERIOD_KEY: Record<DashPeriod, string> = { today: 'dash.today', week: 'dash.week', month: 'dash.month', all: 'dash.all' };
// 切到别的视图再回来,期保持(本次启动内)。
let lastPeriod: DashPeriod = 'week';

type Props = {
  cfg: HubConfig;
  items: readonly Requirement[];
  projects: readonly RequirementProject[] | null;
  people: readonly RequirementPerson[];
  s: TaskStyles;
  phone: boolean;
  /** Hub 有没有 GET /api/requirements/stats(capability stats)。 */
  statsCapable: boolean;
  onOpen: (id: string) => void;
  projectFilter?: string | null;
  onTagStatus: (tag: string | null, status: ReqColumn) => void;
  onProject: (project: string | null) => void;
};

/** 读数据:Hub stats 或本机估。返回的 data 为 null = 还没读到。 */
export function useDashData(cfg: HubConfig, period: DashPeriod, statsCapable: boolean, storeItems: readonly Requirement[], projectFilter: string | null = null) {
  const key = JSON.stringify([cfg.serverUrl, cfg.token, cfg.networkId, period, projectFilter]);
  const current = useRef(key);
  current.current = key;
  const [hub, setHub] = useState<{ key: string; period: DashPeriod; raw: unknown } | null>(null);
  const [all, setAll] = useState<{ key: string; rows: Requirement[]; partial: boolean } | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const useHub = statsCapable && !(hub && hub.key === key && parseHubStats(hub.raw) === null);
  const load = useCallback(async () => {
    try {
      if (useHub) {
        const raw = await fetchRequirementStats(cfg, { from: periodStart(period, Date.now()), tz: localTimeZone(), days: DASH_DAYS, recent: DASH_RECENT, projectId: projectFilter });
        if (current.current !== key) return;
        setHub({ key, period, raw });
      } else {
        const result = await listAllRequirementsForDashboard(cfg);
        if (current.current !== key) return;
        setAll({ key, ...result });
      }
      setNow(Date.now());
      setError('');
    } catch (e) {
      if (current.current !== key) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [cfg.serverUrl, cfg.token, cfg.networkId, period, projectFilter, key, useHub]);
  usePoll(load, useHub ? POLL_MS : CLIENT_POLL_MS, [load]);
  const data = useMemo<DashData | null>(() => {
    if (useHub) {
      const raw = hub && hub.key === key ? hub.raw : null;
      const stats = parseHubStats(raw);
      if (!stats) return null;
      // Old Hubs can ignore project_id. Do not label their global totals as project totals.
      return projectFilter && !parseTagSnapshot(raw, projectFilter)
        ? fromItems(storeItems.filter(r => inStatsProject(r, projectFilter)), period, now, true)
        : fromHubStats(stats, now);
    }
    if (!all || all.key !== key) return null;
    // 看板的轮询比这里勤:没归档的卡以看板那份为准(刚拖进「完成」的马上算上),归档的用这里读的。
    const merged = new Map(all.rows.map(r => [r.id, r]));
    for (const item of storeItems) merged.set(item.id, item);
    return fromItems([...merged.values()].filter(r => inStatsProject(r, projectFilter)), period, Math.max(now, Date.now() - 1000), all.partial);
  }, [useHub, hub, all, storeItems, period, projectFilter, key, now]);
  const tagSnapshot = useMemo(() => parseTagSnapshot(hub?.key === key ? hub.raw : null, projectFilter) ?? loadedTagSnapshot(storeItems, projectFilter), [hub, key, storeItems, projectFilter]);
  return { data, tagSnapshot, error, reload: load };
}

/** 进场滚动的数字(约 0.9 s,ease-out)。值变了从当前显示值滚到新值。 */
function useCountUp(target: number, ms = 900): number {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = Date.now();
    const a = from.current;
    let raf: any = null;
    const raf$ = (globalThis as any).requestAnimationFrame as ((cb: () => void) => any) | undefined;
    const step = () => {
      const k = Math.min(1, (Date.now() - start) / ms);
      const v = Math.round(a + (target - a) * (1 - Math.pow(1 - k, 3)));
      from.current = v;
      setShown(v);
      if (k < 1) raf = raf$ ? raf$(step) : setTimeout(step, 16);
    };
    step();
    return () => { if (raf !== null) { if (raf$) (globalThis as any).cancelAnimationFrame?.(raf); else clearTimeout(raf); } };
  }, [target, ms]);
  return shown;
}

const personName = (ref: { kind: string; id: string } | null, people: readonly RequirementPerson[]) =>
  ref ? people.find(p => p.kind === ref.kind && p.id === ref.id)?.name || ref.id : tr('dash.unknownPerson');
const md = (date: string) => tr('tasks.monthDay', { m: +date.slice(5, 7), d: +date.slice(8, 10) });
const relText = (at: number, now: number) => { const r = relativeTime(at, now); return tr(`rel.${r.key}`, { n: r.n ?? 0, m: r.m ?? 0, d: r.d ?? 0 }); };
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

export default function TaskDashboard(props: Props) {
  useTranslation();
  const c = useDashStyles();
  const [period, setPeriodState] = useState<DashPeriod>(lastPeriod);
  const setPeriod = (p: DashPeriod) => { lastPeriod = p; setPeriodState(p); };
  const { data, tagSnapshot, error, reload } = useDashData(props.cfg, period, props.statsCapable, props.items, props.projectFilter);
  const periods = DASH_PERIODS.map(key => ({ key, label: tr(PERIOD_KEY[key]) }));
  const periodSeg = <Segmented s={props.s} items={periods} value={period} onChange={setPeriod} testID="dash-period" />;
  if (!data) {
    return (
      <View style={c.center} testID="dash-loading">
        {error ? (
          <>
            <Text style={props.s.err}>{tr('dash.loadFailed', { msg: error })}</Text>
            <Pressable onPress={() => { void reload(); }} accessibilityRole="button" testID="dash-retry"><Text style={props.s.link}>{tr('dash.retry')}</Text></Pressable>
          </>
        ) : <Text style={props.s.muted}>…</Text>}
      </View>
    );
  }
  const view = { ...props, data, tagSnapshot, period, c };
  return (
    <View style={{ flex: 1 }} testID="task-dashboard" {...({ dataSet: { dashSource: data.source } } as object)}>
      {props.phone ? <DashPhone {...view} periodSeg={periodSeg} /> : <DashDesktop {...view} periodSeg={periodSeg} />}
    </View>
  );
}

type ViewProps = Props & { data: DashData; tagSnapshot: TagSnapshot; period: DashPeriod; c: DashStyles };

function Notes({ data, c }: { data: DashData; c: DashStyles }) {
  if (!data.approx && !data.partial) return null;
  return (
    <View style={{ gap: 2 }} testID="dash-notes">
      {data.approx ? <Text style={c.note} testID="dash-approx">{tr('dash.approx')}</Text> : null}
      {data.partial ? <Text style={c.note} testID="dash-partial">{tr('dash.partial')}</Text> : null}
    </View>
  );
}

function Delta({ cur, prev, label, c }: { cur: number; prev: number; label: string; c: DashStyles }) {
  const d = deltaPct(cur, prev);
  return (
    <View style={c.footRow}>
      {d !== null ? <View style={[c.delta, { backgroundColor: d >= 0 ? c.upBg : c.downBg }]}><Text style={[c.deltaText, { color: d >= 0 ? colors.running : colors.failed }]}>{`${d >= 0 ? '↑' : '↓'} ${Math.abs(d)}%`}</Text></View> : null}
      <Text style={c.foot} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function Hero({ label, value, suffix, dot, foot, c, featured, testID, spark }: { label: string; value: number; suffix?: string; dot: string; foot: React.ReactNode; c: DashStyles; featured?: boolean; testID: string; spark?: number[] }) {
  const shown = useCountUp(value);
  return (
    <View style={[c.card, c.hero, featured && c.heroFeatured]} testID={testID}>
      <View style={c.heroLabelRow}><View style={[c.dot, { backgroundColor: dot }]} /><Text style={c.heroLabel} numberOfLines={1}>{label}</Text></View>
      <Text style={c.heroValue} testID={`${testID}-value`} numberOfLines={1}>{shown}{suffix ? <Text style={c.heroSuffix}>{suffix}</Text> : null}</Text>
      {foot}
      {spark ? <View style={c.heroSpark}><MiniBars values={spark} color={dot} height={36} width={110} /></View> : null}
    </View>
  );
}

function MiniBars({ values, color, height, width }: { values: readonly number[]; color: string; height: number; width: number }) {
  const max = Math.max(1, ...values);
  const bw = width / Math.max(1, values.length);
  return (
    <View style={{ width, height, flexDirection: 'row', alignItems: 'flex-end' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {values.map((v, i) => <View key={i} style={{ width: Math.max(1, bw - 2), marginRight: 2, height: Math.max(v ? 2 : 1, (height * v) / max), backgroundColor: color, opacity: v ? (i === values.length - 1 ? 1 : 0.55) : 0.2, borderRadius: radius.inline }} />)}
    </View>
  );
}

function heroes({ data, c, period }: ViewProps) {
  const periodWord = tr(PERIOD_KEY[period]);
  return [
    <Hero key="t" testID="dash-hero-today" featured label={tr('dash.todayDone')} value={data.todayDone} dot={colors.accent} c={c} spark={data.daily.slice(-14).map(d => d.n)}
      foot={<Delta cur={data.todayDone} prev={data.yesterdayDone} label={deltaPct(data.todayDone, data.yesterdayDone) === null ? tr('dash.yesterdayN', { n: data.yesterdayDone }) : tr('dash.vsYesterday')} c={c} />} />,
    <Hero key="w" testID="dash-hero-week" label={tr('dash.weekDone')} value={data.weekDone} dot={colors.broadcast} c={c} spark={data.daily.slice(-21, -7).map(d => d.n)}
      foot={<Delta cur={data.weekDone} prev={data.lastWeekDone} label={deltaPct(data.weekDone, data.lastWeekDone) === null ? tr('dash.lastWeekN', { n: data.lastWeekDone }) : tr('dash.vsLastWeek')} c={c} />} />,
    <Hero key="d" testID="dash-hero-doing" label={tr('dash.doing')} value={data.doing} dot={colors.blocked} c={c} foot={<Text style={c.foot}>{tr('dash.doingNote')}</Text>} />,
    <Hero key="r" testID="dash-hero-rate" label={tr('dash.rate')} value={data.rate === null ? 0 : Math.round(data.rate * 100)} suffix={data.rate === null ? '' : '%'} dot={colors.running} c={c}
      foot={<Text style={c.foot} numberOfLines={1}>{data.rate === null ? tr('dash.rateNone', { period: periodWord }) : tr('dash.rateNote', { period: periodWord, created: data.rateCreated, done: data.rateDone })}</Text>} />,
  ];
}

// ── 最近完成(主角) ──

function Timeline({ data, people, projects, onOpen, c, limit, testID, phone }: ViewProps & { limit: number; testID: string }) {
  const rows = data.recent.slice(0, limit);
  // 新完成的滑进来:上一轮没有的 id 从上方淡入(第一轮不动)。
  const prev = useRef<string[] | null>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  const ids = data.recent.map(r => r.id).join(',');
  useEffect(() => {
    const next = newlyCompleted(prev.current, data.recent);
    prev.current = data.recent.map(r => r.id);
    if (next.length) setFresh(next);
  }, [ids]);
  const now = Date.now();
  const projectById = new Map((projects ?? []).map(p => [p.id, p]));
  if (!rows.length) return <Text style={[c.foot, { paddingVertical: spacing.md }]} testID={`${testID}-empty`}>{tr('dash.recentEmpty', { period: tr(PERIOD_KEY[lastPeriod]) })}</Text>;
  return (
    <View testID={testID}>
      {rows.map(r => <TimelineRow key={r.id} r={r} now={now} people={people} project={r.projectId ? projectById.get(r.projectId) : undefined} fresh={fresh.includes(r.id)} onOpen={onOpen} c={c} compact={phone} />)}
    </View>
  );
}

// compact(手机):没有右边的时间列 —— 时间放进第二行,项目不显示(390 宽放不下四样)。
function TimelineRow({ r, now, people, project, fresh, onOpen, c, compact }: { r: DashCompletion; now: number; people: readonly RequirementPerson[]; project: RequirementProject | undefined; fresh: boolean; onOpen: (id: string) => void; c: DashStyles; compact: boolean }) {
  const name = personName(r.by, people);
  const slide = useCountUp(fresh ? 100 : 0, 600);
  const offset = fresh ? (100 - slide) * 0.24 : 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${titleText(r)} · ${name} · ${relText(r.at, now)}`}
      onPress={() => onOpen(r.id)}
      style={state => [c.tlRow, ((state as { hovered?: boolean }).hovered || state.pressed) && c.tlRowHover, fresh && { transform: [{ translateY: -offset }], opacity: 0.4 + slide / 166 }]}
      testID={`dash-recent-${r.id}`}
    >
      <View>
        <AliasAvatar alias={name} size={28} />
        {r.by?.kind === 'node' ? <View style={c.agentBadge} testID="dash-agent-badge"><Ionicons name="hardware-chip-outline" size={9} color={colors.onAccent} /></View> : null}
      </View>
      <View style={c.tlMain}>
        <Text style={c.tlTitle} numberOfLines={1} testID="dash-recent-title">{titleText(r)}</Text>
        <View style={c.tlMeta}>
          {shortIdLabel(r) ? <Text style={c.tlSeq}>{shortIdLabel(r)}</Text> : null}
          <Text style={c.tlWho} numberOfLines={1}>{name}</Text>
          {project && !compact ? <View style={c.tlProject}><View style={[c.dot, { backgroundColor: project.color }]} /><Text style={c.tlWho} numberOfLines={1}>{project.name}</Text></View> : null}
          {compact ? <Text style={c.tlTime} numberOfLines={1}>{relText(r.at, now)}</Text> : null}
          {r.archived ? <Text style={c.tlTag} numberOfLines={1}>{tr('dash.archived')}</Text> : null}
        </View>
      </View>
      {compact ? null : <Text style={c.tlTime} numberOfLines={1}>{relText(r.at, now)}{r.approx ? ` · ${tr('dash.approxShort')}` : ''}</Text>}
    </Pressable>
  );
}

// ── 图 ──

function DailyChart({ data, c, height }: { data: DashData; c: DashStyles; height: number }) {
  const last30 = data.daily.slice(-30);
  const max = Math.max(10, Math.ceil(Math.max(1, ...last30.map(d => d.n)) / 10) * 10);
  const avg = last30.reduce((a, d) => a + d.n, 0) / Math.max(1, last30.length);
  return (
    <View style={{ height }} testID="dash-daily">
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <View style={c.axis}>{[max, max / 2, 0].map(v => <Text key={v} style={c.axisText}>{v}</Text>)}</View>
        <View style={c.plot}>
          <View style={[c.avgLine, { bottom: `${(avg / max) * 100}%` as any }]} />
          {last30.map((d, i) => (
            <View key={d.date} style={c.barSlot}>
              {i === last30.length - 1 && d.n ? <Text style={c.barTop}>{d.n}</Text> : null}
              <View style={[c.bar, { height: `${(d.n / max) * 100}%` as any, opacity: i === last30.length - 1 ? 1 : 0.6 }]} testID={i === last30.length - 1 ? 'dash-bar-today' : undefined} />
            </View>
          ))}
        </View>
      </View>
      <View style={c.xAxis}>
        {/* 每 7 天一个刻度:字比一根柱子的格子宽,绝对定位居中在那一格上,不被格子截成「9…」。最后一格(今天)右对齐。 */}
        {last30.map((d, i) => {
          const last = i === last30.length - 1;
          const label = last ? tr('dash.today') : i % 7 === (last30.length - 1) % 7 ? `${+d.date.slice(5, 7)}/${+d.date.slice(8, 10)}` : '';
          return (
            <View key={d.date} style={{ flex: 1, height: 14 }}>
              {label ? <Text style={[c.axisText, c.tick, last && c.tickLast]} testID="dash-tick">{label}</Text> : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function Heatmap({ data, weeks, cell, c }: { data: DashData; weeks: number; cell: number; c: DashStyles }) {
  const cells = heatCells(data.daily, weeks);
  const cols = Math.max(1, ...cells.map(x => x.col + 1));
  const levels = c.heat;
  return (
    <View style={{ width: cols * cell, height: 7 * cell }} testID="dash-heat" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {cells.map(x => <View key={x.date} style={{ position: 'absolute', left: x.col * cell, top: x.row * cell, width: cell - 3, height: cell - 3, borderRadius: radius.inline, backgroundColor: levels[x.level] }} />)}
    </View>
  );
}

function Leaders({ data, people, c, limit }: ViewProps & { limit: number }) {
  if (!data.leaders.length) return <Text style={c.foot} testID="dash-leaders-empty">{tr('dash.leadersEmpty')}</Text>;
  const medal = ['#d4a017', '#9aa3ad', '#c07a3e'];
  return (
    <View testID="dash-leaders">
      {data.leaders.slice(0, limit).map((l, i) => {
        const name = personName(l, people);
        return (
          <View key={`${l.kind}:${l.id}`} style={[c.lbRow, i === 0 && c.lbFirst]} testID={`dash-leader-${i}`}>
            <Text style={[c.rank, i < 3 && { color: medal[i] }]}>{i + 1}</Text>
            <View>
              <AliasAvatar alias={name} size={30} />
              {l.kind === 'node' ? <View style={c.agentBadge}><Ionicons name="hardware-chip-outline" size={9} color={colors.onAccent} /></View> : null}
            </View>
            <View style={c.tlMain}>
              <Text style={c.lbName} numberOfLines={1}>{name}</Text>
              <Text style={c.tlWho} numberOfLines={1}>{l.kind === 'node' ? tr('dash.agent') : tr('dash.member')}</Text>
            </View>
            <MiniBars values={l.spark} color={i === 0 ? colors.accent : colors.textMuted} height={22} width={70} />
            <Text style={c.lbCount}>{l.n}</Text>
          </View>
        );
      })}
    </View>
  );
}

function Projects({ data, projects, c }: ViewProps) {
  const total = data.byProject.reduce((a, p) => a + p.n, 0);
  const byId = new Map((projects ?? []).map(p => [p.id, p]));
  const palette = [colors.accent, colors.broadcast, colors.blocked, colors.running, colors.failed, colors.rest];
  const rows = data.byProject.map((p, i) => ({ ...p, name: p.projectId ? byId.get(p.projectId)?.name ?? p.projectId : tr('dash.noProject'), color: p.projectId ? byId.get(p.projectId)?.color ?? palette[i % palette.length] : colors.rest }));
  if (!total) return <Text style={c.foot}>{tr('dash.recentEmpty', { period: tr(PERIOD_KEY[lastPeriod]) })}</Text>;
  return (
    <View style={{ gap: spacing.sm }} testID="dash-projects">
      <View style={c.stack}>{rows.map(r => <View key={String(r.projectId)} style={{ flex: r.n, backgroundColor: r.color }} />)}</View>
      {rows.slice(0, 6).map(r => (
        <View key={String(r.projectId)} style={c.projRow}>
          <View style={[c.projDot, { backgroundColor: r.color }]} />
          <Text style={c.projName} numberOfLines={1}>{r.name}</Text>
          <Text style={c.projCount}>{r.n}</Text>
          <Text style={c.projPct}>{`${Math.round((r.n / total) * 100)}%`}</Text>
        </View>
      ))}
    </View>
  );
}

function Streaks({ data, c }: { data: DashData; c: DashStyles }) {
  const st = streaks(data.daily);
  const best = busiestDay(data.daily);
  const share = agentShare(data.leaders);
  return (
    <View style={c.stats} testID="dash-streaks">
      <View><Text style={c.foot}>{tr('dash.streak')}</Text><Text style={c.statValue}>{tr('dash.days', { n: st.current })}</Text></View>
      <View><Text style={c.foot}>{tr('dash.longest')}</Text><Text style={c.statValue}>{tr('dash.days', { n: st.longest })}</Text></View>
      {best ? <View><Text style={c.foot}>{tr('dash.busiest')}</Text><Text style={c.statValue}>{tr('dash.busiestValue', { n: best.n, md: md(best.date) })}</Text></View> : null}
      {share !== null ? <View><Text style={c.foot}>{tr('dash.agentShare')}</Text><Text style={c.statValue}>{pct(share)}</Text></View> : null}
    </View>
  );
}

function CardHead({ title, sub, right, c }: { title: string; sub?: string; right?: string; c: DashStyles }) {
  return (
    <View style={c.cardHead}>
      <Text style={c.cardTitle} numberOfLines={1}>{title}</Text>
      {sub ? <Text style={c.foot} numberOfLines={1}>{sub}</Text> : null}
      <View style={{ flex: 1 }} />
      {right ? <Text style={c.foot} numberOfLines={1}>{right}</Text> : null}
    </View>
  );
}

function DashboardProject(props: Props) {
  if (!props.projects) return null;
  return <View style={{ minWidth: 150, maxWidth: 280 }}><SelectField testID="dash-project" value={props.projectFilter ?? null} touch={props.phone} title={tr('tasks.copy.30')} noneLabel={tr('tagStats.allProjects')} placeholder={tr('tagStats.allProjects')} options={[{ id: 'none', label: tr('tasks.copy.31') }, ...props.projects.filter(p => !p.archived).map(p => ({ id: p.id, label: p.name, color: p.color }))]} onPick={props.onProject} /></View>;
}

function DashDesktop(props: ViewProps & { periodSeg: React.ReactNode }) {
  const { data, c, period } = props;
  const last30 = data.daily.slice(-30);
  const sum30 = last30.reduce((a, d) => a + d.n, 0);
  const [heatW, setHeatW] = useState(0);
  const cell = heatW ? Math.max(9, Math.min(16, Math.floor(heatW / 53))) : 14;
  const weeks = heatW ? Math.min(53, Math.floor(heatW / cell)) : 53;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={c.desktopBody} testID="dash-desktop">
      <View style={c.toolbar}>
        {props.periodSeg}
        <DashboardProject {...props} />
        <View style={{ flex: 1 }} />
        <Notes data={data} c={c} />
      </View>
      <View style={c.heroRow}>{heroes(props)}</View>
      <View style={[c.card, c.recentCard]} testID="dash-recent-card">
        <CardHead c={c} title={tr('dash.recent')} sub={tr(PERIOD_KEY[period])} right={tr('dash.total', { n: data.periodDone })} />
        <Timeline {...props} limit={8} testID="dash-recent" />
      </View>
      <View style={c.card}><TaskTagStatusChart snapshot={props.tagSnapshot} phone={false} onPick={props.onTagStatus} /></View>
      <View style={c.row}>
        <View style={[c.card, { flex: 2 }]}>
          <CardHead c={c} title={tr('dash.daily')} sub={tr('dash.last30')} right={`${tr('dash.avg', { n: (sum30 / 30).toFixed(1) })} · ${tr('dash.total', { n: sum30 })}`} />
          <DailyChart data={data} c={c} height={240} />
        </View>
        <View style={[c.card, { flex: 1 }]}>
          <CardHead c={c} title={tr('dash.leaders')} sub={tr(PERIOD_KEY[period])} />
          <Leaders {...props} limit={6} />
        </View>
      </View>
      <View style={c.row}>
        <View style={[c.card, { flex: 2 }]}>
          <CardHead c={c} title={tr('dash.year')} right={tr('dash.total', { n: data.daily.reduce((a, d) => a + d.n, 0) })} />
          <View style={{ paddingVertical: spacing.sm }} onLayout={e => setHeatW(e.nativeEvent.layout.width)}><Heatmap data={data} weeks={weeks} cell={cell} c={c} /></View>
          <Streaks data={data} c={c} />
        </View>
        <View style={[c.card, { flex: 1 }]}>
          <CardHead c={c} title={tr('dash.byProject')} sub={tr(PERIOD_KEY[period])} />
          <Projects {...props} />
        </View>
      </View>
    </ScrollView>
  );
}

function DashPhone(props: ViewProps & { periodSeg: React.ReactNode }) {
  const { data, c, period } = props;
  const [expanded, setExpanded] = useState(false);
  const today = useCountUp(data.todayDone);
  const d = deltaPct(data.todayDone, data.yesterdayDone);
  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={c.phoneBody} testID="dash-phone">
        {props.periodSeg}
        <DashboardProject {...props} />
        <View style={c.phoneHero} testID="dash-hero-today">
          <Text style={c.phoneHeroLabel}>{tr('dash.todayDone')}</Text>
          <Text style={c.phoneHeroValue} testID="dash-hero-today-value">{today}</Text>
          <View style={c.footRow}>
            {d !== null ? <View style={c.phoneHeroDelta}><Text style={c.phoneHeroDeltaText}>{`${d >= 0 ? '↑' : '↓'} ${Math.abs(d)}%`}</Text></View> : null}
            <Text style={c.phoneHeroSub} numberOfLines={1}>{d === null ? tr('dash.yesterdayN', { n: data.yesterdayDone }) : tr('dash.vsYesterday')}</Text>
          </View>
          <View style={c.phoneHeroSpark}><MiniBars values={data.daily.slice(-14).map(x => x.n)} color="#7ff5e0" height={44} width={120} /></View>
        </View>
        <View style={c.card} testID="dash-recent-card">
          <CardHead c={c} title={tr('dash.recent')} sub={tr(PERIOD_KEY[period])} />
          <Timeline {...props} limit={expanded ? 20 : 5} testID="dash-recent" />
          {data.recent.length > 5 ? (
            <Pressable accessibilityRole="button" {...a11yState({ expanded })} onPress={() => setExpanded(e => !e)} style={c.expand} testID="dash-recent-expand">
              <Text style={c.expandText}>{expanded ? tr('dash.collapse') : tr('dash.expand')}</Text>
              <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.accent} />
            </Pressable>
          ) : null}
        </View>
        <View style={c.phoneKpis}>
          <PhoneKpi label={tr('dash.weekDone')} value={String(data.weekDone)} c={c} testID="dash-hero-week" />
          <PhoneKpi label={tr('dash.doing')} value={String(data.doing)} c={c} testID="dash-hero-doing" />
          <PhoneKpi label={tr('dash.rate')} value={pct(data.rate)} c={c} testID="dash-hero-rate" />
        </View>
        <Notes data={data} c={c} />
        <View style={c.card}><TaskTagStatusChart snapshot={props.tagSnapshot} phone onPick={props.onTagStatus} /></View>
        <View style={c.card}>
          <CardHead c={c} title={tr('dash.daily')} sub={tr('dash.last30')} />
          <DailyChart data={data} c={c} height={170} />
        </View>
        <View style={c.card}>
          <CardHead c={c} title={tr('dash.leaders')} sub={tr(PERIOD_KEY[period])} />
          <Leaders {...props} limit={5} />
        </View>
        <View style={c.card}>
          <CardHead c={c} title={tr('dash.byProject')} sub={tr(PERIOD_KEY[period])} />
          <Projects {...props} />
        </View>
        <View style={c.card}>
          <CardHead c={c} title={tr('dash.halfYear')} />
          <View style={{ paddingVertical: spacing.sm }}><Heatmap data={data} weeks={26} cell={12} c={c} /></View>
          <Streaks data={data} c={c} />
        </View>
      </ScrollView>
    </View>
  );
}

function PhoneKpi({ label, value, c, testID }: { label: string; value: string; c: DashStyles; testID: string }) {
  return (
    <View style={[c.card, c.phoneKpi]} testID={testID}>
      <Text style={c.foot} numberOfLines={1}>{label}</Text>
      <Text style={c.phoneKpiValue} testID={`${testID}-value`} numberOfLines={1}>{value}</Text>
    </View>
  );
}

// ── 分享 ──

// 手机原生端没有 Canvas:预览用 RN 版的同一张卡(ShareCardNative),先不能导出。__anetDashNativeCard 只给 web 上的布局测试用,
// 让它在 web 导出里也走原生那条分支、量同一个组件。
const canExport = () => Platform.OS === 'web' && typeof document !== 'undefined' && !(globalThis as { __anetDashNativeCard?: boolean }).__anetDashNativeCard;

function logoUri(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../assets/icon-ios.png');
    if (typeof mod === 'string') return mod;
    const resolved = (Image as unknown as { resolveAssetSource?: (m: unknown) => { uri?: string } | null }).resolveAssetSource?.(mod);
    return resolved?.uri ?? mod?.uri ?? mod?.default ?? null;
  } catch { return null; }
}

function ShareDialog({ data, period, people, c, onClose, phone }: ViewProps & { onClose: () => void }) {
  const [size, setSize] = useState<ShareSize>('portrait');
  const [theme, setTheme] = useState<ShareTheme>(themeMode() === 'dark' ? 'dark' : 'light');
  const [showHeat, setShowHeat] = useState(true);
  const [showTop, setShowTop] = useState(true);
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const blobRef = useRef<Blob | null>(null);
  const exportable = canExport();
  const opts: ShareOptions = { size, theme, showHeat, showTop };
  const now = Date.now();
  const model = shareModel(data, period, people, excluded, now);
  const layout = shareCardLayout(size, specOf(model, opts));
  const key = JSON.stringify([size, theme, showHeat, showTop, [...excluded], period, data.recent.map(r => r.id), data.todayDone, data.weekDone]);
  useEffect(() => {
    if (!exportable) return;
    let dead = false;
    renderShareCardPng(model, opts, logoUri()).then(blob => {
      if (dead) return;
      blobRef.current = blob;
      setPreview(old => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
    }).catch(e => { if (!dead) setMsg(tr('dash.exportFailed', { msg: e instanceof Error ? e.message : String(e) })); });
    return () => { dead = true; };
  }, [key]);
  const name = shareFileName(period, ymd(now), size);
  const save = () => {
    if (!preview) return;
    saveImageObjectUrl(preview, name);
    setMsg(tr('dash.saved', { name }));
  };
  const copy = async () => {
    if (!blobRef.current) return;
    try { await copyImageBlob(blobRef.current); setMsg(tr('dash.copied')); } catch (e) { setMsg(tr('dash.exportFailed', { msg: e instanceof Error ? e.message : String(e) })); }
  };
  // 手机原生端:屏外画一张按物理像素 1080 宽的卡片,点「分享图片」时截它(share-card-capture.ts)。
  const shotRef = useRef<View>(null);
  const [busy, setBusy] = useState(false);
  const shareNative = async () => {
    if (!shotRef.current || busy) return;
    setBusy(true);
    try {
      const uri = await captureShareCard(shotRef.current, size);
      await shareCardFile(uri, tr('dash.shareTitle'));
    } catch (e) {
      setMsg(tr('dash.exportFailed', { msg: e instanceof Error ? e.message : String(e) }));
    } finally { setBusy(false); }
  };
  const toggle = (id: string) => setExcluded(cur => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const aspect = size === 'portrait' ? 1920 / 1080 : 1350 / 1080;
  const pw = phone ? 200 : 300;
  const candidates = data.recent.slice(0, 12);
  const shownIds = new Set(data.recent.filter(r => !excluded.has(r.id)).slice(0, layout.titlesShown).map(r => r.id));
  const footer = exportable ? (
    <View style={{ gap: spacing.sm }}>
      {msg ? <Text style={c.foot} testID="dash-share-msg" numberOfLines={2}>{msg}</Text> : null}
      <View style={c.dialogFoot}>
        <Pressable accessibilityRole="button" onPress={() => { void copy(); }} style={c.ghostBtn} testID="dash-share-copy"><Ionicons name="copy-outline" size={16} color={colors.text} /><Text style={c.ghostText}>{tr('dash.copy')}</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={save} style={[c.shareBtn, !preview && { opacity: 0.5 }]} disabled={!preview} testID="dash-share-save"><Ionicons name="download-outline" size={16} color={colors.onAccent} /><Text style={c.shareBtnText}>{tr('dash.save')}</Text></Pressable>
      </View>
    </View>
  ) : (
    <View style={{ gap: spacing.sm }}>
      {msg ? <Text style={c.foot} testID="dash-share-msg" numberOfLines={2}>{msg}</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => { void shareNative(); }} disabled={busy} style={[c.shareBtn, { justifyContent: 'center', height: 44 }, busy && { opacity: 0.6 }]} testID="dash-share-native">
        <Ionicons name="share-outline" size={16} color={colors.onAccent} />
        <Text style={c.shareBtnText}>{tr('dash.shareNative')}</Text>
      </Pressable>
      <Text style={c.note} testID="dash-share-native-note">{tr('dash.nativeNote')}</Text>
    </View>
  );
  return (
    <>
    {!exportable ? (
      // 屏外的全尺寸卡片(截图用):逻辑宽 1080 / 像素比 = 1080 物理像素。不可见、不可点。
      <View style={{ position: 'absolute', left: -20000, top: 0 }} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View ref={shotRef} collapsable={false}>
          <ShareCardNative model={model} opts={opts} scale={1 / PixelRatio.get()} testID="share-card-capture" />
        </View>
      </View>
    ) : null}
    <DialogFrame title={tr('dash.shareTitle')} closeLabel={tr('dash.close')} onClose={onClose} footer={footer} maxWidth={phone ? 460 : 820} testID="dash-share-dialog">
      <View style={[{ gap: spacing.lg }, !phone && { flexDirection: 'row', alignItems: 'flex-start' }]}>
        <View style={[c.previewBox, { width: pw, height: pw * aspect }]} testID="dash-share-preview">
          {exportable
            ? (preview ? <Image source={{ uri: preview }} style={{ width: pw, height: pw * aspect }} resizeMode="contain" accessibilityLabel={tr('dash.shareTitle')} /> : null)
            : <ShareCardNative model={model} opts={opts} scale={pw / SHARE_W} testID="dash-share-native-card" />}
        </View>
        <View style={{ flex: phone ? undefined : 1, gap: spacing.md, minWidth: 0 }}>
          <Text style={c.fieldLabel}>{tr('dash.shareSize')}</Text>
          <View style={c.optRow}>
            <Opt on={size === 'portrait'} label={tr('dash.sizePortrait')} hint={tr('dash.sizePortraitHint')} onPress={() => setSize('portrait')} c={c} testID="dash-size-portrait" />
            <Opt on={size === 'feed'} label={tr('dash.sizeFeed')} hint={tr('dash.sizeFeedHint')} onPress={() => setSize('feed')} c={c} testID="dash-size-feed" />
          </View>
          <Text style={c.fieldLabel}>{tr('dash.shareTheme')}</Text>
          <View style={c.optRow}>
            <Opt on={theme === 'dark'} label={tr('dash.themeDark')} onPress={() => setTheme('dark')} c={c} testID="dash-theme-dark" />
            <Opt on={theme === 'light'} label={tr('dash.themeLight')} onPress={() => setTheme('light')} c={c} testID="dash-theme-light" />
          </View>
          {/* 只列这张图上真的会出现的块:热力图要有 30 天以上的历史(shareModules),「谁完成的」要有人上榜。 */}
          {(model.heat && size === 'portrait') || model.who ? (
            <>
              <Text style={c.fieldLabel}>{tr('dash.shareShow')}</Text>
              {model.heat && size === 'portrait' ? <Check on={showHeat} label={tr('dash.showHeat')} onPress={() => setShowHeat(v => !v)} c={c} testID="dash-show-heat" /> : null}
              {model.who ? <Check on={showTop} label={tr('dash.showTop')} onPress={() => setShowTop(v => !v)} c={c} testID="dash-show-top" /> : null}
            </>
          ) : null}
          {candidates.length ? (
            <>
              <Text style={c.fieldLabel}>{period === 'today' ? tr('dash.shareTasks') : tr('dash.shareTasksPeriod', { period: tr(PERIOD_KEY[period]) })}</Text>
              {candidates.map(r => (
                <Check key={r.id} on={!excluded.has(r.id)} dim={!excluded.has(r.id) && !shownIds.has(r.id)} label={titleText(r)} onPress={() => toggle(r.id)} c={c} testID={`dash-share-task-${r.id}`} />
              ))}
            </>
          ) : null}
        </View>
      </View>
    </DialogFrame>
    </>
  );
}

function Opt({ on, label, hint, onPress, c, testID }: { on: boolean; label: string; hint?: string; onPress: () => void; c: DashStyles; testID: string }) {
  return (
    <Pressable accessibilityRole="radio" {...a11yState({ checked: on })} onPress={onPress} style={[c.opt, on && c.optOn]} testID={testID}>
      <Text style={[c.optText, on && c.optTextOn]} numberOfLines={1}>{label}</Text>
      {hint ? <Text style={c.foot} numberOfLines={1}>{hint}</Text> : null}
    </Pressable>
  );
}

function Check({ on, label, onPress, c, testID, dim }: { on: boolean; label: string; onPress: () => void; c: DashStyles; testID: string; dim?: boolean }) {
  return (
    <Pressable accessibilityRole="checkbox" {...a11yState({ checked: on })} onPress={onPress} style={c.check} testID={testID}>
      <View style={[c.box, on && c.boxOn]}>{on ? <Ionicons name="checkmark" size={12} color={colors.onAccent} /> : null}</View>
      <Text style={[c.checkText, dim && { color: colors.textMuted }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

// ── 样式 ──

const makeDashStyles = () => {
  const dark = themeMode() === 'dark';
  const st = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
    desktopBody: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xl, gap: spacing.lg },
    toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    heroRow: { flexDirection: 'row', gap: spacing.lg },
    row: { flexDirection: 'row', gap: spacing.lg, alignItems: 'stretch' },
    card: { backgroundColor: cardBg(), borderRadius: radius.surface, padding: spacing.lg, borderWidth: dark ? 1 : 0, borderColor: colors.floatingBorder, ...softShadow(), minWidth: 0 },
    recentCard: { paddingBottom: spacing.sm },
    hero: { flex: 1, minHeight: 124, overflow: 'hidden' },
    heroFeatured: { backgroundColor: dark ? colors.railActiveBg : colors.tonalBg },
    heroLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    heroLabel: { color: colors.textSecondary, fontSize: 13 },
    heroValue: { color: colors.text, fontSize: 44, lineHeight: 52, fontWeight: weight.strong, marginTop: 4, fontVariant: ['tabular-nums'] },
    heroSuffix: { fontSize: 18, color: colors.textSecondary, fontWeight: weight.medium },
    heroSpark: { position: 'absolute', right: spacing.lg, bottom: spacing.lg },
    dot: { width: 8, height: 8, borderRadius: radius.pill },
    footRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 0 },
    foot: { color: colors.textMuted, fontSize: typeScale.small, flexShrink: 1 },
    note: { color: colors.textMuted, fontSize: typeScale.caption },
    delta: { borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1 },
    deltaText: { fontSize: typeScale.small, fontWeight: weight.strong },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm, minWidth: 0 },
    cardTitle: { color: colors.text, fontSize: typeScale.body, fontWeight: weight.strong, flexShrink: 0 },
    tlRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, marginHorizontal: -spacing.sm, borderRadius: radius.item },
    tlRowHover: { backgroundColor: colors.rowHover },
    tlMain: { flex: 1, minWidth: 0, gap: 2 },
    tlTitle: { color: colors.text, fontSize: typeScale.body, fontWeight: weight.medium },
    tlMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 0 },
    tlSeq: { color: colors.textMuted, fontSize: typeScale.small, fontVariant: ['tabular-nums'] },
    tlWho: { color: colors.textMuted, fontSize: typeScale.small, flexShrink: 1 },
    tlProject: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1, minWidth: 0 },
    tlTag: { flexShrink: 0, color: colors.textMuted, fontSize: typeScale.caption, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 6 },
    tlTime: { color: colors.textMuted, fontSize: typeScale.small, flexShrink: 0 },
    agentBadge: { position: 'absolute', right: -3, bottom: -3, width: 14, height: 14, borderRadius: radius.pill, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: cardBg() },
    axis: { width: 28, justifyContent: 'space-between', paddingBottom: 0 },
    axisText: { color: colors.textMuted, fontSize: typeScale.caption },
    plot: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: 1, borderBottomColor: colors.border },
    avgLine: { position: 'absolute', left: 0, right: 0, borderTopWidth: 1, borderStyle: 'dashed', borderColor: colors.textMuted, opacity: 0.6 },
    barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center' },
    bar: { width: '62%', backgroundColor: colors.accent, borderTopLeftRadius: radius.mark, borderTopRightRadius: radius.mark },
    barTop: { color: colors.accent, fontSize: typeScale.caption, fontWeight: weight.strong },
    xAxis: { flexDirection: 'row', marginLeft: 28, marginTop: 4 },
    tick: { position: 'absolute', width: 48, left: '50%', marginLeft: -24, textAlign: 'center' },
    tickLast: { left: undefined, right: 0, marginLeft: 0, textAlign: 'right' },
    lbRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 46, paddingHorizontal: spacing.xs, borderRadius: radius.item },
    lbFirst: { backgroundColor: dark ? colors.railActiveBg : colors.tonalBg },
    rank: { width: 18, textAlign: 'center', color: colors.textMuted, fontWeight: weight.strong, fontSize: 13 },
    lbName: { color: colors.text, fontSize: 13, fontWeight: weight.medium },
    lbCount: { color: colors.text, fontSize: typeScale.title, fontWeight: weight.strong, minWidth: 32, textAlign: 'right', fontVariant: ['tabular-nums'] },
    stack: { flexDirection: 'row', height: 10, borderRadius: radius.pill, overflow: 'hidden', gap: 2 },
    projRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    projDot: { width: 10, height: 10, borderRadius: radius.mark },
    projName: { flex: 1, color: colors.text, fontSize: 13, minWidth: 0 },
    projCount: { color: colors.text, fontWeight: weight.strong, fontSize: 13, fontVariant: ['tabular-nums'] },
    projPct: { color: colors.textMuted, fontSize: typeScale.small, width: 36, textAlign: 'right' },
    stats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xl, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, marginTop: spacing.sm },
    statValue: { color: colors.text, fontSize: 18, fontWeight: weight.strong, marginTop: 2 },
    shareBtn: { height: 36, paddingHorizontal: spacing.lg, borderRadius: radius.control, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 0 },
    shareBtnText: { color: colors.onAccent, fontSize: 13, fontWeight: weight.strong },
    ghostBtn: { height: 36, paddingHorizontal: spacing.lg, borderRadius: radius.control, backgroundColor: colors.inputBg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    ghostText: { color: colors.text, fontSize: 13, fontWeight: weight.strong },
    phoneBody: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
    phoneHero: { borderRadius: radius.surface, padding: 18, backgroundColor: '#0c1a3a', overflow: 'hidden' },
    phoneHeroLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 13 },
    phoneHeroValue: { color: '#ffffff', fontSize: 64, lineHeight: 72, fontWeight: weight.strong, fontVariant: ['tabular-nums'] },
    phoneHeroSub: { color: 'rgba(255,255,255,0.85)', fontSize: typeScale.small, flexShrink: 1 },
    phoneHeroDelta: { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1 },
    phoneHeroDeltaText: { color: '#ffffff', fontSize: typeScale.small, fontWeight: weight.strong },
    phoneHeroSpark: { position: 'absolute', right: 14, bottom: 16 },
    phoneKpis: { flexDirection: 'row', gap: spacing.sm },
    phoneKpi: { flex: 1, padding: spacing.md },
    phoneKpiValue: { color: colors.text, fontSize: 22, fontWeight: weight.strong, marginTop: 2, fontVariant: ['tabular-nums'] },
    expand: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: spacing.sm },
    expandText: { color: colors.accent, fontSize: 13, fontWeight: weight.medium },
    dialogFoot: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
    previewBox: { alignSelf: 'center', borderRadius: radius.thumb, overflow: 'hidden', backgroundColor: colors.subtleFill, flexShrink: 0 },
    fieldLabel: { color: colors.textMuted, fontSize: typeScale.small },
    optRow: { flexDirection: 'row', gap: spacing.sm },
    opt: { flex: 1, minWidth: 0, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.control, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, alignItems: 'center', gap: 2 },
    optOn: { borderColor: colors.accent, backgroundColor: colors.tonalBg },
    optText: { color: colors.textSecondary, fontSize: 13 },
    optTextOn: { color: colors.text, fontWeight: weight.strong },
    check: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 28 },
    box: { width: 18, height: 18, borderRadius: radius.mark, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    checkText: { flex: 1, minWidth: 0, color: colors.text, fontSize: 13 },
  });
  return {
    ...st,
    upBg: dark ? 'rgba(34,197,94,0.14)' : 'rgba(21,128,61,0.10)',
    downBg: dark ? 'rgba(239,68,68,0.14)' : 'rgba(220,38,38,0.10)',
    // 热力 5 档:空格子一档中性底,其余 4 档从 accent 按比例混出来(#545:换强调色时跟着换)。
    heat: (() => { const base = dark ? '#1e1e22' : '#eceef1'; return [base, mixHex(base, colors.accent, 0.25), mixHex(base, colors.accent, 0.5), mixHex(base, colors.accent, 0.75), colors.accent]; })(),
  };
};
type DashStyles = ReturnType<typeof makeDashStyles>;
function useDashStyles(): DashStyles {
  const [v, setV] = useState(0);
  useEffect(() => onThemeChange(() => setV(n => n + 1)), []);
  return useMemo(makeDashStyles, [v]);
}

