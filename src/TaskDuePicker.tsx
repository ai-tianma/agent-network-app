import { formatDueFull } from './i18n-task-presentation';
import { listenEscapeClose } from './escape-close';
import { t as tr } from './i18n';
import { duePanelPlacement } from './task-select-model';
import { validationText } from './i18n-task-presentation';
import { useTranslation } from './i18n-react';
import { taskText } from './i18n-tasks';
// 预计完成:点开是月历(桌面 = 贴着字段的弹层,手机 = 底部面板),可选时刻(时:分:秒,24 小时制)或「全天」。
// 快捷项(今天 / 明天 / 下周一)保留,点了是全天。Hub 只认日期时(旧 Hub,没有 due_datetime 能力)不显示时刻。
// 桌面键盘:←→ 一天、↑↓ 一周、PageUp/Down 一个月、回车选中、Esc 关闭。
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { useModalSafePadding } from './safe-area-runtime';
import { colors, radius, spacing, themeMode, type as typeScale, weight } from './theme';
import { elevated } from './elevation';
import { calendarKey, dueFromLocal, dueShortcuts, dueToLocal, localDateOf, monthGrid, shiftMonth } from './due-time';
import { fieldStyles } from './TaskCreateDialog';
import { a11yState, useTaskStyles } from './TaskBoardParts';

const WEEK = ['tasks.copy.167', 'tasks.copy.168', 'tasks.copy.169', 'tasks.copy.170', 'tasks.copy.171', 'tasks.copy.172', 'tasks.copy.173'];
export const DUE_PANEL_WIDTH = 308;

type Time = { hh: number; mm: number; ss: number };
const pad = (n: number) => String(n).padStart(2, '0');

