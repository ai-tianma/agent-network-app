import { strict as assert } from 'node:assert';
import type { Session } from './api';
import {
  buildAgentDirectory, directorySessionHint, searchAgentDirectory,
  type DirectoryNode, type DirectorySnapshot, type RegisteredDirectoryRow,
} from './agent-directory';

let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`PASS: ${name}`); }
const scopeKey = 'fixture-account:auth-epoch-1:authorized-networks';
const ok = <T>(rows: readonly T[], scope = scopeKey): Extract<DirectorySnapshot<T>, { result: 'ok' }> =>
  ({ scopeKey: scope, result: 'ok', complete: true, rows });
const missing = <T>(): DirectorySnapshot<T> => ({ scopeKey, result: 'unavailable' });
const node = (network_id = 'net_a', node_id = 'n_a', alias = '知识库牛'): DirectoryNode => ({ network_id, node_id, alias });
const session = (network_id: string | null = 'net_a', node_id: string | null = 'n_a', alias = '知识库牛'): Session =>
  ({ network_id, node_id, alias, status: 'idle' });
const build = (nodes: DirectoryNode[], sessions: Session[]) => buildAgentDirectory({ scopeKey, nodes: ok(nodes), sessions: ok(sessions) });
const registered = (result: ReturnType<typeof build>, index = 0) => {
  const row = result.rows[index];
  assert.equal(row.kind, 'registered');
  return row as RegisteredDirectoryRow;
};

