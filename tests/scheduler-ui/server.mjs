import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../../dist');
const base = {
  network_id: 'net-fixture', target_node_id: 'node-fixture-a', target_alias: 'demo-inspector',
  task_content: 'Inspect the fixture nodes and summarize availability. This task is local demo data only.',
  priority: 'normal', schedule: { type: 'daily', time: '12:30' }, timezone: 'Asia/Shanghai',
  misfire_policy: 'skip', revision: 1, last_run_at: '2026-10-21T03:30:00Z',
};
const seed = () => [
  { ...base, schedule_id: 'daily', name: 'Daily node inspection', status: 'active', next_run_at: '2026-10-21T04:30:00Z' },
  { ...base, schedule_id: 'weekly', name: 'Weekly team digest', target_alias: 'demo-reporter', target_node_id: 'node-fixture-b', status: 'active', schedule: { type: 'weekly', time: '16:00', weekdays: [1, 3, 5] }, next_run_at: '2026-10-21T08:00:00Z' },
  { ...base, schedule_id: 'paused', name: 'Paused backup audit', status: 'paused', next_run_at: null },
  { ...base, schedule_id: 'completed', name: 'Completed release check', status: 'completed', next_run_at: null },
  { ...base, schedule_id: 'cancelled', name: 'Cancelled legacy report', status: 'cancelled', next_run_at: null, last_run_at: null },
];
const runs = id => [
  { run_id: `${id}-done`, status: 'replied', task_id: `task-${id}-done`, scheduled_for: '2026-10-21T03:30:00Z', created_at: '2026-10-21T03:30:00Z', completed_at: '2026-10-21T03:32:12Z' },
  { run_id: `${id}-failed`, status: 'failed', error_code: 'target_not_active', error_message: 'Fixture node was offline', scheduled_for: '2026-10-20T03:30:00Z', created_at: '2026-10-20T03:30:00Z', completed_at: '2026-10-20T03:30:03Z' },
  { run_id: `${id}-skipped`, status: 'skipped', error_code: 'previous_run_active', scheduled_for: '2026-10-19T03:30:00Z', created_at: '2026-10-19T03:30:00Z', completed_at: null },
].map(r => ({ ...r, schedule_id: id }));
const nodes = ['inspector', 'reporter'].map((name, i) => ({ node_id: `node-fixture-${i ? 'b' : 'a'}`, alias: `demo-${name}`, runtime: 'claude-code', lifecycle_state: 'active' }));
const denseNodes = Array.from({ length: 44 }, (_, i) => ({
  node_id: `node-dense-${String(i).padStart(2, '0')}`,
  alias: i < 2 ? 'duplicate-worker' : i === 2 ? `long-alias-${'regional-inspection-worker-'.repeat(8)}` : `dense-worker-${String(i).padStart(2, '0')}`,
  runtime: 'claude-code', lifecycle_state: 'active',
}));
const denseSeed = () => [...seed(), ...denseNodes.map(n => ({ ...base, schedule_id: `dense-${n.node_id}`, name: `Plan ${n.node_id}`, target_node_id: n.node_id, target_alias: n.alias, status: 'paused', next_run_at: null }))];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

export async function startServer(port = 0) {
  const index = readFileSync(resolve(dist, 'index.html'), 'utf8');
  let dense = process.env.SCHEDULER_DENSE === '1';
  let schedules = dense ? denseSeed() : seed();
  const requests = [], writes = [], unhandled = [];
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const p = u.pathname;
    const json = (body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (p === '/__fixture/reset' && req.method === 'POST') { dense = u.searchParams.get('dense') === '1'; schedules = dense ? denseSeed() : seed(); requests.length = writes.length = unhandled.length = 0; return json({ ok: true, dense }); }
    if (p === '/__fixture/state') return json({ schedules, requests, writes, unhandled, dense, dist, indexSha256: createHash('sha256').update(index).digest('hex') });
    if (p.startsWith('/api/')) {
      const entry = { method: req.method, path: p, query: u.search };
      requests.push(entry);
      if (req.headers.authorization !== 'Bearer utok_local_fixture_only') return json({ error: 'fixture_token_required' }, 401);
      if (req.method === 'GET') {
        if (p === '/api/scheduled-tasks') return json({ ok: true, schedules });
        const run = p.match(/^\/api\/scheduled-tasks\/([^/]+)\/runs$/);
        if (run) return json({ ok: true, runs: runs(run[1]) });
        if (p === '/api/nodes') return json({ ok: true, nodes: dense ? [...nodes, ...denseNodes] : nodes });
        if (p === '/api/status') return json({ ok: true, sessions: (dense ? [...nodes, ...denseNodes] : nodes).map(n => ({ ...n, agent: n.runtime, status: 'idle', updated_at: '2026-10-21T04:00:00Z', last_seen_at: '2026-10-21T04:00:00Z' })) });
        if (p === '/api/tasks' && u.searchParams.has('task_id')) {
          const task = { task_id: u.searchParams.get('task_id'), status: 'replied', content: base.task_content, result: '## Fixture inspection complete\n\nAll **2** demo nodes are healthy. No production systems were contacted.', from_name: 'scheduler', to_name: 'demo-inspector', created_at: '2026-10-21T03:30:00Z', completed_at: '2026-10-21T03:32:12Z' };
          return json({ ok: true, task, tasks: [task] });
        }
        // Background App reads are empty fixtures, logged for reproducibility.
        return json({ ok: true, tasks: [], messages: [], nodes: [], sessions: [], schedules: [], edits: [], networks: [{ network_id: 'net-fixture', name: 'Local Fixture' }], members: [], groups: [], requirements: [], unread: 0 });
      }
      if (req.method === 'PATCH' && /^\/api\/scheduled-tasks\/[^/]+$/.test(p)) {
        let raw = ''; for await (const chunk of req) raw += chunk;
        let body; try { body = JSON.parse(raw); } catch { return json({ error: 'invalid_json' }, 400); }
        const row = schedules.find(s => s.schedule_id === p.split('/').pop());
        if (!row || body.revision !== row.revision) return json({ error: 'revision_conflict' }, 409);
        if (!['active', 'paused'].includes(body.status) || Object.keys(body).some(k => !['revision', 'status'].includes(k))) return json({ error: 'fixture_write_not_allowed' }, 405);
        Object.assign(row, { status: body.status, revision: row.revision + 1 });
        writes.push({ ...entry, body }); return json({ ok: true, schedule: row });
      }
      // No proxy, persistence, task execution, or arbitrary mutation exists here.
      unhandled.push(entry); return json({ error: 'fixture_write_not_allowed' }, 405);
    }
    try {
      const file = p === '/__fixture/bootstrap.js' ? resolve(here, 'bootstrap.js') : resolve(dist, `.${decodeURIComponent(p)}`);
      if (p !== '/__fixture/bootstrap.js' && file !== dist && !file.startsWith(dist + sep)) return json({ error: 'forbidden' }, 403);
      if (p === '/' || p === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:" });
        return res.end(index.replace('<head>', '<head><script src="/__fixture/bootstrap.js"></script>'));
      }
      if (!statSync(file).isFile()) return json({ error: 'not_found' }, 404);
      res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }); res.end(readFileSync(file));
    } catch { json({ error: 'not_found' }, 404); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { url } = await startServer(Number(process.env.PORT || 9327));
  console.log(`Scheduler fixture preview: ${url} (dark: ${url}?theme=dark)`);
}
