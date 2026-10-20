// agent-network #1511 片二 —— 密钥保存后的「重启二选一」。
// ck 风格自执行脚本(npm test = scripts/run-tests.mjs 逐个 spawn)。
// Expo 的 tsconfig 不含 node types。其它旧测试已有同样的 TS2591，
// 这个新文件不能再多一条，否则全仓 tsc 比基线 +1。
// @ts-expect-error TS2591 node:fs is not in the app tsconfig types list
import { readFileSync } from 'node:fs';
import {
  manualRestartCommand, RESTART_COUNTDOWN_SECONDS, restartChoiceAfterAttempt,
  restartChoiceAfterSecret, restartChoiceText,
} from './node-restart-after-secret';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.error('❌', n); };

// ── 二选一的判定 ────────────────────────────────────────────────
const sched = restartChoiceAfterSecret({ configUpdateCapable: true, online: true });
ck('supervised + 在线 → 安排重启', sched.kind === 'scheduled');
ck('倒计时是常量(可取消窗口)', sched.kind === 'scheduled' && sched.countdownSeconds === RESTART_COUNTDOWN_SECONDS);

const man = restartChoiceAfterSecret({ configUpdateCapable: false, online: true, alias: '狗蛋' });
ck('manual(裸起) → 需要用户自己重启', man.kind === 'manual');
ck('manual 带得出可照抄的命令', man.kind === 'manual' && man.command === 'anet node start 狗蛋');

ck('supervised 但离线 → 仍是 manual(没在跑就没有 SSE 收重启事件)',
  restartChoiceAfterSecret({ configUpdateCapable: true, online: false, alias: 'x' }).kind === 'manual');
ck('Hub 没有 config 接口(null) → manual',
  restartChoiceAfterSecret({ configUpdateCapable: null, online: true, alias: 'x' }).kind === 'manual');
ck('还在读(undefined) → unknown,不猜',
  restartChoiceAfterSecret({ configUpdateCapable: undefined, online: true }).kind === 'unknown');
ck('拿不到 alias 时 manual 也有话说(不是空串)',
  (() => { const r = restartChoiceAfterSecret({ configUpdateCapable: false, online: true }); return r.kind === 'manual' && r.command.length > 0; })());

// ── 安排之后 Hub 拒了(片一的在途门) ─────────────────────────────
const planned = { kind: 'scheduled' as const, countdownSeconds: 5 };
ck('attempt=null(倒计时中/已取消) → 维持原计划',
  restartChoiceAfterAttempt(planned, null).kind === 'scheduled');
ck('重启下发成功 → 终态 restarted(不再挂「N 秒后可取消」误导人)',
  restartChoiceAfterAttempt(planned, { ok: true }).kind === 'restarted');

const busy = restartChoiceAfterAttempt(planned, { ok: false, error: 'node_busy_in_flight', in_flight_count: 3 });
ck('node_busy_in_flight → busy,带计数', busy.kind === 'busy' && busy.inFlightCount === 3);
ck('node_busy_in_flight 缺计数时兜底 0',
  (() => { const r = restartChoiceAfterAttempt(planned, { ok: false, error: 'node_busy_in_flight' }); return r.kind === 'busy' && r.inFlightCount === 0; })());

const fallback = restartChoiceAfterAttempt(planned, { ok: false, error: 'cross_network_node' }, '狗蛋');
ck('其它失败退回 manual(不谎称已安排)', fallback.kind === 'manual' && fallback.kind === 'manual' && fallback.command.includes('狗蛋'));

ck('manual 计划不会被一次成功的调用抬高成 scheduled',
  restartChoiceAfterAttempt({ kind: 'manual', command: 'c' }, { ok: true }).kind === 'manual');
ck('unknown 计划也不会被抬高',
  restartChoiceAfterAttempt({ kind: 'unknown' }, { ok: true }).kind === 'unknown');

// ── 文案 ────────────────────────────────────────────────────────
ck('scheduled 文案点明倒计时 + 可取消',
  (() => { const s = restartChoiceText({ kind: 'scheduled', countdownSeconds: 5 }); return s.includes('5 秒') && s.includes('取消'); })());
ck('manual 文案含命令',
  restartChoiceText({ kind: 'manual', command: 'anet node start 狗蛋' }).includes('anet node start 狗蛋'));
ck('restarted 文案说已下发 + 会自己回来(不再说可取消)',
  (() => { const s = restartChoiceText({ kind: 'restarted' }); return s.includes('已下发') && !s.includes('取消'); })());
ck('busy 文案点明「正在执行任务」(否则用户以为自己错了)',
  restartChoiceText({ kind: 'busy', inFlightCount: 1 }).includes('正在执行任务'));
ck('unknown 文案说正在确认(不谎称已安排)',
  (() => { const s = restartChoiceText({ kind: 'unknown' }); return s.includes('确认') && !s.includes('已安排'); })());

// ── 值不进文案(判据:四条文案都不含值字段的痕迹) ──────────────────
ck('文案里没有值/密钥字样泄漏',
  ['scheduled', 'restarted', 'manual', 'busy', 'unknown'].every(k => !restartChoiceText({ kind: k as never, countdownSeconds: 5, command: 'c', inFlightCount: 1 } as never).includes('值：')));
ck('五个 kind 各有各的文案(不是同一句兜底)',
  new Set(['scheduled', 'restarted', 'manual', 'busy', 'unknown'].map(k =>
    restartChoiceText({ kind: k as never, countdownSeconds: 5, command: 'c', inFlightCount: 1 } as never))).size === 5);

// ── 源码契约:页面真的用了这套逻辑,而不是各写各的 ──────────────────
const secrets = readFileSync(new URL('./NodeSecretsSection.tsx', import.meta.url), 'utf8');
ck('密钥页引入本模块', secrets.includes("from './node-restart-after-secret'"));
ck('密钥页调用 restartChoiceAfterSecret', secrets.includes('restartChoiceAfterSecret('));
ck('密钥页按 choice 出文案(restartChoiceText)', secrets.includes('restartChoiceText('));
// 能力三态是从父级(NodeDetailScreen,它已调 fetchNodeConfig)传下来的 prop,
// 密钥页自己不该再拉一次同样的 config。
ck('密钥页把 config_update_capable 当 prop 收下', secrets.includes('configUpdateCapable'));
ck('密钥页不自拉 config(复用父级那份,避免多打一次接口)', !secrets.includes('fetchNodeConfig('));
const detail = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
ck('父级把 configUpdateCapable + online 传给密钥页', /<NodeSecretsSection[\s\S]*?configUpdateCapable=\{configUpdateCapable\}[\s\S]*?online=\{online\}/.test(detail));
ck('父级确实读了 config_update_capable(fetchNodeConfig)', detail.includes('fetchNodeConfig('));

console.log(`\n${p}/${t} 通过`);
if (p !== t) process.exit(1);
