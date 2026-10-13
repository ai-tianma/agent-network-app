import { readFileSync } from 'node:fs';
import { taskExecutionState, readTaskDiagnostic } from './task-execution';
import { fetchTaskInspection, type HubConfig } from './api';
import { partitionNodeTasks } from './node-tasks';

let passed = 0;
function ck(name: string, ok: boolean) { if (!ok) throw new Error(name); passed++; console.log(`PASS: ${name}`); }
const submitted = '2026-10-13 12:00:00';
const consumed = '2026-10-13 12:01:00';
for (const status of ['created', 'delivered', 'acked', 'running', 'started']) {
  ck(`${status}/started_at alone does not confirm model start`, taskExecutionState({ status, started_at: submitted }) === 'received');
}
ck('submitted and consumed are distinct', taskExecutionState({ status: 'running', runtime_submitted_at: submitted }) === 'submitted');
ck('consumed confirms start, not a completed reply', taskExecutionState({ status: 'running', consumed_at: consumed }) === 'consumed');
ck('empty runtime evidence stays unconfirmed', taskExecutionState({ status: 'running', consumed_at: ' ' }) === 'received');
for (const status of ['failed', 'timeout', 'expired', 'cancelled', 'replied']) {
  ck(`terminal ${status} overrides old consumption`, !['consumed', 'submitted', 'received'].includes(taskExecutionState({ status, consumed_at: consumed })));
}
const diagnostic = (code: string, extra = {}) => ({ schema_version: 1, code, evidence: {
  task_status: 'running', runtime_submitted: false, runtime_consumed: false,
  target_ever_reported_runtime_evidence: false, target_session_status: 'idle', live_sse_connections: 1,
}, ...extra });
ck('known absent evidence differs from waiting', taskExecutionState({ status: 'running' }, readTaskDiagnostic(diagnostic('runtime_evidence_channel_absent'))) === 'evidenceAbsent');
ck('unknown future diagnostic stays unknown', readTaskDiagnostic(diagnostic('runtime_evidence_channel_absent', { schema_version: 2 })) === null);
ck('missing evidence shape is rejected', readTaskDiagnostic({ schema_version: 1, code: 'target_session_offline', evidence: {} }) === null);
ck('different snapshot cannot override task', taskExecutionState({ status: 'created' }, readTaskDiagnostic(diagnostic('target_session_offline'))) === 'received');
ck('own start evidence wins over target connection diagnosis', taskExecutionState({ status: 'running', consumed_at: consumed }, readTaskDiagnostic(diagnostic('target_session_offline'))) === 'consumed');
ck('transport diagnosis is not generic model failure', taskExecutionState({ status: 'running' }, readTaskDiagnostic(diagnostic('target_no_live_sse'))) === 'disconnected');
const rows = partitionNodeTasks([{ task_id: 'one', status: 'running', runtime_submitted_at: submitted, consumed_at: consumed }]);
ck('node rows preserve both runtime stamps', rows.running[0]?.runtimeSubmittedAt === submitted && rows.running[0]?.consumedAt === consumed);

const cfg: HubConfig = { serverUrl: 'https://hub.test', token: 'utok_synthetic', networkId: 'net_one' };
const paths: string[] = [];
const replies: Response[] = [];
globalThis.fetch = (async (url: unknown) => { paths.push(String(url)); const r = replies.shift(); if (!r) throw new Error('unexpected extra request'); return r; }) as typeof fetch;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
replies.push(json({ ok: true, task: { task_id: 'a/b', status: 'running' }, diagnostic: diagnostic('runtime_evidence_channel_absent') }));
const current = await fetchTaskInspection(cfg, 'a/b');
ck('existing diagnostic read keeps network and escapes task ID', paths[0] === 'https://hub.test/api/tasks/a%2Fb?network_id=net_one');
ck('task and diagnostic arrive from one snapshot, one request', current.diagnostic?.code === 'runtime_evidence_channel_absent' && paths.length === 1);
for (const response of [json({}, 404), json({}, 501), new Response('old help banner', { headers: { 'content-type': 'text/plain' } }), json({ ok: true })]) {
  const before = paths.length;
  replies.push(response, json({ tasks: [{ task_id: 'legacy', status: 'running' }] }));
  const old = await fetchTaskInspection(cfg, 'legacy');
  ck('legacy route falls back scoped and preserves unknown evidence', old.task?.task_id === 'legacy' && old.diagnostic === null && paths.length === before + 2 && paths.at(-1)?.includes('network_id=net_one') === true);
}
for (const status of [401, 403, 503]) {
  const before = paths.length;
  replies.push(json({}, status));
  let failed = false;
  try { await fetchTaskInspection(cfg, 'denied'); } catch { failed = true; }
  ck(`${status} remains a visible error, never a legacy fallback`, failed && paths.length === before + 1);
}
const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
const node = readFileSync(new URL('./NodeTasksSection.tsx', import.meta.url), 'utf8');
ck('chat receipt uses runtime notice without per-row inspection fetch', chat.includes('<TaskExecutionNotice task={item}') && !chat.includes('fetchTaskInspection'));
ck('node list no longer presents creation order as execution rank', !node.includes('排队第') && !node.includes('hint="按执行顺序"') && node.includes('当前没有精确执行名次'));
console.log(`${passed}/${passed} passed`);
