// #725 old-vs-new control: the same fixture, through the old list pipeline and
// through the new directory pipeline. This is what "the old implementation is
// red" means here — the fixture is the bug report, not a synthetic tautology.
//
// Old pipeline (before this PR): AgentsScreen built its rows from
// `/api/status` sessions only (api.ts fetchStatus -> data.sessions -> agents-list
// buildSections). A node that was registered but never started has no session row,
// so nothing can match it — the agent is simply absent from the list and search.
import { strict as assert } from 'node:assert';
import { buildSections } from './agents-list';
import { buildAgentDirectory } from './agent-directory';
import { registeredAgentRows } from './registered-agents';
import type { Session } from './api';

let passed = 0;
const check = (name: string, run: () => void) => { run(); passed++; console.log(`PASS: ${name}`); };

const scopeKey = 'fixture:account-1:gen1';
// Hub fixture: one started agent and one registered-but-never-started node.
const sessions: Session[] = [
  { alias: '工具狗', status: 'idle', network_id: 'net_a', node_id: 'n_b' } as Session,
] as Session[];
const nodes = [
  { node_id: 'n_a', network_id: 'net_a', alias: '知识库牛', node_name: 'kb', runtime: 'opencode' },
  { node_id: 'n_b', network_id: 'net_a', alias: '工具狗', node_name: null, runtime: 'codex' },
];

/** Exactly what the list did before this PR: sections from sessions, nothing else. */
function oldListAliases(query: string): string[] {
  const sections = buildSections(sessions, query);
  return sections.flatMap(section => section.data.map(row => row.alias));
}

/** What the screen does now: sessions for the list + the read-only directory block. */
function newVisibleAliases(query: string): string[] {
  const dir = buildAgentDirectory({
    scopeKey,
    nodes: { scopeKey, result: 'ok', complete: true, rows: nodes },
    sessions: { scopeKey, result: 'ok', complete: true, rows: sessions },
  });
  const block = registeredAgentRows(dir.rows, { query, match: (text, q) => text.includes(q) })
    .filter(row => !sessions.some(s => s.alias === row.alias));
  const listed = oldListAliases(query);
  return [...listed, ...block.map(row => row.alias)];
}

check('old pipeline cannot show the registered-but-never-started node at all', () => {
  assert.deepEqual(oldListAliases(''), ['工具狗']);
  assert.deepEqual(oldListAliases('知识'), []);
});

check('old pipeline cannot find it by full name either (search is session-bound)', () => {
  assert.equal(oldListAliases('知识库牛').length, 0);
});

check('new pipeline shows it once, next to the real session', () => {
  const aliases = newVisibleAliases('');
  assert.deepEqual(aliases.sort(), ['工具狗', '知识库牛'].sort());
});

check('new pipeline finds it by name, old one does not', () => {
  assert.deepEqual(newVisibleAliases('知识'), ['知识库牛']);
  assert.deepEqual(oldListAliases('知识'), []);
});

check('the fix is not "show everything": an unrelated query still returns nothing', () => {
  assert.deepEqual(newVisibleAliases('不存在的名字'), []);
});

check('the real session is not duplicated into the block', () => {
  assert.equal(newVisibleAliases('工具狗').filter(a => a === '工具狗').length, 1);
});

console.log(`${passed}/${passed} passed`);
