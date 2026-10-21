// 「每天/每周」的时间不手打（admin 2026-10-21）。
import {
  CLOCK_SHORTCUTS,
  formatClock,
  hourOptions,
  minuteOptions,
  parseClock,
} from './schedule-clock';

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

check('parses HH:mm', JSON.stringify(parseClock('09:30')) === JSON.stringify({ hh: 9, mm: 30 }));
check('parses H:mm', JSON.stringify(parseClock('9:05')) === JSON.stringify({ hh: 9, mm: 5 }));
check('drops seconds', JSON.stringify(parseClock('09:30:45')) === JSON.stringify({ hh: 9, mm: 30 }));
check('trims spaces', JSON.stringify(parseClock('  09:30 ')) === JSON.stringify({ hh: 9, mm: 30 }));
check('rejects an empty draft', parseClock('') === null && parseClock('   ') === null && parseClock(null) === null);
check('rejects a date-shaped value', parseClock('2026-08-10T09:00') === null);
check('rejects 9:0-with-no-seconds? no — 9:0 is a valid minute', JSON.stringify(parseClock('9:0')) === JSON.stringify({ hh: 9, mm: 0 }));
check('rejects out-of-range hours', parseClock('24:00') === null);
check('rejects out-of-range minutes', parseClock('09:60') === null);
check('rejects text', parseClock('abc') === null);

check('formats as HH:mm', formatClock({ hh: 9, mm: 5 }) === '09:05');
check('formats zero-padded', formatClock({ hh: 0, mm: 0 }) === '00:00');
check('clamps out-of-range input', formatClock({ hh: 99, mm: 99 }) === '23:59');

check('hour options cover a day', hourOptions().length === 24 && hourOptions()[0] === 0 && hourOptions()[23] === 23);
check('minute options cover an hour', minuteOptions().length === 60 && minuteOptions()[59] === 59);
check('shortcuts are on the hour and inside the day', CLOCK_SHORTCUTS.every(s => s.hh % 1 === 0 && s.hh >= 0 && s.hh <= 23 && s.mm === 0));

// round trip: what the picker emits is what the editor stores
const draft = '18:45';
check('round trip keeps the time', formatClock(parseClock(draft)!) === draft);

console.log(`schedule clock: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
