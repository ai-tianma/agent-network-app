// run: bun src/hub-secrets.test.ts
import { readFileSync } from 'node:fs';
import { fetchHubSecrets, type HubConfig } from './api';
import { hubSecretUpdatedAt, hubSecretsView, HUB_SECRETS_EMPTY } from './hub-secrets';

let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) { pass++; console.log('✅', name); }
  else console.log('❌', name, extra);
};

const cfg: HubConfig = { serverUrl: 'http://hub.test', token: 'utok_x', networkId: 'net_a' } as HubConfig;

// ── 四态：不支持 ≠ 没权限 ≠ 空 ≠ 列表 ──
ck('未返回 → loading', hubSecretsView(null).kind === 'loading');
ck('空列表 → empty', (() => { const v = hubSecretsView({ ok: true, keys: [] }); return v.kind === 'empty' && v.text === HUB_SECRETS_EMPTY; })());
ck('不支持 → error 且不可重试', (() => { const v = hubSecretsView({ ok: false, unsupported: true, error: 'x' }); return v.kind === 'error' && v.retryable === false; })());
ck('没权限 → error 可重试', (() => { const v = hubSecretsView({ ok: false, forbidden: true, error: 'x' }); return v.kind === 'error' && v.retryable === true; })());

// ── 列表：排序 + 第二道名字过滤（值形状的东西不渲染）──
{
  const v = hubSecretsView({ ok: true, keys: [
    { key: 'ZULU_KEY', updated_at: 1 },
    { key: 'ALPHA_KEY', updated_at: null },
    { key: 'lower-case', updated_at: 1 },
    { key: 'ghp_' + 'A'.repeat(40), updated_at: 1 },
  ] as any });
  ck('排序 + 只留合法 key 名', v.kind === 'list' && v.rows.map(r => r.key).join(',') === 'ALPHA_KEY,ZULU_KEY', JSON.stringify(v));
}
{
  const v = hubSecretsView({ ok: true, keys: [{ key: 'bad-name', updated_at: 1 }] as any });
  ck('全部不合法 → empty（不是列表）', v.kind === 'empty');
}

// ── 更新时间格式化 ──
ck('epoch ms → 分钟', hubSecretUpdatedAt(1700000000000) === '2023-11-14 22:13', hubSecretUpdatedAt(1700000000000));
ck('ISO 文本 → 分钟', hubSecretUpdatedAt('2026-10-18T12:34:56.000Z') === '2026-10-18 12:34');
ck('缺失 → 空串（不补假值）', hubSecretUpdatedAt(null) === '' && hubSecretUpdatedAt('') === '');
ck('无法识别 → 空串', hubSecretUpdatedAt(123) === '');

// ── fetchHubSecrets 的 map + 三态 ──
const withFetch = async (fn: (url: string) => Response | Promise<Response>) => {
  const original = globalThis.fetch;
  let seen = '';
  (globalThis as any).fetch = async (input: any) => { seen = String(input); return fn(seen); };
  try { const r = await fetchHubSecrets(cfg); return { r, seen }; }
  finally { (globalThis as any).fetch = original; }
};

{
  const { r, seen } = await withFetch(() => new Response(JSON.stringify({ ok: true, keys: [{ key: 'A_KEY', updated_at: 1 }] }), { status: 200 }));
  ck('成功 → keys 透传', r.ok === true && (r as any).keys.length === 1);
  ck('请求带 network_id', seen.includes('network_id=net_a'), seen);
}
{
  const { r } = await withFetch(() => new Response('{}', { status: 404 }));
  ck('404 → unsupported', r.ok === false && (r as any).unsupported === true);
}
{
  const { r } = await withFetch(() => new Response('{}', { status: 403 }));
  ck('403 → forbidden', r.ok === false && (r as any).forbidden === true);
}
{
  const { r } = await withFetch(() => new Response('{"ok":true}', { status: 200 }));
  ck('缺 keys 数组 → 错误（不假装空）', r.ok === false);
}
{
  const { r } = await withFetch(() => { throw new Error('boom'); });
  ck('抛错 → 错误文本，不外抛', r.ok === false && String((r as any).error).includes('boom'));
}

console.log(`\n${pass}/${total} passed`);
if (pass !== total) process.exit(1);

// ── admin 2026-10-19：环境变量页「只读」得像只读页，并且要能一步走到能写的地方 ──
{
  const read = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
  const pane = read('HubSecretsPane.tsx');
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  ck('环境变量页写明「只读」并指向令牌页',
    pane.includes('这一页**只读**') && pane.includes('Hub 令牌 · API 密钥库'));
  ck('环境变量页有跳到令牌页的入口（testID 固定）',
    pane.includes('testID="hub-secrets-open-tokens"') && pane.includes('onOpenTokens'));
  ck('入口文案说明写入在哪、需要什么权限',
    pane.includes('添加 / 替换密钥') && pane.includes('网络所有者或管理员权限'));
  ck('App 把 hubEnv 的入口接到 hubTokens（不是死链）',
    /screen\.name === 'hubEnv' \? <HubSecretsPane cfg=\{cfg\} onOpenTokens=\{\(\) => setScreen\(\{ name: 'hubTokens' \}\)\} \/>/.test(app));
}
