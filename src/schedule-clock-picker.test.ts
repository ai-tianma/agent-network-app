// 「每天/每周」的时间不手打（admin 2026-10-21）。
//
// 这组断言是「接线」守卫：纯函数在 schedule-clock.test.ts，这里钉住
// ① 编辑器真的换成了选择器 ② 旧的文本框没了 ③ 选择器交出来的仍是 "HH:mm"。
import { readFileSync } from 'node:fs';
import { formatClock, parseClock } from './schedule-clock';

const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const editor = read('ScheduleEditor.tsx');
const picker = read('ScheduleClockPicker.tsx');

let passed = 0;
let total = 0;
function check(name: string, ok: unknown, extra = '') {
  total += 1;
  if (ok) {
    passed += 1;
    console.log(`✅ ${name}`);
  } else {
    console.log(`❌ ${name}${extra ? ` (${extra})` : ''}`);
  }
}

check('the editor imports the clock picker', /import ScheduleClockPicker from '\.\/ScheduleClockPicker'/.test(editor));
check('daily/weekly render the picker', /kind === 'daily' \|\| kind === 'weekly'[\s\S]{0,200}ScheduleClockPicker/.test(editor));
check('the old clock TextInput is gone', !/<Label text="时间"><TextInput[^>]*value=\{clock\}/.test(editor));
check('the picker is given the clock state and setter', /<ScheduleClockPicker value=\{clock\} onChange=\{setClock\}/.test(editor));
check('the picker has an accessible field', /accessibilityLabel="选择时间"/.test(picker));
check('the picker offers hours and minutes', picker.includes('hourOptions()') && picker.includes('minuteOptions()'));
check('the picker offers common times', picker.includes('CLOCK_SHORTCUTS'));
check('the picker commits "HH:mm"', picker.includes('onChange(formatClock(draft))') && formatClock({ hh: 9, mm: 5 }) === '09:05');
check('what the picker writes is what the editor parses back', (() => {
  const written = formatClock({ hh: 18, mm: 45 });
  return parseClock(written)?.hh === 18 && parseClock(written)?.mm === 45;
})());
check('the picker can be cleared', picker.includes("onChange('')"));

console.log(`schedule clock picker wiring: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
