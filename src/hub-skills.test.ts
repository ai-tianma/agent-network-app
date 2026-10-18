// Hub 级技能目录（#1473 / #909）—— 纯逻辑 + 一次真实 fetch 路径。
// run: bun src/hub-skills.test.ts
import { fetchHubSkills, type HubConfig, type HubSkillsResult } from './api';
import { hubSkillBadge, hubSkillSubtitle, hubSkillsView, showPendingToggle } from './hub-skills';

let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) { pass++; console.log('✅', name); }
  else console.log('❌', name, extra);
};

const cfg: HubConfig = { serverUrl: 'http://hub.test', token: 'utok_x', networkId: 'net_a' } as HubConfig;

// ── 四态：不支持 / 没权限 / 空 / 列表 必须分开 ──
ck('未返回 → loading', hubSkillsView(null).kind === 'loading');
ck('空列表 → empty（默认措辞）', (() => {
  const v = hubSkillsView({ ok: true, reviewer: false, skills: [] });
  return v.kind === 'empty' && v.text.includes('还没有已发布');
})());
ck('reviewer + 待审开关 → 空态措辞更宽', (() => {
  const v = hubSkillsView({ ok: true, reviewer: true, skills: [] }, true);
  return v.kind === 'empty' && v.text.includes('也没有待审');
})());
ck('普通成员请求待审也拿不到更宽的措辞', (() => {
  const v = hubSkillsView({ ok: true, reviewer: false, skills: [] }, true);
  return v.kind === 'empty' && !v.text.includes('待审');
})());

// 不支持 ≠ 空列表：这是本组最重要的一条。把「Hub 还没有这个接口」画成
// 「这个网络没有技能」，会让人去查数据而不是去升级。
{
  const v = hubSkillsView({ ok: false, unsupported: true, error: '还没有接口' });
  ck('不支持 → error 且不可重试', v.kind === 'error' && v.retryable === false);
  ck('不支持不会被渲染成空列表', v.kind !== 'empty');
}
{
  const v = hubSkillsView({ ok: false, forbidden: true, error: '没有权限' });
  ck('没权限 → error（可重试，人可能换账号）', v.kind === 'error' && v.retryable === true);
}
{
  const v = hubSkillsView({ ok: false, error: '网络断了' });
  ck('网络错误 → error 且可重试', v.kind === 'error' && v.retryable === true);
}

// ── 列表 ──
{
  const rows = [
    { skill_id: 's1', slug: 'a', name: 'A', description: 'd', version: '1.0.0', status: 'published' },
    { skill_id: 's2', slug: 'b', name: 'B', description: '', version: '2.0.0', status: 'pending' },
  ];
  const v = hubSkillsView({ ok: true, reviewer: true, skills: rows as any });
  ck('有数据 → list 且顺序不变', v.kind === 'list' && v.rows.length === 2 && v.rows[0].slug === 'a');
}

// ── 角标：待审必须是第三态 ──
ck('published → 已发布/ok', hubSkillBadge('published').tone === 'ok' && hubSkillBadge('published').text === '已发布');
ck('pending → 待审/warn（不能混成已上架）', hubSkillBadge('pending').tone === 'warn' && hubSkillBadge('pending').text === '待审');
ck('rejected → 已驳回/muted', hubSkillBadge('rejected').tone === 'muted');
ck('未知状态不崩、原样显示', hubSkillBadge('weird').text === 'weird');

// ── 副标题：缺字段省略，不补假值 ──
ck('版本+来源+时间', hubSkillSubtitle({ skill_id: 's', slug: 'a', name: 'A', description: '', version: '1.2.3', status: 'published', source_alias: '牛', updated_at: '2026-10-18 12:00:00' } as any)
  === 'v1.2.3 · 来自 牛 · 2026-10-18 12:00');
ck('什么都没有 → 空串（不写 0/未知）', hubSkillSubtitle({ skill_id: 's', slug: 'a', name: 'A', description: '', version: '', status: 'published' } as any) === '');
ck('没有 alias 时退回 source_type', hubSkillSubtitle({ skill_id: 's', slug: 'a', name: 'A', description: '', version: '', status: 'published', source_type: 'node' } as any) === 'node');

// ── 待审开关只给 reviewer ──
ck('reviewer 才显示待审开关', showPendingToggle({ ok: true, reviewer: true, skills: [] }) === true);
ck('普通成员不显示', showPendingToggle({ ok: true, reviewer: false, skills: [] }) === false);
ck('失败时不显示', showPendingToggle({ ok: false, error: 'x' }) === false);

// ── fetchHubSkills：请求形状 + 三态映射 ──
{
  let seen = '';
  const original = globalThis.fetch;
  (globalThis as any).fetch = async (input: any) => {
    seen = String(input);
    return new Response(JSON.stringify({ ok: true, reviewer: true, skills: [{ skill_id: 's1', slug: 'a', name: 'A', description: '', version: '1', status: 'published' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const r = await fetchHubSkills(cfg, { includePending: true, limit: 20 });
  (globalThis as any).fetch = original;
  ck('成功 → ok + reviewer', r.ok === true && (r as any).reviewer === true && (r as any).skills.length === 1);
  ck('请求带上 network_id / include_pending / limit', seen.includes('network_id=net_a') && seen.includes('include_pending=1') && seen.includes('limit=20'), seen);
}
{
  const original = globalThis.fetch;
  (globalThis as any).fetch = async () => new Response('{}', { status: 501 });
  const r = await fetchHubSkills(cfg);
  (globalThis as any).fetch = original;
  ck('501 → unsupported（升级提示），不是空列表', r.ok === false && (r as any).unsupported === true);
}
{
  const original = globalThis.fetch;
  (globalThis as any).fetch = async () => new Response('{}', { status: 403 });
  const r = await fetchHubSkills(cfg);
  (globalThis as any).fetch = original;
  ck('403 → forbidden', r.ok === false && (r as any).forbidden === true);
}
{
  const original = globalThis.fetch;
  (globalThis as any).fetch = async () => new Response('{"ok":true}', { status: 200 });
  const r = await fetchHubSkills(cfg);
  (globalThis as any).fetch = original;
  ck('ok 但没有 skills 数组 → 错误（不假装空）', r.ok === false);
}
{
  const original = globalThis.fetch;
  (globalThis as any).fetch = async () => { throw new Error('boom'); };
  const r = await fetchHubSkills(cfg);
  (globalThis as any).fetch = original;
  ck('抛错 → 错误文本，不外抛', r.ok === false && String((r as any).error).includes('boom'));
}

console.log(`\n${pass}/${total} passed`);
if (pass !== total) process.exit(1);
