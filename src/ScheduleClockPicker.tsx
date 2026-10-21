// 「每天/每周」的时间选择器：小时网格 + 分钟网格 + 常用时刻，手不打。
//
// admin 2026-10-21:「就别让手输入，直接直接搞一个时间选择器出来，就手输入的话就是体验太差了」。
// 「单次」那一处是 agent-network-app#990（TaskDuePicker）；这里是同一诉求的另一半 ——
// 每天/每周的「时间」原来也是文本框(09:00)，手打容易写成 9:0 / 0900。
//
// 视觉语言沿用 TaskDuePicker（同一个 fieldStyles / 颜色 / 网格），差别只有两点：
//   * 没有日历 —— 每天/每周只关心「几点几分」；
//   * 没有秒 —— 接口的 clock 就是 "HH:mm"。
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { fieldStyles } from './TaskCreateDialog';
import { useModalSafePadding } from './safe-area-runtime';
import { CLOCK_SHORTCUTS, formatClock, hourOptions, minuteOptions, parseClock, type ClockParts } from './schedule-clock';
import { colors, radius, spacing, type as typeScale, weight } from './theme';

const pad = (n: number) => String(n).padStart(2, '0');

export default function ScheduleClockPicker({ value, onChange, idBase, sheet = true }: {
  /** 当前草稿，"HH:mm"；空串 = 还没定。 */
  value: string;
  onChange: (clock: string) => void;
  idBase: string;
  /** 手机 = 底部面板；桌面 = 居中弹层。 */
  sheet?: boolean;
}) {
  const f = fieldStyles();
  const safe = useModalSafePadding('fullScreen');
  const parsed = parseClock(value);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ClockParts>(parsed ?? { hh: 9, mm: 0 });
  const styles = useMemo(() => makeStyles(), []);
  const current = parsed ?? null;

  const begin = () => {
    setDraft(parsed ?? { hh: 9, mm: 0 });
    setOpen(true);
  };
  const commit = () => {
    onChange(formatClock(draft));
    setOpen(false);
  };

  const body = (
    <View style={{ gap: spacing.md }}>
      <View style={{ gap: spacing.xs }}>
        <Text style={styles.caption}>小时</Text>
        <View style={styles.grid}>
          {hourOptions().map(h => {
            const on = draft.hh === h;
            return (
              <Pressable
                key={`h${h}`}
                accessibilityRole="button"
                accessibilityLabel={`${pad(h)} 点`}
                accessibilityState={{ selected: on }}
                onPress={() => setDraft(d => ({ ...d, hh: h }))}
                style={({ pressed }: any) => [styles.cell, on && styles.cellOn, pressed && { opacity: 0.7 }]}
                testID={`${idBase}-hour-${h}`}
              >
                <Text style={{ color: on ? colors.onAccent : colors.text, fontSize: typeScale.body, fontWeight: on ? weight.strong : weight.regular }}>{pad(h)}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={{ gap: spacing.xs }}>
        <Text style={styles.caption}>分钟</Text>
        <ScrollView style={styles.minuteScroll} testID={`${idBase}-minutes`}>
          <View style={styles.grid}>
            {minuteOptions().map(m => {
              const on = draft.mm === m;
              return (
                <Pressable
                  key={`m${m}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${m} 分`}
                  accessibilityState={{ selected: on }}
                  onPress={() => setDraft(d => ({ ...d, mm: m }))}
                  style={({ pressed }: any) => [styles.cell, on && styles.cellOn, pressed && { opacity: 0.7 }]}
                  testID={`${idBase}-minute-${m}`}
                >
                  <Text style={{ color: on ? colors.onAccent : colors.text, fontSize: typeScale.body, fontWeight: on ? weight.strong : weight.regular }}>{pad(m)}</Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {CLOCK_SHORTCUTS.map(s => {
          const label = formatClock(s);
          const on = current !== null && formatClock(current) === label;
          return (
            <Pressable
              key={label}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => { onChange(label); setOpen(false); }}
              style={[styles.chip, on && styles.chipOn]}
              testID={`${idBase}-shortcut-${label.replace(':', '')}`}
            >
              <Text style={{ color: on ? colors.onAccent : colors.text, fontSize: typeScale.small + 1, fontWeight: weight.strong }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={[f.row, { justifyContent: 'space-between' }]}>
        <Pressable accessibilityRole="button" onPress={() => { onChange(''); setOpen(false); }} style={styles.footBtn} testID={`${idBase}-clear`}>
          <Text style={styles.link}>清除</Text>
        </Pressable>
        <View style={[f.row, { gap: spacing.sm }]}>
          <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={[styles.primary, { backgroundColor: colors.subtleFill }]} testID={`${idBase}-cancel`}>
            <Text style={[styles.primaryText, { color: colors.text }]}>取消</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={commit} style={styles.primary} testID={`${idBase}-ok`}>
            <Text style={styles.primaryText}>确定</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="选择时间"
        onPress={begin}
        style={[f.input, { justifyContent: 'center' }]}
        testID={`${idBase}-field`}
      >
        <Text style={{ color: current ? colors.text : colors.textMuted, fontSize: typeScale.body }}>
          {current ? formatClock(current) : '选择时间'}
        </Text>
      </Pressable>
      <Modal visible={open} transparent animationType={sheet ? 'slide' : 'fade'} onRequestClose={() => setOpen(false)}>
        <Pressable accessibilityLabel="关闭" style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={[styles.panel, sheet ? styles.panelSheet : styles.panelCenter, sheet ? { paddingBottom: spacing.lg + safe.paddingBottom } : null]} testID={`${idBase}-panel`}>
          <Text style={styles.title}>选择时间</Text>
          {body}
        </View>
      </Modal>
    </>
  );
}

const makeStyles = () => StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  panel: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  panelSheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '86%' },
  panelCenter: { alignSelf: 'center', width: 340, borderRadius: radius.lg },
  title: { color: colors.text, fontSize: typeScale.body + 1, fontWeight: weight.strong },
  caption: { color: colors.textSecondary, fontSize: typeScale.small, fontWeight: weight.medium },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  cell: {
    width: 44,
    height: 36,
    borderRadius: radius.control,
    backgroundColor: colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellOn: { backgroundColor: colors.accent },
  minuteScroll: { maxHeight: 168 },
  chip: { paddingHorizontal: spacing.md, height: 30, borderRadius: radius.pill, backgroundColor: colors.inputBg, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: colors.accent },
  footBtn: { paddingHorizontal: spacing.sm, height: 34, justifyContent: 'center' },
  link: { color: colors.accent, fontSize: typeScale.body },
  primary: { paddingHorizontal: spacing.lg, height: 34, borderRadius: radius.control, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: colors.onAccent, fontSize: typeScale.body, fontWeight: weight.strong },
});
