import { readFileSync } from 'node:fs';
import { schedulePickerValue } from './schedule-date-time';
import { dueFromLocal, dueToLocal, fixedOffsetClock } from './due-time';

let passed = 0;
const ck = (label: string, ok: boolean) => {
  if (!ok) { console.error(`FAIL: ${label}`); process.exit(1); }
  passed++;
};
ck('empty stays unset', schedulePickerValue('') === '');
ck('blank stays unset', schedulePickerValue('  ') === '');
ck('invalid draft does not schedule a run', schedulePickerValue('not-a-date') === '');
ck('UTC seconds preserved', schedulePickerValue('2026-10-21T10:01:23Z') === '2026-10-21T10:01:23.000Z');
ck('explicit offset preserved as same instant', schedulePickerValue('2026-10-21T18:01:23+08:00') === '2026-10-21T10:01:23.000Z');
const local = '2026-10-21T18:01:23';
ck('legacy local draft retains device-local semantics', schedulePickerValue(local) === new Date(2026, 9, 21, 18, 1, 23).toISOString());
const clock = fixedOffsetClock(480);
const selected = dueFromLocal('2026-10-21', { hh: 18, mm: 1, ss: 23 }, clock);
ck('calendar selection is precise UTC, not all-day', selected === '2026-10-21T10:01:23Z');
const parts = dueToLocal(schedulePickerValue(selected), clock);
ck('reopen selection keeps date/time', parts?.date === '2026-10-21' && parts.time?.hh === 18 && parts.time?.mm === 1 && parts.time?.ss === 23);
const editor = readFileSync(new URL('./ScheduleEditor.tsx', import.meta.url), 'utf8');
const picker = readFileSync(new URL('./TaskDuePicker.tsx', import.meta.url), 'utf8');
ck('single-run form uses calendar requiring time', /<TaskDuePicker[\s\S]*?requireTime[\s\S]*?idBase="schedule-form-run-at"/.test(editor));
ck('raw ISO typing instruction removed', !editor.includes('ISO 或 YYYY-MM-DDTHH:mm'));
ck('date-only shortcuts hidden in required-time mode', picker.includes('anchorAt && !requireTime') && picker.includes('{!requireTime ? <View'));
ck('required-time commit cannot return all-day', picker.includes('(requireTime || !allDay) ? dueFromLocal(date, time) : date'));
ck('cancel only closes the picker', picker.includes('onPress={() => setOpen(false)} style={[s.primary'));
console.log(`${passed}/${passed} passed`);
