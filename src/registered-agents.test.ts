import { strict as assert } from 'node:assert';
import type { AgentDirectoryRow } from './agent-directory';
import { registeredAgentRows, registeredAgentSummary } from './registered-agents';

let passed = 0;
const check = (name: string, run: () => void) => { run(); passed++; console.log(`PASS: ${name}`); };

const node = (over: Record<string, unknown> = {}) => ({
  kind: 'registered' as const,
  key: 'node:["net_a","n_a"]',
  node: { node_id: 'n_a', network_id: 'net_a', alias: '知识库牛', node_name: null, runtime: 'opencode' },
  ...over,
});
const noSession = node({ association: 'no_session_record', session: null }) as AgentDirectoryRow;
const unknownRow = node({ association: 'unknown', session: null, reason: 'sessions_unavailable', node: { node_id: 'n_b', network_id: 'net_b', alias: '工具狗', node_name: null, runtime: null } }) as AgentDirectoryRow;
const matched = node({ association: 'matched', session: { alias: '知识库牛', status: 'idle' } }) as AgentDirectoryRow;
const sessionOnly = { kind: 'session_only', key: 'session:0', session: { alias: '孤儿', status: 'idle' } } as AgentDirectoryRow;

check('only no-session registered rows appear, with the exact hint', () => {
  const rows = registeredAgentRows([noSession, matched, sessionOnly]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hint, '未启动（Hub无会话记录）');
});
check('unknown association is labelled as unconfirmed, never as never-ran', () => {
  const rows = registeredAgentRows([unknownRow]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hint, '会话关联未确认');
});
check('rows are never actionable and carry no lifecycle fields', () => {
  const row = registeredAgentRows([noSession])[0];
  assert.equal(row.actionable, false);
  for (const f of ['status', 'online', 'lifecycle_controllable']) assert.equal(f in row, false);
});
check('identity-less rows are skipped so they cannot duplicate', () => {
  const partial = node({ association: 'unknown', session: null }) as AgentDirectoryRow;
  partial.node = { ...partial.node!, node_id: null };
  assert.equal(registeredAgentRows([partial]).length, 0);
});
check('same network/node appears once even if the directory repeated it', () => {
  const dup = { ...noSession } as AgentDirectoryRow;
  assert.equal(registeredAgentRows([noSession, dup]).length, 1);
});
check('search uses the injected matcher (pinyin) and keeps hint', () => {
  const rows = registeredAgentRows([noSession], { query: 'zsk', match: (t, q) => t === '知识库牛' && q === 'zsk' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hint, '未启动（Hub无会话记录）');
});
check('search miss returns nothing rather than everything', () => {
  assert.equal(registeredAgentRows([noSession], { query: '不存在', match: () => false }).length, 0);
});
check('summary separates certain no-session from unknown', () => {
  const s = registeredAgentSummary(registeredAgentRows([noSession, unknownRow]));
  assert.deepEqual(s, { total: 2, notStarted: 1, unknown: 1 });
});
check('matched and session-only rows never reach the block', () => {
  assert.equal(registeredAgentRows([matched, sessionOnly]).length, 0);
});
console.log(`${passed}/${passed} passed`);
