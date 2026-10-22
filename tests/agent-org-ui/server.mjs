import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../../dist');
const departments = [
  ['tmai', 'TMAI', null], ['tmwork', 'TMWork', 'tmai'],
  ['stations', 'Stations', 'tmwork'], ['station-a', 'Station Alpha', 'stations'],
  ['station-b', 'Station Beta', 'stations'],
  ...Array.from({ length: 45 }, (_, i) => [`station-${i + 10}`, `Station ${i + 10}`, 'stations']),
].map(([id, name, parent_id], sort) => ({ id, name, parent_id, sort, leader_user_id: null, member_count: 0 }));
const seed = populated => Array.from({ length: 329 }, (_, i) => ({ node_id: `original-${String(i).padStart(3, '0')}`, alias: `original329-agent-${String(i).padStart(3, '0')}`, department_id: populated && i < 3 ? 'station-a' : null }));

export async function startServer(port = 0) {
  const index = readFileSync(resolve(dist, 'index.html'), 'utf8');
  const assets = [...index.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => ({ path: m[1], sha256: createHash('sha256').update(readFileSync(resolve(dist, `.${m[1]}`))).digest('hex') }));
  let agents = seed(false), deny = false;
  const requests = [], writes = [], unhandled = [];
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1'), p = u.pathname;
    const json = (body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (p === '/__fixture/reset' && req.method === 'POST') { agents = seed(u.searchParams.get('populated') === '1'); deny = false; requests.length = writes.length = unhandled.length = 0; return json({ ok: true }); }
    if (p === '/__fixture/deny' && req.method === 'POST') { deny = u.searchParams.get('value') !== '0'; return json({ deny }); }
    if (p === '/__fixture/state') return json({ agents, departments, deny, requests, writes, unhandled, assets, indexSha256: createHash('sha256').update(index).digest('hex') });
    if (p.startsWith('/api/')) {
      const entry = { method: req.method, path: p, query: u.search }; requests.push(entry);
      if (req.headers.authorization !== 'Bearer utok_local_fixture_only') return json({ error: 'fixture_token_required' }, 401);
      if (req.method === 'GET') {
        if (p === '/api/networks/net-fixture/departments') return json({ ok: true, departments, members: [] });
        if (p === '/api/requirements/people/directory') {
          const offset = Number(u.searchParams.get('offset') || 0);
          // Exercise actual directory pagination; human membership must not place agents.
          const people = Array.from({ length: 201 }, (_, i) => ({ user_id: `human-${i}`, username: `fixture-human-${i}`, display_name: `Fixture Owner ${i}`, department: { id: 'tmwork', name: 'TMWork' }, agents: i === 200 ? agents.slice(0, 200) : [] }));
          return json({ ok: true, people: people.slice(offset, offset + 200), agents_without_owner: offset === 0 ? agents.slice(200) : [], agent_department_supported: true, has_more: offset === 0, next_offset: offset === 0 ? 200 : null });
        }
        if (p === '/api/nodes') return json({ ok: true, nodes: [] });
        if (p === '/api/status') return json({ ok: true, sessions: [] });
        return json({ ok: true, tasks: [], messages: [], nodes: [], sessions: [], schedules: [], edits: [], networks: [{ network_id: 'net-fixture', name: 'Local Fixture' }], members: [], groups: [], requirements: [], unread: 0 });
      }
      const match = p.match(/^\/api\/networks\/net-fixture\/nodes\/([^/]+)\/department$/);
      if (req.method === 'PUT' && match) {
        let raw = ''; for await (const chunk of req) raw += chunk;
        let body; try { body = JSON.parse(raw); } catch { return json({ error: 'invalid_json' }, 400); }
        const agent = agents.find(a => a.node_id === decodeURIComponent(match[1]));
        const status = deny ? 403 : !agent ? 404 : body.department_id !== null && !departments.some(d => d.id === body.department_id) ? 400 : 200;
        writes.push({ ...entry, body, status });
        // Delay makes the optimistic state observable without changing App code.
        await new Promise(r => setTimeout(r, 350));
        if (status !== 200) return json({ ok: false, error: status === 403 ? 'department_scope_denied' : status === 404 ? 'node_not_found' : 'department_not_found' }, status);
        agent.department_id = body.department_id; return json({ ok: true, department_id: agent.department_id });
      }
      unhandled.push(entry); return json({ error: 'fixture_write_not_allowed' }, 405);
    }
    try {
      if (p === '/__fixture/bootstrap.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(readFileSync(resolve(here, '../scheduler-ui/bootstrap.js'), 'utf8') + '\n' + readFileSync(resolve(here, 'bootstrap.js'), 'utf8')); }
      const file = resolve(dist, `.${decodeURIComponent(p)}`);
      if (file !== dist && !file.startsWith(dist + sep)) return json({ error: 'forbidden' }, 403);
      if (p === '/' || p === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:" });
        return res.end(index.replace('<head>', '<head><script src="/__fixture/bootstrap.js"></script>'));
      }
      if (!statSync(file).isFile()) return json({ error: 'not_found' }, 404);
      res.writeHead(200, { 'content-type': ({ '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream' }); res.end(readFileSync(file));
    } catch { json({ error: 'not_found' }, 404); }
  });
  await new Promise((r, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', r); });
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(`Agent org fixture preview: ${(await startServer(Number(process.env.PORT || 9339))).url}`);