check('registered node without session remains visible and searchable', () => {
  const result = build([node()], []);
  assert.equal(result.rows.length, 1);
  assert.equal(registered(result).association, 'no_session_record');
  assert.equal(searchAgentDirectory(result.rows, '知识').length, 1);
  assert.equal(directorySessionHint(registered(result)), '未启动（Hub无会话记录）');
});
check('no invented session status, heartbeat, last-online or lifecycle capability', () => {
  const source = { ...node(), lifecycle_controllable: true, updated_at: 'fixture', config_snapshot: { secret: 'must-not-copy' } };
  const row = registered(build([source], []));
  assert.equal(row.session, null);
  for (const field of ['status', 'updated_at', 'lifecycle_controllable', 'config_snapshot']) {
    assert.equal(field in row, false);
    assert.equal(field in row.node, false);
  }
});
check('exact network/node match consumes the real session once', () => {
  const real = session();
  const result = build([node()], [real]);
  assert.equal(result.rows.length, 1);
  assert.equal(registered(result).association, 'matched');
  assert.equal(registered(result).session, real);
  assert.equal(real.status, 'idle');
  assert.equal(directorySessionHint(registered(result)), null);
});
check('cross-network same alias and node id do not bind', () => {
  const result = build([node()], [session('net_b')]);
  assert.equal(registered(result).association, 'no_session_record');
  assert.equal(result.rows[1].kind, 'session_only');
});
check('same alias in the same network does not replace node identity', () => {
  const result = build([node()], [session('net_a', 'n_other')]);
  assert.equal(registered(result).association, 'no_session_record');
  assert.equal(result.rows.length, 2);
});
check('stable node identity can match after alias changes', () => {
  const real = session('net_a', 'n_a', 'old alias');
  assert.equal(registered(build([node()], [real])).session, real);
});
check('legacy light row without node identity is unknown, not no-session', () => {
  const result = build([node()], [session('net_a', null)]);
  assert.equal(registered(result).association, 'unknown');
  assert.equal(directorySessionHint(registered(result)), '会话关联未确认');
  assert.equal(result.rows[1].kind, 'session_only');
});
check('unscoped legacy session cannot be assigned a default network', () => {
  const result = build([node()], [session(null, 'n_a')]);
  assert.equal(registered(result).association, 'unknown');
  assert.equal(result.rows.length, 2);
});
check('incomplete identity in a different known network does not poison this network', () => {
  assert.equal(registered(build([node()], [session('net_b', null)])).association, 'no_session_record');
});
check('node missing network identity stays unknown without inventing a default', () => {
  const result = build([{ ...node(), network_id: null }], [session()]);
  assert.equal(registered(result).association, 'unknown');
  assert.equal(registered(result).node.network_id, null);
  assert.equal(result.rows.length, 2);
});
check('failed sessions read cannot prove no-session', () => {
  const result = buildAgentDirectory({ scopeKey, nodes: ok([node()]), sessions: missing<Session>() });
  assert.equal(result.sessionsRead, 'unavailable');
  assert.equal(registered(result).association, 'unknown');
});
check('failed node read preserves genuine sessions', () => {
  const real = session();
  const result = buildAgentDirectory({ scopeKey, nodes: missing<DirectoryNode>(), sessions: ok([real]) });
  assert.equal(result.nodesRead, 'unavailable');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].kind, 'session_only');
});
check('different account/scope node snapshot is never merged or searched', () => {
  const result = buildAgentDirectory({ scopeKey, nodes: ok([node()], 'other-account'), sessions: ok([session()]) });
  assert.equal(result.nodesRead, 'scope_mismatch');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].kind, 'session_only');
});
check('different scope session snapshot is not used to infer an empty success', () => {
  const result = buildAgentDirectory({ scopeKey, nodes: ok([node()]), sessions: ok([], 'other-scope') });
  assert.equal(result.sessionsRead, 'scope_mismatch');
  assert.equal(registered(result).association, 'unknown');
});
check('empty expected scope fails closed for both snapshots', () => {
  const result = buildAgentDirectory({ scopeKey: '', nodes: ok([node()], ''), sessions: ok([session()], '') });
  assert.equal(result.rows.length, 0);
  assert.equal(result.nodesRead, 'scope_mismatch');
  assert.equal(result.sessionsRead, 'scope_mismatch');
});
check('partial session reads cannot prove absence', () => {
  const result = buildAgentDirectory({ scopeKey, nodes: ok([node()]), sessions: { ...ok<Session>([]), complete: false } });
  assert.equal(result.sessionsRead, 'incomplete');
  assert.equal(registered(result).association, 'unknown');
});
check('partial node snapshot is not a complete authorized directory', () => {
  const result = buildAgentDirectory({ scopeKey, nodes: { ...ok([node()]), complete: false }, sessions: ok([session()]) });
  assert.equal(result.nodesRead, 'incomplete');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].kind, 'session_only');
});
check('multiple sessions for one identity are kept, not arbitrarily bound', () => {
  const result = build([node()], [session(), { ...session(), status: 'offline' }]);
  assert.equal(registered(result).association, 'unknown');
  assert.equal(result.rows.filter(row => row.kind === 'session_only').length, 2);
});
check('duplicate node identities produce one unknown directory row', () => {
  const result = build([node(), node()], [session()]);
  assert.equal(registered(result).association, 'unknown');
  assert.equal(result.rows.filter(row => row.kind === 'registered').length, 1);
  assert.equal(result.rows.filter(row => row.kind === 'session_only').length, 1);
});
check('tuple keys do not collide on delimiter-like identities', () => {
  const result = build([node('a:b', 'c'), node('a', 'b:c')], []);
  assert.equal(new Set(result.rows.map(row => row.key)).size, 2);
});
check('whitespace identity is not normalized into a binding', () => {
  assert.equal(registered(build([node(' net_a')], [session()])).association, 'unknown');
});
check('injected pinyin matcher searches registered and session-only rows', () => {
  const result = build([node()], [session('net_b', 'n_b', '工具狗')]);
  const pinyin: Record<string, string> = { 知识库牛: 'zskn', 工具狗: 'gjg' };
  const match = (text: string, q: string) => (pinyin[text] ?? text).includes(q);
  assert.equal(searchAgentDirectory(result.rows, 'zsk', match)[0].kind, 'registered');
  assert.equal(searchAgentDirectory(result.rows, 'gj', match)[0].kind, 'session_only');
});
check('empty search returns a copy without mutating inputs or real sessions', () => {
  const nodes = [Object.freeze(node())];
  const sessions = [Object.freeze(session())];
  const result = build(nodes, sessions);
  const filtered = searchAgentDirectory(result.rows, '  ');
  assert.notEqual(filtered, result.rows);
  assert.deepEqual(filtered, result.rows);
  assert.equal(sessions[0].status, 'idle');
});
console.log(`${passed}/${passed} passed`);
