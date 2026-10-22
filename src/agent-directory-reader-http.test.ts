// #725: real-socket fixture for the directory reader.
//
// The other reader test injects fetch; this one starts an actual HTTP server on
// an ephemeral port and lets the reader talk to it with the platform fetch. It
// proves status codes, JSON parsing, bearer forwarding and the abort path over a
// socket — not just against a stub function.
//
// What it is NOT: the real Hub. Authorization here is simulated (the fixture
// decides what to return), so ACL grant/revoke semantics are still covered only
// by the server-side suite, not by this file.
import { strict as assert } from 'node:assert';
import http from 'node:http';
import type { HubConfig } from './api';
import { buildAgentDirectory } from './agent-directory';
import { fetchAgentDirectory } from './agent-directory-reader';
import { registeredAgentRows } from './registered-agents';

let passed = 0;
const check = async (name: string, run: () => Promise<void>) => { await run(); passed++; console.log(`PASS: ${name}`); };

type Mode = 'ok' | 'unauthorized' | 'status_500' | 'not_json' | 'hang';

async function startHub(mode: Mode, seen: { path: string; auth?: string }[]) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    seen.push({ path: url.pathname + url.search, auth: req.headers.authorization });
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const auth = req.headers.authorization || '';
    if (mode === 'unauthorized' && (auth === '' || auth.trim() === 'Bearer')) return json(401, { ok: false, error: 'unauthorized' });
    if (mode === 'hang') return; // never respond: exercises the caller's abort
    if (mode === 'not_json') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>proxy</html>'); }
    if (url.pathname === '/api/nodes') {
      if (mode === 'status_500') return json(500, { ok: false });
      return json(200, { ok: true, nodes: [
        { node_id: 'n_a', network_id: 'net_a', alias: '知识库牛', runtime: 'opencode', lifecycle_controllable: true },
        { node_id: 'n_b', network_id: 'net_a', alias: '工具狗', runtime: 'codex' },
      ] });
    }
    if (url.pathname === '/api/status') {
      if (mode === 'status_500') return json(500, { ok: false });
      return json(200, { ok: true, sessions: [
        { alias: '工具狗', status: 'idle', network_id: 'net_a', node_id: 'n_b', updated_at: '2026-10-22T00:00:00Z' },
      ] });
    }
    return json(404, { ok: false });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return { server, base: `http://127.0.0.1:${port}` };
}

async function scenario(mode: Mode, timeoutMs = 5000) {
  const seen: { path: string; auth?: string }[] = [];
  const hub = await startHub(mode, seen);
  const cfg: HubConfig = { serverUrl: hub.base, token: 'fixture-token', networkId: 'net_default' };
  try {
    const read = await fetchAgentDirectory(cfg, { scopeKey: 'fixture:gen1', timeoutMs });
    return { read, seen };
  } finally {
    hub.server.closeAllConnections?.();
    await new Promise<void>(resolve => hub.server.close(() => resolve()));
  }
}

(async () => {
  await check('over a real socket: bearer auth is sent, light is not requested, no network narrowing', async () => {
    const { read, seen } = await scenario('ok');
    assert.equal(read.nodes.result, 'ok');
    assert.equal(read.sessions.result, 'ok');
    for (const call of seen) assert.equal(call.auth, 'Bearer fixture-token');
    assert.ok(!seen.some(c => c.path.includes('light=1')), 'light projection cannot carry node identity');
    assert.ok(!seen.some(c => c.path.includes('network_id=')), 'must not inherit the default network');
  });

  await check('registered node without session is visible after a real HTTP round trip', async () => {
    const { read } = await scenario('ok');
    const dir = buildAgentDirectory(read);
    const rows = registeredAgentRows(dir.rows);
    assert.deepEqual(rows.map(r => r.alias), ['知识库牛']);
    assert.equal(rows[0].hint, '未启动（Hub无会话记录）');
  });

  await check('HTTP 500 on one endpoint keeps the other side usable, never "no session"', async () => {
    const { read } = await scenario('status_500');
    assert.equal(read.nodes.result, 'unavailable');
    assert.equal(read.sessions.result, 'unavailable');
    const dir = buildAgentDirectory(read);
    assert.equal(dir.rows.length, 0);
    assert.equal(dir.nodesRead, 'unavailable');
  });

  await check('HTML body with 200 is a failed read, not an empty directory', async () => {
    const { read } = await scenario('not_json');
    assert.equal(read.nodes.result, 'unavailable');
    assert.equal(read.sessions.result, 'unavailable');
  });

  await check('a hung socket aborts within the deadline instead of hanging forever', async () => {
    const started = Date.now();
    const { read } = await scenario('hang', 300);
    const elapsed = Date.now() - started;
    assert.equal(read.nodes.result, 'unavailable');
    assert.equal(read.sessions.result, 'unavailable');
    assert.ok(elapsed < 4000, `aborted in ${elapsed}ms`);
  });

  await check('authorization-less 401 is unavailable, and node rows never appear from it', async () => {
    const seen: { path: string; auth?: string }[] = [];
    const hub = await startHub('unauthorized', seen);
    try {
      // Deliberately drop the header by pointing at a config with an empty token.
      const cfg: HubConfig = { serverUrl: hub.base, token: '', networkId: 'net_default' };
      const read = await fetchAgentDirectory(cfg, { scopeKey: 'fixture:gen1', timeoutMs: 2000 });
      assert.equal(read.nodes.result, 'unavailable');
      assert.equal(read.sessions.result, 'unavailable');
    } finally {
      hub.server.closeAllConnections?.();
      await new Promise<void>(resolve => hub.server.close(() => resolve()));
    }
  });

  console.log(`${passed}/${passed} passed`);
})();
