import { test, expect, mock } from 'bun:test';
import React from 'react';
import { act, create } from 'react-test-renderer';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const host = (name: string) => React.forwardRef(({ children, ...props }: any, ref: any) => React.createElement(name, { ...props, ref }, typeof children === 'function' ? children({ hovered: false, pressed: false }) : children));
mock.module('react-native', () => ({ Pressable: host('Pressable'), View: host('View'), ScrollView: host('ScrollView') }));
mock.module('./src/ui-text', () => ({ Text: host('Text'), TextInput: host('TextInput') }));
mock.module('./src/icons', () => ({ Ionicons: () => null }));
mock.module('./src/i18n-react', () => ({ useTranslation: () => {} }));
mock.module('./src/theme', () => ({ colors: {}, radius: {}, spacing: { lg: 16, md: 12, xl: 24 } }));
const none = () => null;
let ownerRenders: string[] = [];
mock.module('./src/TaskBoardParts', () => ({
  ChecklistCompact: none, DueChip: none, ParticipantStack: none, PriorityBadge: none, ProjectChip: none,
  OwnerBadge: ({ item }: any) => { ownerRenders.push(item.id); return null; },
  STATUS_TONE: { pool: () => '#000000' }, a11yState: (s: unknown) => ({ accessibilityState: s }),
}));
mock.module('./src/TaskTags', () => ({ TaskTagChips: none }));
mock.module('./src/TaskIssueBindings', () => ({ TaskIssueCount: none }));
mock.module('./src/TaskListFields', () => ({ default: none }));
mock.module('./src/TaskTimeCell', () => ({ default: none }));
mock.module('./src/TaskFieldPickers', () => ({ ParentLine: none, ProjectSelect: none }));
mock.module('./src/TaskSearch', () => ({ ArchivedTag: none, ReadOnlyTag: none, highlight: (s: string) => s }));
mock.module('./src/TaskListCellEditor', () => ({ CellEditor: none }));
const { default: Table } = await import('./src/TaskListTable');
const { enterTaskScope, patchTaskBoard, taskBoardState, updateTaskItems, useTaskBoard } = await import('./src/task-board-store');
const { mergeListRows, applyChanges } = await import('./src/board-sync');

test('idle poll: actual table subscriber renders zero rows across unchanged full and delta responses', async () => {
  const scope = 'synthetic-mac1136';
  enterTaskScope(scope);
  const rows = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, name: `Task ${i}`, column: 'pool', priority: 'normal', assignee: '', due: '', createdAt: new Date(Date.parse('2026-10-13T00:00:00Z') - i * 1000).toISOString(), updatedAt: '2026-10-13T00:00:00Z', owner: null, tags: ['ANet'], children: { total: 0, done: 0 } })) as any;
  patchTaskBoard(scope, { items: rows });
  let subscriptions = 0;
  function PollTable() {
    const items = useTaskBoard(st => st.items);
    subscriptions++;
    return <Table rows={items} people={[]} projects={null} sort={{ key: 'title', dir: 'asc' } as any} setSort={none} s={{} as any} today="2026-10-13" selectedId={null} onOpen={none} filtered={false} needsUpdateUpgrade={false} touch onMenu={none} />;
  }
  ownerRenders = [];
  let tree: any;
  await act(async () => { tree = create(<PollTable />); });
  expect(ownerRenders.length).toBe(50);
  const before = subscriptions;
  ownerRenders = [];
  // Freshly parsed wire objects, including inclusive >= replay of the newest
  // row. A simple empty-delta shortcut alone cannot pass this test.
  for (let i = 0; i < 12; i++) {
    await act(async () => { updateTaskItems(scope, items => mergeListRows(items, JSON.parse(JSON.stringify(rows)))); });
    await act(async () => { updateTaskItems(scope, items => applyChanges(items, JSON.parse(JSON.stringify([rows[0]])), [])); });
    await act(async () => { updateTaskItems(scope, items => applyChanges(items, [], [])); });
  }
  console.log(`idle poll measured row renders: ${ownerRenders.length}`);
  expect(ownerRenders).toHaveLength(0);
  expect(subscriptions).toBe(before);
  expect(taskBoardState().items).toBe(rows);
  // Permissions can change without updatedAt. A real change must still reach
  // the visible table rather than being suppressed by timestamp equality.
  await act(async () => { updateTaskItems(scope, items => mergeListRows(items, rows.map((r: any, i: number) => i === 0 ? { ...r, readOnly: true } : r))); });
  expect(subscriptions).toBe(before + 1);
  expect(ownerRenders.length).toBe(50);
  expect(taskBoardState().items[0].readOnly).toBe(true);
  expect(taskBoardState().items[1]).toBe(rows[1]);
  await act(async () => tree.unmount());
  console.log('idle poll: 12 full + 12 replay + 12 empty = 0 table renders; unchanged updatedAt permission change reaches table');
});

