// 纯逻辑单测(bun/node 可跑·无 RN 依赖)。run: bun src/board-sync.test.ts
// 看板省流读(精简列表 + 增量):任何时刻看板上的卡,必须和那一刻整读(精简)的列表逐行相同;旧 Hub 永远整读完整列表。
import { readFileSync } from 'node:fs';
import type { Requirement } from './requirements-model';
import {
  applyChanges,
  BOARD_RESYNC_MS,
  checklistCounts,
  cursorAfterList,
  mergeListRows,
  needsFullText,
  planBoardRead,
  recountChildren,
  type BoardSyncState,
} from './board-sync';
import { requirementFromHub } from './requirements-hub';
import { searchedTasks } from './task-search';

let p = 0, t = 0;
const ck = (n: string, c: boolean, detail?: unknown) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n, detail ?? ''); };

const T0 = Date.parse('2026-09-30T10:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const card = (id: string, extra: Partial<Requirement> = {}): Requirement => ({ id, name: id, priority: 'normal', assignee: '', due: '', column: 'pool', createdAt: iso(T0), updatedAt: iso(T0), children: { total: 0, done: 0 }, ...extra });
const summaryOf = (r: Requirement): Requirement => {
  const { description, checklist, ...rest } = r;
  return { ...rest, summary: true, hasDescription: !!description, checklistCount: { total: checklist?.length ?? 0, done: checklist?.filter(i => i.done).length ?? 0 } };
};

// ── 读法 ──
const fresh: BoardSyncState = { cursor: null, fullAt: 0 };
const warm: BoardSyncState = { cursor: iso(T0), fullAt: T0 };
const ALL = ['search', 'list_summary', 'changes'];
ck('旧 Hub(没有 list_summary)→ 永远整读完整列表', JSON.stringify(planBoardRead(['search'], false, warm, T0 + 1000)) === JSON.stringify({ kind: 'list', summary: false }));
ck('.75:还没有游标 → 整读精简列表', JSON.stringify(planBoardRead(ALL, false, fresh, T0)) === JSON.stringify({ kind: 'list', summary: true }));
ck('.75:有游标 → 增量', JSON.stringify(planBoardRead(ALL, false, warm, T0 + 1000)) === JSON.stringify({ kind: 'changes', since: iso(T0) }));
ck('有 list_summary 没有 changes → 只精简不增量', JSON.stringify(planBoardRead(['list_summary'], false, warm, T0 + 1000)) === JSON.stringify({ kind: 'list', summary: true }));
ck('表被截断(> 500 张)→ 不增量(手里不是整张表)', planBoardRead(ALL, true, warm, T0 + 1000).kind === 'list');
ck('距上次整读满 BOARD_RESYNC_MS → 整读一次', planBoardRead(ALL, false, warm, T0 + BOARD_RESYNC_MS).kind === 'list' && planBoardRead(ALL, false, warm, T0 + BOARD_RESYNC_MS - 1).kind === 'changes');

// ── 解析精简行 ──
const parsed = requirementFromHub({ id: 'r1', name: 'x', column: 'pool', priority: 'normal', createdAt: iso(T0), updatedAt: iso(T0), has_description: true, checklist_count: { total: 3, done: 2 } })!;
ck('精简行:summary + hasDescription + checklistCount,没有 description / checklist', parsed.summary === true && parsed.hasDescription === true && parsed.checklistCount!.total === 3 && parsed.description === undefined && parsed.checklist === undefined);
const fullParsed = requirementFromHub({ id: 'r1', name: 'x', column: 'pool', priority: 'normal', createdAt: iso(T0), description: 'd', checklist: [{ id: 'c', text: 't', done: true }] })!;
ck('完整行照旧:没有 summary 标记', fullParsed.summary === undefined && fullParsed.description === 'd' && fullParsed.checklist!.length === 1);
ck('卡片进度:完整行按条目算,精简行用计数', checklistCounts(fullParsed).total === 1 && checklistCounts(fullParsed).done === 1 && checklistCounts(parsed).total === 3 && checklistCounts({}).total === 0);
ck('打开精简行才需要补读全文', needsFullText(parsed) && !needsFullText(fullParsed) && !needsFullText(null));

// ── 全文带着走 ──
{
  const full = card('a', { description: '很长的描述', checklist: [{ id: 'c1', text: 'x', done: false }] });
  const same = mergeListRows([full], [summaryOf(full)]);
  ck('精简行换进来、updatedAt 没变 → 手里的全文留着,summary 标记去掉', same[0].description === '很长的描述' && same[0].checklist!.length === 1 && same[0].summary === undefined);
  const changed = mergeListRows([full], [summaryOf({ ...full, updatedAt: iso(T0 + 5000), description: '别人改了' })]);
  ck('updatedAt 变了 → 丢掉旧全文(打开时按 id 重读)', changed[0].description === undefined && changed[0].summary === true);
  ck('完整行换进来照旧是完整行', mergeListRows([], [full])[0] === full);
}

// ── Poll identity and changes independent of updatedAt ──
{
  const rows = Array.from({ length: 500 }, (_, i) => card(`p${i}`, { createdAt: iso(T0 - i * 1000), tags: ['ANet'], owner: { kind: 'user', id: 'u1' }, participants: [], children: { total: 0, done: 0 } }));
  const wire = JSON.parse(JSON.stringify(rows));
  ck('500-row unchanged full read keeps the same list and all row identities', mergeListRows(rows, wire) === rows);
  ck('empty delta keeps list identity', applyChanges(rows, [], []) === rows);
  const optimistic = [card('child', { parentId: 'parent', column: 'done', createdAt: iso(T0 + 1) }), card('parent', { children: { total: 1, done: 0 } })];
  ck('empty delta still reconciles child counts after a local optimistic status change', applyChanges(optimistic, [], []).find(row => row.id === 'parent')!.children!.done === 1);
  const one = rows[0];
  const changes: Partial<Requirement>[] = [
    { readOnly: true, editFields: ['column'] }, { children: { total: 3, done: 2 } },
    { tags: ['ANet', 'macOS'] }, { owner: { kind: 'user', id: 'u2' } },
    { participants: [{ kind: 'node', id: 'n2' }] }, { completedAt: iso(T0 + 1000) },
    { lastEvent: { type: 'comment', summary: 'new comment', at: iso(T0 + 1000) } as any },
  ];
  for (const patch of changes) {
    const next = mergeListRows(rows, [{ ...one, ...patch }, ...wire.slice(1)]);
    ck(`same updatedAt still delivers ${Object.keys(patch).join(',')}`, next !== rows && next[0] !== one && next[1] === rows[1] && JSON.stringify(next[0]) === JSON.stringify({ ...one, ...patch }));
  }
  const full = card('full', { description: 'cached text', checklist: [{ id: 'c', text: 'check', done: false }] });
  const cached = [full];
  ck('unchanged summary retains opened full-text object and list', mergeListRows(cached, [summaryOf(full)]) === cached);
  ck('new order reaches subscribers', mergeListRows(rows, [...wire].reverse()) !== rows);
  ck('removed optional field is not hidden', mergeListRows([{ ...one, readOnly: true }], [one])[0] === one);
}

// ── 增量并入 ──
{
  const a = card('a', { createdAt: iso(T0 + 1) }), b = card('b', { createdAt: iso(T0 + 2) }), c = card('c', { createdAt: iso(T0 + 3), parentId: 'a' });
  const base = recountChildren([c, b, a]);
  ck('recountChildren:父卡的子需求数按手里的表算', base.find(x => x.id === 'a')!.children!.total === 1 && base.find(x => x.id === 'a')!.children!.done === 0);
  const d = card('d', { createdAt: iso(T0 + 4) });
  const next = applyChanges(base, [summaryOf({ ...c, column: 'done', updatedAt: iso(T0 + 9) }), summaryOf(d), { ...summaryOf(b), archived: true }], []);
  ck('增量:新卡加进来、按 Hub 顺序(createdAt 新→旧)', next.map(x => x.id).join() === 'd,c,a');
  ck('增量:归档的卡移出看板', !next.some(x => x.id === 'b'));
  ck('增量:子卡进了「完成」→ 父卡的计数跟着变(Hub 不会重发父卡)', next.find(x => x.id === 'a')!.children!.done === 1);
  const gone = applyChanges(next, [], ['c']);
  ck('增量:deleted 里的卡删掉,父卡计数归零', gone.map(x => x.id).join() === 'd,a' && gone.find(x => x.id === 'a')!.children!.total === 0);
  ck('整读后的游标 = 最新的 updatedAt(兼容旧库的「YYYY-MM-DD HH:MM:SS」)', cursorAfterList([card('x', { updatedAt: '2026-09-30 10:00:05' }), card('y', { updatedAt: iso(T0 + 2000) })]) === iso(T0 + 5000) && cursorAfterList([]) === null);
}

// ── 等价性:假 Hub 按 .75 的语义回精简列表 / 增量,看板每一拍都要等于同一刻的整读 ──
{
  let now = T0;
  let seq = 0;
  type Row = Requirement & { deletedAt?: number };
  const hub = new Map<string, Row>();
  const tombstones: Array<{ id: string; at: number }> = [];
  const touch = (r: Row) => { now += 7; r.updatedAt = iso(now); };
  const newCard = (parent?: string) => { now += 7; const id = `r${String(++seq).padStart(4, '0')}`; hub.set(id, card(id, { createdAt: iso(now), updatedAt: iso(now), parentId: parent ?? null, description: `d${seq}`, checklist: [] })); };
  const hubChildren = (id: string) => { let total = 0, done = 0; for (const r of hub.values()) if (r.parentId === id && !r.archived) { total++; if (r.column === 'done') done++; } return { total, done }; };
  const hubList = (): Requirement[] => [...hub.values()].filter(r => !r.archived)
    .sort((x, y) => (x.createdAt !== y.createdAt ? (x.createdAt < y.createdAt ? 1 : -1) : x.id < y.id ? 1 : -1))
    .map(r => summaryOf({ ...r, children: hubChildren(r.id) }));
  const hubChanges = (since: string) => {
    const serverTime = iso(now);
    const rows = [...hub.values()].filter(r => r.updatedAt! >= since).map(r => ({ ...summaryOf({ ...r, children: hubChildren(r.id) }), ...(r.archived ? { archived: true } : {}) }));
    const deleted = tombstones.filter(x => iso(x.at) >= since).map(x => x.id);
    return { rows, deleted, serverTime };
  };
  for (let i = 0; i < 30; i++) newCard(i > 5 && i % 4 === 0 ? `r${String(i - 3).padStart(4, '0')}` : undefined);

  let items: Requirement[] = [];
  let sync: BoardSyncState = { cursor: null, fullAt: 0 };
  const caps = ALL;
  let rng = 11;
  const rand = () => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng / 2147483648; };
  const pick = () => { const all = [...hub.values()]; return all[Math.floor(rand() * all.length)]; };
  let allEqual = true, firstDiff: unknown = null, changesReads = 0, listReads = 0;
  for (let tick = 0; tick < 150; tick++) {
    // Hub 上这 15 s 发生的事:建卡(有的挂在父卡下)、改、移列、归档 / 取消归档、删(删父卡:子卡解挂 + updated_at 动)
    const ops = Math.floor(rand() * 4);
    for (let k = 0; k < ops; k++) {
      const roll = rand();
      const r = pick();
      if (roll < 0.25 || !r) newCard(rand() < 0.3 && r ? r.id : undefined);
      else if (roll < 0.5) { r.name = `${r.name}'`; touch(r); }
      else if (roll < 0.7) { r.column = r.column === 'done' ? 'doing' : 'done'; touch(r); }
      else if (roll < 0.85) { r.archived = !r.archived; touch(r); }
      else {
        now += 7;
        for (const child of hub.values()) if (child.parentId === r.id) { child.parentId = null; touch(child); }
        hub.delete(r.id);
        tombstones.push({ id: r.id, at: now });
      }
    }
    now += 15_000;
    const plan = planBoardRead(caps, false, sync, now);
    if (plan.kind === 'changes') {
      changesReads++;
      const delta = hubChanges(plan.since);
      items = applyChanges(items, delta.rows, delta.deleted);
      sync = { ...sync, cursor: delta.serverTime };
    } else {
      listReads++;
      items = mergeListRows(items, hubList());
      sync = { cursor: cursorAfterList(items), fullAt: now };
    }
    const want = hubList();
    const norm = (rows: Requirement[]) => JSON.stringify(rows.map(r => [r.id, r.name, r.column, r.parentId, r.children, r.updatedAt]));
    if (norm(items) !== norm(want)) { allEqual = false; firstDiff ??= { tick, plan: plan.kind, got: items.map(x => x.id).join(), want: want.map(x => x.id).join() }; }
  }
  ck('150 拍(建 / 改 / 移列 / 归档 / 取消归档 / 删父卡):看板每一拍都与同一刻的整读逐行相同(含子需求计数)', allEqual, firstDiff);
  ck('绝大多数拍走增量,整读只有第一拍和每 10 分钟一次', listReads === 1 + Math.floor((150 * 15_000) / BOARD_RESYNC_MS) && changesReads === 150 - listReads, { listReads, changesReads });
}

