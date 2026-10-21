// 看板 #623 —— runtime_readiness → 胶囊 / 能不能选 / 原因。纯函数,ck 风格自执行。
// 覆盖:字段缺席(不灰)、每个 state、hub 给的 unknown、认不出的 state、共用登录提醒,
// 以及两个屏幕确实用这张映射(读源码:react-native 组件在这里 import 不了)。
import { readFileSync } from 'node:fs';
import {
  UNCHECKED_LABEL, chipTitle, hasReadiness, readinessChips, readinessFor, readinessSelectable, sharedLoginWarning,
  type ReadinessInput, DETECTED_LABEL } from './runtime-readiness';

let passed = 0, total = 0;
const check = (name: string, ok: boolean, extra = '') => { total++; if (ok) { passed++; console.log('✅', name); } else { console.error('❌', name, extra); } };

const CHECKED = '2026-10-06T03:00:00.000Z';
const mixed: ReadinessInput = {
  runtimes_supported: ['claude-agent-sdk', 'codex-app-server', 'grok-build-acp', 'opencode-cli', 'claude-code-cli'],
  runtime_readiness: {
    'claude-agent-sdk': { ok: true, state: 'ready', reason: '可以创建', checked_at: CHECKED, version: '0.0.0', cli: 'bundled', auth: 'present', network: 'reachable' },
    'codex-app-server': { ok: false, state: 'not_logged_in', reason: 'codex 没登录：在该机器 CODEX_HOME 下 codex login --device-auth', checked_at: CHECKED, cli: 'found', auth: 'absent' },
    'grok-build-acp': { ok: false, state: 'missing_cli', reason: '这台机器没装 grok', checked_at: CHECKED, cli: 'missing' },
    'opencode-cli': { ok: false, state: 'no_network', reason: '连不上 opencode.ai：检查这台机器的代理', checked_at: CHECKED, network: 'unreachable' },
    'claude-code-cli': { ok: false, state: 'unknown', reason: '检测超时', checked_at: CHECKED },
  },
};

// ── ① 字段缺席:和今天一样,什么都不灰 ──
for (const [label, d] of [
  ['absent', { runtimes_supported: ['claude-agent-sdk'] }],
  ['null', { runtimes_supported: ['claude-agent-sdk'], runtime_readiness: null }],
  ['array (malformed)', { runtimes_supported: ['claude-agent-sdk'], runtime_readiness: [] as any }],
] as Array<[string, ReadinessInput]>) {
  const v = readinessFor(d, 'claude-agent-sdk');
  check(`🔴 ${label}: not measured, selectable, no chip, no note`, !v.measured && v.selectable && v.chip === null && v.note === null && v.reason === null);
  check(`${label}: hasReadiness = false`, hasReadiness(d) === false);
  check(`${label}: picker gets null (render as today)`, readinessChips(d) === null);
  check(`${label}: any runtime selectable`, readinessSelectable(d, 'grok-build-acp') && readinessSelectable(d, 'whatever'));
}

// ── ② 每个 state ──
const ready = readinessFor(mixed, 'claude-agent-sdk');
check('ready: ✓ chip, selectable, no note', ready.chip === 'ready' && ready.icon === '✓' && ready.selectable && ready.note === null && ready.reason === null);
check('ready: version carried', ready.version === '0.0.0');

for (const [id, state, reason] of [
  ['codex-app-server', 'not_logged_in', 'codex 没登录：在该机器 CODEX_HOME 下 codex login --device-auth'],
  ['grok-build-acp', 'missing_cli', '这台机器没装 grok'],
  ['opencode-cli', 'no_network', '连不上 opencode.ai：检查这台机器的代理'],
] as const) {
  const v = readinessFor(mixed, id);
  check(`🔴 ${state}: ✗ chip and NOT selectable`, v.chip === 'blocked' && v.icon === '✗' && v.selectable === false && v.state === state);
  check(`${state}: reason shown as-is (chip + note)`, v.reason === reason && v.note === reason, String(v.note));
  check(`${state}: chip title names the runtime and the reason`, chipTitle({ runtime: id, view: v }) === `${id}：${reason}`);
}

// blocked 但 hub 没给 reason:兜底一句,不留空
const noReason = readinessFor({ runtime_readiness: { x: { ok: false, state: 'missing_cli' } } }, 'x');
check('blocked without reason: fallback text, still not selectable', !noReason.selectable && !!noReason.note && noReason.note.length > 4);

// ── ③ unknown(hub 给的)→ ? 胶囊、可选、「未检测」 ──
const unk = readinessFor(mixed, 'claude-code-cli');
check('🔴 hub unknown: ? chip, STILL selectable', unk.chip === 'unknown' && unk.icon === '?' && unk.selectable === true);
check('hub unknown: note = 未检测 + reason', unk.note === `${UNCHECKED_LABEL}：检测超时`, String(unk.note));
const unkBare = readinessFor({ runtime_readiness: { x: { ok: false, state: 'unknown', reason: '' } } }, 'x');
check('hub unknown without reason: note = 未检测', unkBare.note === UNCHECKED_LABEL);

