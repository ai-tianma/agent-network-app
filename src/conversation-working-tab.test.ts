import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyConversationTab, applyConversationTabToPeople, CONVERSATION_TABS, parseConversationTab } from './conversation-tab';
import { applyConversationTabToGroups } from './group-chat';
import { buildSections } from './agents-list';

const rows = [
  { alias: '团队/忙碌', status: 'working' },
  { alias: '团队/执行', status: 'running' },
  { alias: '团队/空闲', status: 'idle', task: '旧任务', queue_depth: 3 },
  { alias: '团队/离线', status: 'offline', task: '旧任务' },
  { alias: '团队/错误', status: 'error' },
];
const src = { counts: { '团队/空闲': 2 } };
const working = () => applyConversationTab(rows, 'working', src, '团队/空闲');
assert.deepEqual(CONVERSATION_TABS, ['all', 'unread', 'working']);
assert.equal(parseConversationTab('working'), 'working');
assert.deepEqual(working().map(r => r.alias), ['团队/忙碌', '团队/执行']);
assert.equal(applyConversationTab(rows, 'all', src), rows);
assert.deepEqual(applyConversationTab(rows, 'unread', src).map(r => r.alias), ['团队/空闲']);
const sections = buildSections(working(), '执行', { sort: { pinned: alias => alias === '团队/执行' } });
assert.equal(sections[0].title, '置顶');
assert.deepEqual(sections.flatMap(s => s.data).map(r => r.alias), ['团队/执行']);
rows[0].status = 'idle';
rows[2].status = 'working';
assert.deepEqual(working().map(r => r.alias), ['团队/执行', '团队/空闲']);
assert.deepEqual(applyConversationTabToPeople([{ username: '人类', unread: 1 }], 'working', '人类'), []);
assert.deepEqual(applyConversationTabToGroups([{ group_id: '群', unread: 1 }], 'working', '群'), []);
const screen = readFileSync(new URL('./AgentsScreen.tsx', import.meta.url), 'utf8');
assert.ok(screen.includes('CONVERSATION_TABS.map(k =>'));
assert.ok(screen.includes('testID="agents-empty-working"'));
console.log('working tab: 12 core assertions PASS (5 agents, 2 active; search/pin/live transition/people/groups)');
