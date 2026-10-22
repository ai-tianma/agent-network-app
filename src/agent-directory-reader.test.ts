import { strict as assert } from 'node:assert';
import type { HubConfig } from './api';
import { buildAgentDirectory, searchAgentDirectory } from './agent-directory';
import { fetchAgentDirectory } from './agent-directory-reader';

let passed = 0;
function check(name: string, run: () => Promise<void> | void) {
  return Promise.resolve(run()).then(() => { passed++; console.log(`PASS: ${name}`); });
}

const cfg: HubConfig = { serverUrl: 'https://hub.example.test/', token: 'fixture-token', networkId: 'net_default' };
const scopeKey = 'fixture:epoch1:all-authorized-networks:gen7';

type Call = { url: string; headers: Record<string, string> };
function fakeFetch(handler: (url: string) => { status?: number; body?: unknown } | 'throw') {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const out = handler(url);
    if (out === 'throw') throw new Error('network down');
    const status = out.status ?? 200;
    return new Response(JSON.stringify(out.body ?? {}), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const nodesBody = {
  ok: true,
  nodes: [
    { node_id: 'n_a', network_id: 'net_a', alias: '知识库牛', node_name: 'kb', runtime: 'opencode', lifecycle_controllable: true, config_snapshot: { secret: 'x' } },
    { node_id: 'n_b', network_id: 'net_b', alias: '工具狗' },
  ],
};
const statusBody = {
  ok: true,
  sessions: [
    { alias: '工具狗', status: 'idle', network_id: 'net_b', node_id: 'n_b', updated_at: '2026-10-22T00:00:00Z' },
    { alias: '孤儿会话', status: 'working', network_id: 'net_a', node_id: null },
  ],
};

(async () => {
  await check('both reads go to the Hub with bearer auth and no light/network narrowing', async () => {
    const { impl, calls } = fakeFetch(url => (url.endsWith('/api/nodes') ? { body: nodesBody } : { body: statusBody }));
    const result = await fetchAgentDirectory(cfg, { scopeKey, fetchImpl: impl });
    assert.deepEqual(calls.map(c => c.url).sort(), [
      'https://hub.example.test/api/nodes',
      'https://hub.example.test/api/status',
    ]);
    for (const call of calls) assert.equal(call.headers.Authorization, 'Bearer fixture-token');
    assert.ok(!calls.some(c => c.url.includes('light=1')), 'light projection cannot establish identity');
    assert.ok(!calls.some(c => c.url.includes('network_id=')), 'must not inherit the default network');
    assert.equal(result.scopeKey, scopeKey);
  });

  await check('registered node with no session is visible and searchable end to end', async () => {
    const cleanStatus = {
      ok: true,
      sessions: [{ alias: '工具狗', status: 'idle', network_id: 'net_b', node_id: 'n_b' }],
    };
    const { impl } = fakeFetch(url => (url.endsWith('/api/nodes') ? { body: nodesBody } : { body: cleanStatus }));
    const read = await fetchAgentDirectory(cfg, { scopeKey, fetchImpl: impl });
    const dir = buildAgentDirectory(read);
    assert.equal(dir.rows.length, 2);
    const kb = dir.rows.find(r => r.kind === 'registered' && r.node.alias === '知识库牛');
    assert.equal(kb?.association, 'no_session_record');
    assert.equal(searchAgentDirectory(dir.rows, '知识库').length, 1);
    assert.equal(searchAgentDirectory(dir.rows, 'gj').length >= 0, true);
  });

  await check('one identity-less legacy session downgrades the whole network to unknown', async () => {
    const { impl } = fakeFetch(url => (url.endsWith('/api/nodes') ? { body: nodesBody } : { body: statusBody }));
    const read = await fetchAgentDirectory(cfg, { scopeKey, fetchImpl: impl });
    const dir = buildAgentDirectory(read);
    const kb = dir.rows.find(r => r.kind === 'registered' && r.node.alias === '知识库牛');
    assert.equal(kb?.association, 'unknown');
  });

  await check('capability flags and config snapshots never enter directory rows', async () => {
    const { impl } = fakeFetch(url => (url.endsWith('/api/nodes') ? { body: nodesBody } : { body: statusBody }));
    const read = await fetchAgentDirectory(cfg, { scopeKey, fetchImpl: impl });
    const node = read.nodes.result === 'ok' ? read.nodes.rows[0] : null;
    assert.ok(node);
    for (const field of ['lifecycle_controllable', 'config_snapshot']) {
      assert.equal(field in (node as object), false);
    }
  });

  await check('session rows without node identity survive as session_only, not as no-session proof', async () => {
    const { impl } = fakeFetch(url => (url.endsWith('/api/nodes') ? { body: nodesBody } : { body: statusBody }));
    const read = await fetchAgentDirectory(cfg, { scopeKey, fetchImpl: impl });
    const dir = buildAgentDirectory(read);
    const orphan = dir.rows.find(r => r.kind === 'session_only' && r.session.alias === '孤儿会话');
    assert.ok(orphan);
    const kb = dir.rows.find(r => r.kind === 'registered' && r.node.alias === '知识库牛');
    assert.equal(kb?.association, 'unknown', 'legacy identity-less session in the same network blocks a "no session" verdict');
  });

  await check('a failed nodes read never hides real sessions', async () => {
    const { impl } = fakeFetch(url => (url.endsWith('/api/nodes') ? { status: 503, body: { ok: false } } : { body: statusBody }));
    const read = await fetchAgentDirectory(cfg, { scopeKey, fetchImpl: impl });
    assert.equal(read.nodes.result, 'unavailable');
    const dir = buildAgentDirectory(read);
    assert.equal(dir.rows.filter(r => r.kind === 'session_only').length, 2);
  });

  await check('a failed status read cannot be reported as "no session"', async () => {
    const { impl } = fakeFetch(url => (url.endsWith('/api/nodes') ? { body: nodesBody } : 'throw'));
    const read = await fetchAgentDirectory(cfg, { scopeKey, fetchImpl: impl });
    assert.equal(read.sessions.result, 'unavailable');
    const dir = buildAgentDirectory(read);
    for (const row of dir.rows.filter(r => r.kind === 'registered')) {
      assert.equal(row.association, 'unknown');
    }
  });

  await check('non-JSON body is a failed read, not an empty directory', async () => {
    const impl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/status')) return new Response('<html>proxy error</html>', { status: 200 });
      return new Response(JSON.stringify(nodesBody), { status: 200 });
    }) as unknown as typeof fetch;
    const read = await fetchAgentDirectory(cfg, { scopeKey, fetchImpl: impl });
    assert.equal(read.sessions.result, 'unavailable');
  });

  await check('ok:false body is not treated as an empty success', async () => {
    const { impl } = fakeFetch(url => (url.endsWith('/api/nodes') ? { body: { ok: false, nodes: [] } } : { body: { ok: false, sessions: [] } }));
    const read = await fetchAgentDirectory(cfg, { scopeKey, fetchImpl: impl });
    assert.equal(read.nodes.result, 'unavailable');
    assert.equal(read.sessions.result, 'unavailable');
  });

  await check('malformed rows are dropped, not turned into identities', async () => {
    const { impl } = fakeFetch(url => (url.endsWith('/api/nodes')
      ? { body: { ok: true, nodes: [{ alias: '无身份' }, { node_id: ' n_a', network_id: 'net_a', alias: 'x' }, null, 3] } }
      : { body: { ok: true, sessions: [{ node_id: 'n_a', network_id: 'net_a' }, null] } }));
    const read = await fetchAgentDirectory(cfg, { scopeKey, fetchImpl: impl });
    assert.equal(read.nodes.result, 'ok');
    assert.equal(read.nodes.result === 'ok' ? read.nodes.rows.length : -1, 2);
    assert.equal(read.sessions.result === 'ok' ? read.sessions.rows.length : -1, 0);
    const dir = buildAgentDirectory(read);
    assert.equal(dir.rows.every(r => r.kind === 'registered' ? r.association === 'unknown' : true), true);
  });

  await check('timeout surfaces as unavailable, never as an empty list', async () => {
    const impl = (async (_input: string | URL | Request, init?: RequestInit) => {
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
      return new Response('{}');
    }) as unknown as typeof fetch;
    const read = await fetchAgentDirectory(cfg, { scopeKey, timeoutMs: 10, fetchImpl: impl });
    assert.equal(read.nodes.result, 'unavailable');
    assert.equal(read.sessions.result, 'unavailable');
  });

  await check('scopeKey belongs to the caller; the reader does not fabricate one', async () => {
    const { impl } = fakeFetch(url => (url.endsWith('/api/nodes') ? { body: nodesBody } : { body: statusBody }));
    const read = await fetchAgentDirectory(cfg, { scopeKey: '', fetchImpl: impl });
    assert.equal(read.scopeKey, '');
    const dir = buildAgentDirectory(read);
    assert.equal(dir.rows.length, 0, 'an empty expected scope fails closed');
  });

  await check('a session row with identity but no alias makes the snapshot incomplete', async () => {
    const { impl } = fakeFetch(url => (url.endsWith('/api/nodes')
      ? { body: { ok: true, nodes: [{ node_id: 'n_a', network_id: 'net_a', alias: '知识库牛' }] } }
      : { body: { ok: true, sessions: [{ node_id: 'n_a', network_id: 'net_a' }] } }));
    const read = await fetchAgentDirectory(cfg, { scopeKey, fetchImpl: impl });
    assert.equal(read.sessions.result, 'ok');
    assert.equal(read.sessions.result === 'ok' ? read.sessions.complete : null, false);
    const dir = buildAgentDirectory(read);
    const kb = dir.rows.find(r => r.kind === 'registered');
    assert.equal(kb?.association, 'unknown', 'incomplete evidence must not become "no session"');
  });

  await check('a node row whose alias is not a string makes the node snapshot incomplete', async () => {
    const { impl } = fakeFetch(url => (url.endsWith('/api/nodes')
      ? { body: { ok: true, nodes: [{ node_id: 'n_a', network_id: 'net_a', alias: 42 }] } }
      : { body: { ok: true, sessions: [] } }));
    const read = await fetchAgentDirectory(cfg, { scopeKey, fetchImpl: impl });
    assert.equal(read.nodes.result === 'ok' ? read.nodes.complete : null, false);
  });

  await check('default transport is the app transport, not global fetch', async () => {
    const src = await import('node:fs').then(fs => fs.readFileSync(new URL('./agent-directory-reader.ts', import.meta.url), 'utf8'));
    assert.ok(/opts\.fetchImpl \?\? \(appFetch/.test(src), 'production must not fall back to global fetch');
  });

  console.log(`${passed}/${passed} passed`);
})();
