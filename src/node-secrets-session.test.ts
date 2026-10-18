// run: bun src/node-secrets-session.test.ts
import { keyInputError, mutatingRevision, pollDecision, snapshotView, SECRET_POLL_TIMEOUT_MS, timeoutHint } from './node-secrets-session';

let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) { pass++; console.log('✅', name); }
  else console.log('❌', name, extra);
};

// ── 快照解析 ──
ck('没有快照 → none', snapshotView(null).kind === 'none' && snapshotView(undefined).kind === 'none');
ck('缺 revision → none（不能拿它去改）', snapshotView({ keys: [{ key: 'A_KEY' }] } as any).kind === 'none');
{
  const v = snapshotView({ revision: 3, keys: [{ key: 'Z_KEY' }, { key: 'A_KEY' }, { key: 'A_KEY' }] } as any);
  ck('排序 + 去重', v.kind === 'ok' && v.keys.join(',') === 'A_KEY,Z_KEY');
  ck('revision 透传', v.kind === 'ok' && v.revision === 3);
}
{
  const v = snapshotView({ revision: 1, keys: [{ key: 'lower-case' }, { key: 'BAD KEY' }] } as any);
  ck('非法 key 名被丢掉（值形状也进不来）', v.kind === 'ok' && v.keys.length === 0);
}

// ── 没有 revision 就不允许改 ──
ck('无快照 → 不可改', mutatingRevision(null) === null);
ck('有快照 → 用它的 revision', mutatingRevision({ revision: 7, keys: [] } as any) === 7);

// ── 轮询判定 ──
ck('pending 未超时 → 继续', pollDecision('pending', 0) === 'continue');
ck('pending 超时 → timeout（不是 failed）', pollDecision('pending', SECRET_POLL_TIMEOUT_MS) === 'timeout');
ck('succeeded → done', pollDecision('succeeded', 5) === 'done');
ck('failed → failed', pollDecision('failed', 5) === 'failed');
ck('未知状态按 pending 处理', pollDecision(undefined, 0) === 'continue');

// ── 文案 ──
ck('超时文案说明「可能还在队列里」', timeoutHint().includes('队列'));

// ── Key 输入校验（与 Hub 一致）──
ck('空 → 报错', keyInputError('') !== null && keyInputError('   ') !== null);
ck('小写/连字符/超长 → 报错',
  keyInputError('lower') !== null && keyInputError('A-B') !== null && keyInputError('A'.repeat(65)) !== null);
ck('合法 key → 通过', keyInputError('OPENAI_API_KEY') === null && keyInputError('A1') === null);

console.log(`\n${pass}/${total} passed`);
if (pass !== total) process.exit(1);