// #1975(admin 2026-10-21:「怎么 OpenCode 还检测不到」)—— daemon 常常是**故意**跳过
// auth/network 探测,但 CLI 是找到了的(cli:'found' + version)。这时说「未检测」是错的:
// 一句话里既说「未检测」又说「检测到 OpenCode V2」,读起来自相矛盾。
const opencodeV2 = readinessFor({
  runtime_readiness: {
    'opencode-cli': {
      ok: false, state: 'unknown', version: '2.0.22', cli: 'found', auth: 'unknown', network: 'skipped',
      reason: '检测到 OpenCode V2;provider、模型和登录取决于目标节点配置',
    },
  },
}, 'opencode-cli');
check('🔴 CLI 找到了就不说「未检测」', !String(opencodeV2.note).startsWith(UNCHECKED_LABEL), String(opencodeV2.note));
check('🔴 说了「已检测到 CLI」并带上版本', String(opencodeV2.note).includes(`${DETECTED_LABEL} CLI 2.0.22`), String(opencodeV2.note));
check('🔴 原样保留 daemon 给的原因', String(opencodeV2.note).includes('检测到 OpenCode V2'), String(opencodeV2.note));
check('🔴 仍然可选、胶囊仍是 ? (不装也不禁)', opencodeV2.selectable === true && opencodeV2.chip === 'unknown' && opencodeV2.icon === '?');
const unknownNoCli = readinessFor({ runtime_readiness: { x: { ok: false, state: 'unknown', reason: '检测超时' } } }, 'x');
check('真的没测到 CLI 时仍然是「未检测」', unknownNoCli.note === `${UNCHECKED_LABEL}：检测超时` && !unknownNoCli.cliDetected);
// hub 认不出的 state(未来新增)/ state 缺失 / 条目不是对象 → unknown、可选
for (const [label, entry] of [['future state', { ok: false, state: 'rate_limited', reason: 'x' }], ['no state', { ok: true }], ['entry is a string', 'ready']] as Array<[string, any]>) {
  const v = readinessFor({ runtime_readiness: { x: entry } }, 'x');
  check(`${label}: → unknown, selectable (never greyed on a guess)`, v.chip === 'unknown' && v.selectable);
}
// state 说了算:ok=true 但 state=missing_cli → 仍不可选;ok=false 但 state=ready → 可选
check('state decides over ok (ok:true + missing_cli → blocked)', !readinessSelectable({ runtime_readiness: { x: { ok: true, state: 'missing_cli', reason: 'r' } } }, 'x'));
check('state decides over ok (ok:false + ready → selectable)', readinessSelectable({ runtime_readiness: { x: { ok: false, state: 'ready' } } }, 'x'));
// daemon 报了 readiness 但这个 runtime 没条目 → 未检测、可选
const missingEntry = readinessFor(mixed, 'codex-sdk');
check('readiness present but no entry for runtime → ? 未检测, selectable', missingEntry.measured && missingEntry.chip === 'unknown' && missingEntry.selectable && missingEntry.note === UNCHECKED_LABEL);

// ── ④ 共用登录提醒:只提醒,仍 ready ──
const shared = readinessFor({ runtime_readiness: { 'codex-app-server': { ok: true, state: 'ready', reason: '可以创建', shared_login_count: 3 } } }, 'codex-app-server');
check('🔴 shared_login_count 3: still ready + selectable', shared.chip === 'ready' && shared.selectable);
check('shared_login_count 3: warning 「与 3 个节点共用登录」', shared.sharedLoginWarning === '与 3 个节点共用登录', String(shared.sharedLoginWarning));
check('shared_login_count 1: no warning', sharedLoginWarning(1) === null);
check('shared_login_count 0 / missing / NaN / string: no warning', sharedLoginWarning(0) === null && sharedLoginWarning(undefined) === null && sharedLoginWarning(NaN) === null && sharedLoginWarning('5') === null);
check('ready chip title carries the shared warning', chipTitle({ runtime: 'codex-app-server', view: shared }).includes('与 3 个节点共用登录'));

// ── 胶囊排序:先 runtimes_supported,再补 readiness 独有的 ──
const chips = readinessChips({ runtimes_supported: ['b', 'a'], runtime_readiness: { a: { state: 'ready' }, c: { state: 'missing_cli', reason: 'r' } } })!;
check('chips: supported order first, then readiness-only keys', chips.map(c => c.runtime).join() === 'b,a,c', chips.map(c => c.runtime).join());
check('chips: supported runtime without entry is ? 未检测', chips[0].view.chip === 'unknown');
check('chips: one per runtime of the mixed daemon', readinessChips(mixed)!.length === 5);

// ── 两个屏幕确实走这张映射(源码级接线守卫)──
const wiz = readFileSync(new URL('./CreateNodeWizardScreen.tsx', import.meta.url), 'utf8');
const picker = readFileSync(new URL('./HostSupervisorPickerScreen.tsx', import.meta.url), 'utf8');
check('wizard: imports readinessFor from ./runtime-readiness', /import \{[^}]*readinessFor[^}]*\} from '\.\/runtime-readiness'/.test(wiz));
check('wizard: a runtime row is disabled by readiness (allowed includes .selectable)', /const allowed = [^;\n]*\.selectable/.test(wiz));
check('wizard: 下一步 on the runtime step is gated by readiness too', /isRuntimeAllowed[\s\S]{0,400}readinessSelectable\(daemon/.test(wiz));
check('picker: imports readinessChips', /import \{[^}]*readinessChips[^}]*\} from '\.\/runtime-readiness'/.test(picker));

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