test('1000 actual table rows: hover updates only affected rows, keeps actions and cleans listeners', async () => {
  ownerRenders = [];
  const nodes = new Map<string, { listeners: Map<string, EventListener>; addEventListener: Function; removeEventListener: Function }>();
  const opened: string[] = [];
  const edits: unknown[] = [];
  const rows = Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}`, name: `Task ${i}`, column: 'pool', priority: 'normal', due: '', createdAt: '2026-10-10T00:00:00Z', owner: null, tags: [] }));
  const props: any = { rows, people: [], projects: null, sort: { key: 'title', dir: 'asc' }, setSort: none, s: {}, today: '2026-10-10', selectedId: null, onOpen: (id: string) => opened.push(id), filtered: false, needsUpdateUpgrade: false, touch: false, onMenu: none, edit: { onEdit: async (...args: unknown[]) => { edits.push(args); return null; }, ctx: {}, onLoadPeople: none } };
  let tree: any;
  await act(async () => { tree = create(<Table {...props} />, { createNodeMock: ({ props: p }: any) => {
    const id = p.testID;
    if (!id?.startsWith('req-row-')) return null;
    if (!nodes.has(id)) {
      const listeners = new Map<string, EventListener>();
      nodes.set(id, { listeners, addEventListener: (k: string, fn: EventListener) => listeners.set(k, fn), removeEventListener: (k: string, fn: EventListener) => { if (listeners.get(k) === fn) listeners.delete(k); } });
    }
    return nodes.get(id);
  } }); });
  expect(ownerRenders.length).toBe(1000);
  const fire = async (row: string, event: string) => { await act(async () => { nodes.get(`req-row-${row}`)!.listeners.get(event)!(new Event(event)); }); };
  ownerRenders = [];
  await fire('r0', 'pointerenter');
  expect(ownerRenders).toEqual(['r0']);
  const button = tree.root.findAll((n: any) => n.type === 'Pressable' && n.props.testID === 'req-row-open-r0')[0];
  expect(button).toBeTruthy();
  await act(async () => button.props.onPress());
  expect(opened).toEqual(['r0']);
  ownerRenders = [];
  await fire('r0', 'pointerleave');
  await fire('r999', 'pointerenter');
  expect(ownerRenders).toEqual(['r0', 'r999']);
  expect(tree.root.findAll((n: any) => n.type === 'Pressable' && n.props.testID === 'req-row-open-r0')).toHaveLength(0);
  expect(nodes.get('req-row-r0')!.listeners.size).toBe(2);
  // Existing inline title edit still uses parent state and the one-field save.
  const cell = () => tree.root.findAll((n: any) => n.type === 'Pressable' && n.props.testID === 'task-cell-r999-title')[0];
  await act(async () => cell().props.onPress({ nativeEvent: {} }));
  await act(async () => cell().props.onPress({ nativeEvent: {} }));
  const input = () => tree.root.findAll((n: any) => n.type === 'TextInput' && n.props.testID === 'list-edit-title-input')[0];
  expect(input()).toBeTruthy();
  await act(async () => input().props.onChangeText('Edited title'));
  await act(async () => input().props.onSubmitEditing());
  expect(edits).toEqual([['r999', { field: 'title', name: 'Edited title' }]]);
  expect(nodes.get('req-row-r999')!.listeners.size).toBe(2);
  // A retained task can move pages after a query/sort change: clear pointer-only
  // state without dropping its task identity or accumulating new listeners.
  await act(async () => tree.update(<Table {...props} pageKey="query:next-page" />));
  expect(tree.root.findAll((n: any) => n.type === 'Pressable' && n.props.testID === 'req-row-open-r999')).toHaveLength(0);
  expect(nodes.get('req-row-r999')!.listeners.size).toBe(2);
  await fire('r999', 'pointerenter');
  expect(tree.root.findAll((n: any) => n.type === 'Pressable' && n.props.testID === 'req-row-open-r999')).toHaveLength(1);
  await act(async () => tree.update(<Table {...props} rows={rows.slice(1)} />));
  expect(nodes.get('req-row-r0')!.listeners.size).toBe(0);
  await act(async () => tree.update(<Table {...props} rows={rows.slice(1)} touch />));
  expect([...nodes.values()].every(n => n.listeners.size === 0)).toBe(true);
  expect(tree.root.findAll((n: any) => n.type === 'Pressable' && n.props.testID === 'req-row-open-r999')).toHaveLength(0);
  await act(async () => tree.update(<Table {...props} rows={rows.slice(1)} />));
  await fire('r999', 'pointerenter');
  await act(async () => tree.unmount());
  expect([...nodes.values()].every(n => n.listeners.size === 0)).toBe(true);
  console.log('1000 rows: enter = 1 row render; leave + enter = 2 row renders; open, removal, touch and unmount PASS');
}, 30_000); // Functional + render-count gate; wall-clock timing is not a performance assertion.
