// 「每天/每周」的时间(HH:mm)不该让人手打。
//
// admin 2026-10-21:「就别让手输入，直接直接搞一个时间选择器出来，就手输入的话就是体验太差了」。
// 「单次」那一处由 agent-network-app#990 换成 TaskDuePicker;这一处是同一个诉求的另一半 ——
// 每天/每周的「时间」原来也是一个文本框(09:00),手打就容易写成 9:00 / 9:0 / 0900。
//
// 纯函数:解析、格式化、常用时刻。不碰 react-native。

export interface ClockParts {
  hh: number;
  mm: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 解析一个时间草稿。只认「H:mm」「HH:mm」「HH:mm:ss」三种形状 —— 秒被丢掉
 * （每天/每周的语义里没有秒），其余一律当没填。
 */
export function parseClock(value: string | null | undefined): ClockParts | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(raw);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm };
}

/** 规范成接口要的 "HH:mm"。 */
export function formatClock(parts: ClockParts): string {
  const hh = Math.max(0, Math.min(23, Math.trunc(parts.hh)));
  const mm = Math.max(0, Math.min(59, Math.trunc(parts.mm)));
  return `${pad(hh)}:${pad(mm)}`;
}

/** 常用时刻：一天里最常被排进计划的这几个。 */
export const CLOCK_SHORTCUTS: readonly ClockParts[] = [
  { hh: 8, mm: 0 },
  { hh: 9, mm: 0 },
  { hh: 10, mm: 0 },
  { hh: 12, mm: 0 },
  { hh: 14, mm: 0 },
  { hh: 18, mm: 0 },
  { hh: 22, mm: 0 },
];

/** 0..23 的小时候选。 */
export function hourOptions(): number[] {
  return Array.from({ length: 24 }, (_, i) => i);
}

/** 0..59 的分钟候选。 */
export function minuteOptions(): number[] {
  return Array.from({ length: 60 }, (_, i) => i);
}