export default function TaskDuePicker({ value, onChange, allowTime, pointer, sheet, idBase, error, anchorAt, onDismiss, requireTime = false, fieldLabel, placeholder }: {
  value: string;
  onChange: (due: string) => void;
  /** Hub 能存时刻(capabilities 里有 due_datetime)。 */
  allowTime: boolean;
  /** 单次执行等必须指定时刻的字段:不提供全天和日期-only快捷项。 */
  requireTime?: boolean;
  fieldLabel?: string;
  placeholder?: string;
  /** 鼠标界面:弹层贴着字段 + 键盘操作;否则手机底部面板。 */
  pointer: boolean;
  sheet: boolean;
  idBase: string;
  error?: string;
  /** 列表格子里就地改(TaskListCellEditor):不画字段,直接在这个位置打开面板,快捷项放进面板;关了调 onDismiss。 */
  anchorAt?: { x: number; y: number; w: number; h: number };
  onDismiss?: () => void;
}) {
  useTranslation();
  const s = useTaskStyles();
  const f = fieldStyles();
  const styles = makePickerStyles();
  const win = useWindowDimensions();
  const safe = useModalSafePadding('fullScreen');
  const fieldRef = useRef<any>(null);
  const [open, setOpen] = useState(!!anchorAt);
  const [anchor, setAnchor] = useState<{ x: number; y: number; w: number; h: number } | null>(anchorAt ?? null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => { if (anchorAt && !open) dismiss.current?.(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = localDateOf(Date.now());
  const withTime = allowTime || requireTime;
  const initial = dueToLocal(value);
  const [date, setDate] = useState<string>(initial?.date ?? today);
  const [allDay, setAllDay] = useState<boolean>(!requireTime && !initial?.time);
  const [time, setTime] = useState<Time>(initial?.time ?? { hh: 18, mm: 0, ss: 0 });
  const [timeText, setTimeText] = useState({ hh: pad(time.hh), mm: pad(time.mm), ss: pad(time.ss) });
  const [month, setMonth] = useState(() => { const [y, m] = (initial?.date ?? today).split('-').map(Number); return { y, m }; });

  const begin = () => {
    const l = dueToLocal(value);
    const d = l?.date ?? today;
    const t = l?.time ?? { hh: 18, mm: 0, ss: 0 };
    setDate(d);
    setAllDay(!requireTime && !l?.time);
    setTime(t);
    setTimeText({ hh: pad(t.hh), mm: pad(t.mm), ss: pad(t.ss) });
    const [y, m] = d.split('-').map(Number);
    setMonth({ y, m });
    const el = fieldRef.current;
    if (el?.measureInWindow) el.measureInWindow((x: number, y2: number, w: number, h: number) => { setAnchor({ x, y: y2, w, h }); setOpen(true); });
    else { setAnchor(null); setOpen(true); }
  };
  const pick = (d: string) => {
    setDate(d);
    const [y, m] = d.split('-').map(Number);
    if (y !== month.y || m !== month.m) setMonth({ y, m });
  };
  const commit = () => {
    onChange(withTime && (requireTime || !allDay) ? dueFromLocal(date, time) : date);
    setOpen(false);
  };

  // 桌面键盘
  const keyState = useRef({ date, open, commit, pick });
  keyState.current = { date, open, commit, pick };
  useEffect(() => {
    const doc = (globalThis as { document?: any }).document;
    if (!open || !pointer || !doc?.addEventListener) return;
    const onKey = (e: any) => {
      const tag = String(e.target?.tagName || '').toLowerCase();
      if (e.key === 'Escape') return; // listenEscapeClose 管
      if (tag === 'input' || tag === 'textarea') return; // 在时分秒框里打字时不抢方向键 / 回车
      if (e.key === 'Enter') { e.preventDefault?.(); keyState.current.commit(); return; }
      const next = calendarKey(keyState.current.date, e.key);
      if (next) { e.preventDefault?.(); keyState.current.pick(next); }
    };
    doc.addEventListener('keydown', onKey, true);
    // Esc 在 keyup 上关、并吞掉那下 keyup(escape-close.ts):不然会连带关掉下面那层 Modal(整页详情 / 新建对话框)。
    const offEsc = listenEscapeClose(() => setOpen(false));
    return () => { doc.removeEventListener('keydown', onKey, true); offEsc(); };
  }, [open, pointer]);

  const setPart = (part: keyof Time, text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 2);
    setTimeText(t => ({ ...t, [part]: digits }));
    const n = Number(digits);
    const max = part === 'hh' ? 23 : 59;
    if (digits !== '' && n <= max) setTime(t => ({ ...t, [part]: n }));
  };
  const blurPart = (part: keyof Time) => setTimeText(t => ({ ...t, [part]: pad(time[part]) }));

  const label = value ? formatDueFull(value) : '';
  const grid = monthGrid(month.y, month.m);
  const cell = Math.floor((DUE_PANEL_WIDTH - spacing.lg * 2) / 7);

  const panelBody = (
    <View style={{ gap: spacing.md }} testID={`${idBase}-calendar`}>
      <View style={styles.monthRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={tr('tasks.copy.174')} onPress={() => setMonth(shiftMonth(month.y, month.m, -1))} style={s.iconButton} testID={`${idBase}-prev`}>
          <Ionicons name="chevron-back" size={16} color={colors.textSecondary} />
        </Pressable>
        <Text style={{ color: colors.text, fontSize: typeScale.body, fontWeight: weight.strong }} testID={`${idBase}-month`}>{month.y}{tr('tasks.copy.175')}{month.m}{tr('tasks.copy.176')}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={tr('tasks.copy.177')} onPress={() => setMonth(shiftMonth(month.y, month.m, 1))} style={s.iconButton} testID={`${idBase}-next`}>
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
        </Pressable>
      </View>
      <View style={styles.week}>
        {WEEK.map(w => <Text key={w} style={[styles.weekDay, { width: cell, color: colors.textMuted }]}>{tr(w)}</Text>)}
      </View>
      <View style={styles.grid} {...({ role: "grid" } as object)}>
        {grid.map(g => {
          const on = g.date === date;
          const isToday = g.date === today;
          return (
            <Pressable
              key={g.date}
              accessibilityRole="button"
              accessibilityLabel={`${g.date}${isToday ? tr('tasks.copy.178') : ''}`}
              {...a11yState({ selected: on })}
              onPress={() => pick(g.date)}
              style={state => [styles.day, { width: cell, height: cell - 4 },
                ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover },
                isToday && { borderWidth: 1, borderColor: colors.accent },
                on && { backgroundColor: colors.accent }]}
              testID={`${idBase}-day-${g.date}`}
            >
              <Text style={{ fontSize: typeScale.small + 1, color: on ? colors.onAccent : g.inMonth ? colors.text : colors.textMuted, fontWeight: on || isToday ? weight.strong : weight.regular }}>{Number(g.date.slice(8))}</Text>
            </Pressable>
          );
        })}
      </View>
      {withTime ? (
        <View style={styles.timeRow} testID={`${idBase}-time`}>
          {!requireTime ? <Pressable accessibilityRole="checkbox" {...a11yState({ checked: allDay })} onPress={() => setAllDay(a => !a)} style={[f.row, { gap: 6 }]} testID={`${idBase}-allday`}>
            <Ionicons name={allDay ? 'checkbox' : 'square-outline'} size={16} color={allDay ? colors.accent : colors.textMuted} />
            <Text style={{ color: colors.text, fontSize: typeScale.small + 1 }}>{tr('tasks.copy.179')}</Text>
          </Pressable> : null}
          <View style={[f.row, { gap: 4, opacity: allDay ? 0.35 : 1 }]} pointerEvents={allDay ? 'none' : 'auto'}>
            {(['hh', 'mm', 'ss'] as const).map((part, i) => (
              <View key={part} style={[f.row, { gap: 4 }]}>
                {i ? <Text style={{ color: colors.textMuted }}>:</Text> : null}
                <TextInput
                  value={timeText[part]}
                  onChangeText={t => setPart(part, t)}
                  onBlur={() => blurPart(part)}
                  keyboardType="number-pad"
                  maxLength={2}
                  editable={!allDay}
                  style={[styles.timeBox, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
                  accessibilityLabel={part === 'hh' ? tr('tasks.copy.180') : part === 'mm' ? tr('tasks.copy.181') : tr('tasks.copy.182')}
                  testID={`${idBase}-${part}`}
                />
              </View>
            ))}
          </View>
        </View>
      ) : null}
      {anchorAt && !requireTime ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {dueShortcuts(today).map(o => (
            <Pressable key={o.key} onPress={() => { onChange(o.value); setOpen(false); }} style={[s.chip, { height: 28 }, value === o.value && s.chipOn]} testID={`${idBase}-${o.key}`} accessibilityRole="button">
              <Text style={[s.chipText, value === o.value && s.chipTextOn]}>{validationText(o.label)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={[f.row, { justifyContent: 'space-between' }]}>
        <Pressable accessibilityRole="button" onPress={() => { onChange(''); setOpen(false); }} style={styles.footBtn} testID={`${idBase}-picker-clear`}>
          <Text style={s.link}>{tr('tasks.copy.183')}</Text>
        </Pressable>
        <View style={[f.row, { gap: spacing.sm }]}>
          <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={[s.primary, { backgroundColor: colors.subtleFill }]} testID={`${idBase}-cancel`}>
            <Text style={[s.primaryText, { color: colors.text }]}>{tr('tasks.copy.79')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={commit} style={s.primary} testID={`${idBase}-ok`}>
            <Text style={s.primaryText}>{tr('tasks.copy.184')}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  // 桌面:贴着字段下沿;放不下就翻到上面;左边和字段左边对齐,右边夹进窗口。
  // 上下都放不下(矮窗口,字段在中间 —— 详情里项目 / 母任务挪到标题下以后更常见):放到字段左边、竖直居中,
  // 不再夹到窗口顶上把字段本身盖住。
  const panelH = (withTime ? 452 : 404) + (anchorAt && !requireTime ? 40 : 0);
  const place = duePanelPlacement(anchor, { width: win.width, height: win.height }, { width: DUE_PANEL_WIDTH, height: panelH });
  const left = place.left;
  const top = place.top;

  const modal = (
      <Modal visible={open} transparent animationType={sheet ? 'slide' : 'fade'} onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: sheet ? 'rgba(0,0,0,0.4)' : 'transparent', justifyContent: sheet ? 'flex-end' : undefined }}>
          <Pressable accessibilityLabel={tr('tasks.copy.189')} onPress={() => setOpen(false)} style={StyleSheet.absoluteFill} testID={`${idBase}-scrim`} />
          <View
            style={sheet
              ? { backgroundColor: colors.card, borderTopLeftRadius: radius.surface, borderTopRightRadius: radius.surface, padding: spacing.lg, paddingBottom: spacing.lg + safe.paddingBottom, alignItems: 'center', ...elevated('floating') }
              : { position: 'absolute', left, top, width: DUE_PANEL_WIDTH, padding: spacing.lg, borderRadius: radius.surface, backgroundColor: colors.card, borderWidth: themeMode() === 'dark' ? 1 : 0, borderColor: colors.border, ...elevated('floating') }}
            accessibilityViewIsModal
            testID={`${idBase}-panel`}
          >
            <View style={{ width: DUE_PANEL_WIDTH - spacing.lg * 2 }}>{panelBody}</View>
          </View>
        </View>
      </Modal>
  );
  if (anchorAt) return modal;

  return (
    <View style={{ gap: spacing.sm }}>
      <View ref={fieldRef} collapsable={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={fieldLabel ? `${fieldLabel}${label ? `：${label}` : ''}` : label ? tr('tasks.copy.185', { v0: label }) : tr('tasks.copy.186')}
          onPress={begin}
          style={[f.input, f.row, error ? { borderColor: colors.failed } : null]}
          testID={idBase}
        >
          <Ionicons name="calendar-outline" size={16} color={colors.textMuted} />
          <Text style={{ flex: 1, color: label ? colors.text : colors.textMuted, fontSize: typeScale.body }} numberOfLines={1} testID={`${idBase}-value`}>{label || placeholder || tr('tasks.copy.187')}</Text>
          {value ? (
            <Pressable accessibilityRole="button" accessibilityLabel={tr('tasks.copy.188')} onPress={() => onChange('')} hitSlop={8} testID={`${idBase}-x`}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </Pressable>
      </View>
      {!requireTime ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {dueShortcuts(today).map(o => (
          <Pressable key={o.key} onPress={() => onChange(o.value)} style={[s.chip, { height: 28 }, value === o.value && s.chipOn]} testID={`${idBase}-${o.key}`} accessibilityRole="button">
            <Text style={[s.chipText, value === o.value && s.chipTextOn]}>{validationText(o.label)}</Text>
          </Pressable>
        ))}
        {value ? (
          <Pressable onPress={() => onChange('')} style={[s.chip, { height: 28 }]} testID={`${idBase}-clear`} accessibilityRole="button">
            <Text style={s.chipText}>{tr('tasks.copy.183')}</Text>
          </Pressable>
        ) : null}
      </View> : null}
      {error ? <Text style={s.err} accessibilityRole="alert">{error}</Text> : null}
      {modal}
    </View>
  );
}

const makePickerStyles = () => StyleSheet.create({
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  week: { flexDirection: 'row' },
  weekDay: { textAlign: 'center', fontSize: 11 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 4 },
  day: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.item },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timeBox: { width: 40, height: 32, borderWidth: 1, borderRadius: radius.item, textAlign: 'center', fontSize: 14, padding: 0 },
  footBtn: { height: 32, justifyContent: 'center' },
});
