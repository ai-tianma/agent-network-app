// run: bun src/env-transport-hint.test.ts
import { envTransportHint } from './env-transport-hint';

let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) { pass++; console.log('✅', name); }
  else console.log('❌', name, extra);
};

ck('未上报 → unknown（不显示，也不说「安全」）',
  envTransportHint(undefined).kind === 'unknown' && envTransportHint('').kind === 'unknown');
ck('loopback → ok 且说明不出机器', (() => {
  const h = envTransportHint('loopback');
  return h.kind === 'ok' && h.text.includes('本机');
})());
ck('https → ok', envTransportHint('https').kind === 'ok');
ck('plain → warn，且说清后果（不是只说「不安全」）', (() => {
  const h = envTransportHint('plain');
  return h.kind === 'warn' && h.text.includes('明文') && h.text.includes('加密');
})());
ck('未知取值 → warn（不猜安全）', envTransportHint('carrier-pigeon').kind === 'warn');
ck('未知取值会截断展示，不把整串塞进界面',
  (() => { const h = envTransportHint('x'.repeat(100)); return h.kind === 'warn' && h.text.length < 80; })());

console.log(`\n${pass}/${total} passed`);
if (pass !== total) process.exit(1);