// ── 搜索:精简行的描述本机不知道,服务端说命中就算命中 ──
{
  const mine = { ...card('m'), summary: true as const, hasDescription: true };
  const other = card('o', { description: '无关' });
  const hit = { ...card('m'), description: '含有 关键字 的描述' };
  const search = { q: '关键字', archived: false } as any;
  const ctx = { people: [], projects: null, meId: null } as any;
  const got = searchedTasks([mine, other], [], search, ctx, [hit]);
  ck('服务端命中本机的精简行 → 结果里是本机那一行(不是服务端的完整行)', got.length === 1 && got[0] === mine);
  const fullMine = card('f', { description: '本机有全文但不含' });
  ck('本机有全文且判定不匹配 → 仍不从服务端带回(行为不变)', searchedTasks([fullMine], [], search, ctx, [{ ...fullMine, description: '关键字' }]).length === 0);
}

// ── 接线 ──
const board = readFileSync(new URL('./RequirementBoard.tsx', import.meta.url), 'utf8');
ck('看板轮询按 planBoardRead 选读法(旧 Hub 回退到完整列表)', board.includes('planBoardRead(st0.capabilities, st0.truncated, sync.current, Date.now())') && board.includes("listRequirementsFull(cfg, { summary: plan.kind === 'list' ? plan.summary : true })"));
ck('读的时候本机改过卡:增量不并、游标不动', /if \(gen !== mutations\.current \|\| inFlight\.current !== 0\) return;\s*\n\s*const list = applyChanges/.test(board));
ck('打开精简行按 id 补读全文', board.includes('needsFullText(selected)') && board.includes('getRequirementOnHub(cfg, openId)'));
// 精简行没有描述正文:有搜索词就问服务端(Hub 支持 search 时不再看截不截断、有没有精简行,task-search.ts needsServerSearch)。
ck('精简行在场时搜索问服务端', board.includes("needsServerSearch(serverSearchCap ? ['search'] : [], search)"));

console.log(`\n${p}/${t} passed`);
if (p !== t) { if (typeof process !== 'undefined') process.exit(1); }
