// @ts-nocheck -- repository test scripts run directly under Bun.
// #474 —— 任务评论(Hub kind = comment,正文 new.text)在「动态」和任务详情里能读;旧 Hub 没有评论,照常。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { activityType, ACTIVITY_TYPES, collapseEvents, commentText, describe, parseEvents } from './task-activity-model';
import { cardComments, COMMENTS_SHOWN, localStamp } from './task-comments-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

const ev = (id: number, kind: string, min: number, o: Record<string, unknown> = {}) => ({
  id: String(id), requirement_id: 'r1', seq: 7, title: '示例任务', actor: { kind: 'node', id: 'node_a' }, kind, field: null, old: null, new: null,
  at: new Date(Date.UTC(2026, 9, 2, 10, 0) - min * 60000).toISOString(), ...o,
});
const page = { ok: true, events: [
  ev(9, 'comment', 1, { new: { text: '进展:草稿写完了\n第二行' } }),
  ev(8, 'changed', 2, { field: 'column', old: 'pool', new: 'doing' }),
  ev(7, 'comment', 3, { actor: { kind: 'user', id: 'u1' }, new: { text: '好的' } }),
  ev(6, 'future_kind', 4),
  ev(5, 'comment', 5, { new: { text: '   ' } }),
  ev(4, 'created', 6, { new: { title: '示例任务', column: 'pool' } }),
] };

const parsed = parseEvents(page).events;
ck('parseEvents keeps comment events', parsed.filter(e => e.kind === 'comment').length === 3);
ck('…and still drops kinds it does not know (a newer hub never breaks this app)', !parsed.some(e => e.kind === 'future_kind'));
const c9 = parsed.find(e => e.id === '9');
ck('commentText reads new.text', commentText(c9) === '进展:草稿写完了\n第二行');
ck('activityType(comment) = comment, and it is a filter type', activityType(c9) === 'comment' && ACTIVITY_TYPES.includes('comment'));
const d = describe(c9);
ck('describe(comment) = 「评论:」 + the full text as one comment part', d.lead[0].key === 'act.commented' && d.lead[1].t === 'comment' && d.lead[1].v === '进展:草稿写完了\n第二行');
const rows = collapseEvents([...parsed].sort((a, b) => b.ms - a.ms));
ck('a comment is never folded into an 「更新了 N 项」 row', rows.filter(r => r.events.some(e => e.kind === 'comment')).every(r => r.events.length === 1));

const cs = cardComments(parsed);
ck('cardComments: comments only, oldest → newest, empty ones dropped', cs.map(c => c.id).join() === '7,9');
ck('cardComments keeps the author', cs[0].actor.kind === 'user' && cs[1].actor.kind === 'node');
ck('local stamp format', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(localStamp(Date.now())) && cs[0].at === localStamp(cs[0].ms));
ck('first page shows at most COMMENTS_SHOWN', COMMENTS_SHOWN === 20);

const i18n = readFileSync(join(import.meta.dir, 'i18n-tasks.ts'), 'utf8');
ck('i18n: zh + en for the new strings', ['act.commented', 'act.t.comment', 'comments.title', 'comments.earlier'].every(k => new RegExp(`'${k.replace('.', '\\.')}': \\['[^']+', '[^']+'\\]`).test(i18n)));

const src = (f: string) => readFileSync(join(import.meta.dir, f), 'utf8');
ck('动态 renders a comment part as a multi-line block', /case 'comment': return \(\s*<View style=\{\{ flexBasis: '100%'/.test(src('TaskActivity.tsx')) && src('TaskActivity.tsx').includes('<CommentBody text={part.v} clampLines={8}'));
const detail = src('TaskDetailPanel.tsx');
ck('task detail shows the comments section', detail.includes("<TaskComments key={`comments:${item.id}`} cfg={cfg} requirementId={item.id}"));
const comp = src('TaskComments.tsx');
ck('the section reads one card’s events and polls while open', comp.includes('fetchRequirementEvents(cfg, { requirementId, limit: 200 })') && comp.includes('usePoll(load'));
ck('unknown comment authors → the board member list is read once', detail.includes('onLoadPeople={onLoadPeople} />') && comp.includes('askedPeople.current = true;') && comp.includes('void onLoadPeople();'));
ck('old hub / no comments → nothing drawn', comp.includes('if (!comments.length) return null;') && comp.includes("catch { /* 旧 Hub"));

console.log(`\ntask-comments: ${p}/${t}`);
if (p !== t) process.exit(1);
