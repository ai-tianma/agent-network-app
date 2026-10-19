// Agent 组织(看板 #766)—— 点真按钮、量真框。占位数据,全在页内(Tauri stub + 下面的小 agent-teams 存储),不起 Hub、不占端口。
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-agent-teams/drive.mjs
//
// desktop 1440×900(设置窗口,鼠标),light + dark:
//   open      设置 → 用户管理 →「Agent 组织」卡片紧跟「组织架构」,两张卡片左右边对齐(≤ 0.5px);左树右详情,顶边对齐
//   tree      树里有团队 + 最后一行「未分组」;点「平台」→ 右边是它的 Agent,负责的那个标「负责」,负责人显示名字;Agent 行头像左边对齐
//   create    「+ 新建子团队」→ 弹窗 → 填名 →「完成」⇒ POST {name, parent_id}
//   assign    「+ 添加 Agent」→ 选未分组的 ⇒ PUT …/nodes/:id/agent-team {team_id};「移出」⇒ {team_id:null}
//   delete    有子团队时「删除」灰掉;叶子团队删除先确认 ⇒ DELETE
//   Member / viewer / team owner open Settings → Agent 组织架构 (read-only department tree).
//   Team editing stays under 用户管理 for admins; the settings entry no longer mounts it.
//   old-hub   接口 404 ⇒ 只一行「需要 Hub ≥ 0.9.0-preview.116」
// phone 390×844(Android UA ⇒ touch),light + dark:
//   drill     用户管理 →「Agent 团队」→ 全屏:团队一行一个 + 「未分组」;点进「平台」→ 子团队 + Agent;底部「管理团队」贴底
//   sheet     点 Agent → 底部面板「设为负责的 Agent / 调到其他团队… / 移出团队」;「移出团队」⇒ PUT {team_id:null}
// Exit 1 on any failure.
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA, openStubWindow } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const fixture = (opts) => {
  const NET = 'net-sweep';
  const members = [
    { user_id: 'u_me', username: 'tester', display_name: null, role: 'owner', agent_access: 'all' },
    { user_id: 'u_a', username: 'alice', display_name: '示例负责人', role: 'member', agent_access: 'all' },
  ];
  const nodes = ['n1', 'n2', 'n3', 'n4'].map((id, i) => ({ node_id: id, alias: `示例节点${i + 1}`, node_name: null, network_id: NET }));
  const store = {
    teams: [
      { id: 't_plat', name: '平台', parent_id: null, sort: 0, lead: 'n1', owner: opts.teamOwner ? 'u_me' : 'u_a' },
      { id: 't_api', name: '接口', parent_id: 't_plat', sort: 0, lead: null, owner: null },
      { id: 't_ops', name: '运维', parent_id: null, sort: 1, lead: null, owner: null },
    ],
    of: { n1: 't_plat', n2: 't_plat', n3: 't_api' },
  };
  window.__teamCalls = [];
  window.__memberReads = 0;
  const ref = id => { const n = nodes.find(x => x.node_id === id); return n ? { node_id: id, alias: n.alias, display_name: null } : null; };
  const view = () => ({ ok: true, teams: store.teams.map(t => ({ id: t.id, name: t.name, parent_id: t.parent_id, sort: t.sort, lead: t.lead ? ref(t.lead) : null,
    owner: t.owner ? { user_id: t.owner, display_name: members.find(m => m.user_id === t.owner)?.display_name ?? '' } : null,
    members: Object.entries(store.of).filter(([, tid]) => tid === t.id).map(([nid]) => ref(nid)) })) });
  window.__routeOverride = (u, body, method) => {
    const p = u.pathname;
    if (p === '/api/auth/me') return { ok: true, user: { user_id: 'u_me', username: 'tester', role: 'user' }, current_network: NET, networks: [{ network_id: NET, network_name: '示例网络', member_role: opts.role, agent_access: 'all' }] };
    if (p === `/api/networks/${NET}/members`) { window.__memberReads++; return opts.role === 'owner' ? { ok: true, members } : { ok: false, error: 'owner/admin required' }; }
    if (p === '/api/requirements/people') return { ok: true, people: members.map(m => ({ kind: 'user', id: m.user_id, name: m.display_name || m.username, networkId: NET })) };
    if (p === `/api/networks/${NET}/departments`) return { ok: true, departments: [], members: [] };
    if (p === '/api/nodes') return { ok: true, nodes, count: nodes.length };
    const b = body ? JSON.parse(body) : null;
    if (p === `/api/networks/${NET}/agent-teams`) {
      if (opts.oldHub) return null;
      if (method === 'POST') { window.__teamCalls.push({ method, path: p, body: b }); const t = { id: `t_${store.teams.length}`, name: b.name, parent_id: b.parent_id ?? null, sort: 9, lead: null, owner: null }; store.teams.push(t); return { ok: true, team: t }; }
      return view();
    }
    let m = /^\/api\/networks\/[^/]+\/agent-teams\/([^/]+)$/.exec(p);
    if (m) {
      window.__teamCalls.push({ method, path: p, body: b });
      const id = decodeURIComponent(m[1]);
      if (method === 'DELETE') { store.teams = store.teams.filter(t => t.id !== id); for (const k of Object.keys(store.of)) if (store.of[k] === id) delete store.of[k]; return { ok: true, deleted: id }; }
      const t = store.teams.find(x => x.id === id);
      if ('name' in b) t.name = b.name; if ('parent_id' in b) t.parent_id = b.parent_id; if ('lead_node_id' in b) t.lead = b.lead_node_id; if ('owner_user_id' in b) t.owner = b.owner_user_id;
      return { ok: true };
    }
    m = /^\/api\/networks\/[^/]+\/nodes\/([^/]+)\/agent-team$/.exec(p);
    if (m) { window.__teamCalls.push({ method, path: p, body: b }); const id = decodeURIComponent(m[1]); if (b.team_id) store.of[id] = b.team_id; else delete store.of[id]; return { ok: true, node_id: id, team_id: b.team_id }; }
    return undefined;
  };
};

const tid = (id) => `[data-testid="${id}"]`;
let failures = 0, rows = 0;
const record = (where, what, checks, extra = {}) => {
  const ok = Object.values(checks).every(Boolean);
  rows++; if (!ok) failures++;
  console.log(JSON.stringify({ where, what, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-', ...extra }));
};
const r1 = (v) => Math.round(v * 10) / 10;
const calls = (page) => page.evaluate(() => window.__teamCalls.slice());
const lang = () => { try { localStorage.setItem('anet.language.v1', 'zh'); } catch {} };

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || findChromium() });

async function desktop(theme, opts, body) {
  const where = `desktop/${theme}/${opts.oldHub ? 'old-hub' : opts.role}`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme, deviceScaleFactor: 1, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const errors = [];
  const scripts = [[initScript, { theme }], [fixture, opts], [lang, undefined]];
  for (const [fn, arg] of scripts) await page.addInitScript(fn, arg);
  const step = async (what, fn) => { try { await fn(); } catch (e) { record(where, what, { ran: false }, { error: String(e).split('\n')[0] }); } };
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  let win = null;
  await step('open', async () => {
    await page.locator(tid('desktop-rail')).waitFor({ timeout: 20000 });
    await page.getByRole('tab', { name: '设置', exact: true }).click();
    win = await openStubWindow(page, 'settings', scripts);
    if (!win) throw new Error('settings window did not open');
    win.on('pageerror', e => errors.push(String(e).split('\n')[0]));
    await win.setViewportSize({ width: 1440, height: 900 });
    await win.getByRole('button', { name: '设置分类 用户管理' }).click({ timeout: 20000 });
    await win.locator(tid('team-group')).scrollIntoViewIfNeeded({ timeout: 10000 });
    await win.waitForTimeout(400);
  });
  if (win) await body({ where, win, step });
  record(where, 'page errors', { none: errors.length === 0 }, errors.length ? { errors: errors.slice(0, 3) } : {});
  await ctx.close();
}

for (const theme of ['light', 'dark']) {
  await desktop(theme, { role: 'owner' }, async ({ where, win, step }) => {
    await step('layout', async () => {
      const cards = await win.evaluate(() => [...document.querySelectorAll('[data-testid="settings-kit-card"]')].map(e => { const r = e.getBoundingClientRect(); return { x: r.x, r: r.right, team: !!e.querySelector('[data-testid="team-desktop"]'), org: !!e.querySelector('[data-testid="org-desktop"]') }; }));
      const team = cards.find(c => c.team), org = cards.find(c => c.org);
      const order = await win.evaluate(() => { const a = document.querySelector('[data-testid="org-desktop"]'), b = document.querySelector('[data-testid="team-desktop"]'); return !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); });
      await win.locator(tid('team-tree-t_plat')).click();
      await win.waitForTimeout(300);
      const tree = await win.locator(tid('team-tree')).boundingBox(), detail = await win.locator(tid('team-detail')).boundingBox();
      const treeIds = await win.evaluate(() => [...document.querySelectorAll('[data-testid^="team-tree-"]')].map(e => e.dataset.testid).filter(x => x !== 'team-tree'));
      const name = (await win.locator(tid('team-detail-name')).innerText()).trim();
      const agentBoxes = await win.evaluate(() => [...document.querySelectorAll('[data-testid^="team-agent-"]')].map(e => { const r = e.getBoundingClientRect(); const av = e.firstElementChild.getBoundingClientRect(); return { x: r.x, r: r.right, av: av.x, avMid: av.y + av.height / 2, mid: r.y + r.height / 2 }; }));
      const lead = await win.locator(`${tid('team-agent-n1')} ${tid('team-lead-badge')}`).count();
      const heads = (await win.locator(tid('team-heads')).innerText()).replace(/\s+/g, ' ');
      if (OUT) await win.screenshot({ path: `${OUT}/desktop-${theme}-teams.png` });
      record(where, 'card under 组织架构, left tree + right detail, aligned', {
        afterOrg: order, cardEdges: !!team && !!org && Math.abs(team.x - org.x) <= 0.5 && Math.abs(team.r - org.r) <= 0.5,
        sideBySide: !!tree && !!detail && tree.x + tree.width <= detail.x + 1 && Math.abs(tree.y - detail.y) <= 1,
        tree: treeIds.join() === 'team-tree-t_plat,team-tree-t_api,team-tree-t_ops,team-tree-__none',
        detail: name === '平台' && agentBoxes.length === 2 && lead === 1 && heads.includes('示例负责人') && heads.includes('示例节点1'),
        avatarsAligned: agentBoxes.length === 2 && Math.abs(agentBoxes[0].av - agentBoxes[1].av) <= 0.5 && agentBoxes.every(b => Math.abs(b.avMid - b.mid) <= 1),
      }, { cards: team && org && `${r1(team.x)}..${r1(team.r)} vs ${r1(org.x)}..${r1(org.r)}`, tree: tree && detail && `${r1(tree.y)}/${r1(detail.y)}`, avatars: agentBoxes.map(b => `${r1(b.av)}@${r1(b.avMid - b.mid)}`).join(' ') });
    });
    await step('create', async () => {
      await win.locator(tid('team-new-child')).click();
      await win.locator(tid('team-name-input')).fill('示例子团队');
      await win.locator(tid('team-name-done')).click();
      await win.waitForTimeout(500);
      const post = (await calls(win)).find(x => x.method === 'POST');
      record(where, 'new sub-team (dialog → POST)', { body: !!post && JSON.stringify(post.body) === '{"name":"示例子团队","parent_id":"t_plat"}', closed: (await win.locator(tid('team-dialog')).count()) === 0, inTree: (await win.locator(tid('team-tree-t_3')).count()) === 1 }, { body: post && JSON.stringify(post.body) });
    });
    await step('assign', async () => {
      await win.locator(tid('team-add-agent')).click();
      const choices = await win.evaluate(() => [...document.querySelectorAll('[data-testid^="team-add-n"]')].map(e => e.dataset.testid).join());
      await win.locator(tid('team-add-n4')).click();
      await win.waitForTimeout(400);
      let put = (await calls(win)).filter(x => x.method === 'PUT').pop();
      const added = put && put.path.endsWith('/nodes/n4/agent-team') && JSON.stringify(put.body) === '{"team_id":"t_plat"}';
      await win.locator(tid('team-remove-n2')).click();
      await win.waitForTimeout(400);
      put = (await calls(win)).filter(x => x.method === 'PUT').pop();
      record(where, 'add + remove an agent', { choices: choices === 'team-add-n3,team-add-n4', added, removed: !!put && put.path.endsWith('/nodes/n2/agent-team') && JSON.stringify(put.body) === '{"team_id":null}', gone: (await win.locator(tid('team-agent-n2')).count()) === 0 }, { choices });
    });
    await step('delete', async () => {
      const blocked = await win.locator(tid('team-delete')).getAttribute('aria-disabled');
      await win.locator(tid('team-tree-t_ops')).click();
      await win.locator(tid('team-delete')).click();
      await win.locator(tid('team-delete-confirm')).waitFor({ timeout: 3000 });
      if (OUT) await win.screenshot({ path: `${OUT}/desktop-${theme}-delete-confirm.png` });
      const before = (await calls(win)).filter(x => x.method === 'DELETE').length;
      await win.locator(tid('team-delete-confirm')).click();
      await win.waitForTimeout(400);
      const del = (await calls(win)).filter(x => x.method === 'DELETE');
      record(where, 'delete: blocked with children; leaf asks first', { blocked: blocked === 'true', confirmFirst: before === 0, sent: del.length === 1 && del[0].path.endsWith('/agent-teams/t_ops'), gone: (await win.locator(tid('team-tree-t_ops')).count()) === 0 });
    });
  });
  await desktop(theme, { role: 'owner', oldHub: true }, async ({ where, win, step }) => {
    await step('old-hub', async () => {
      const text = (await win.locator(tid('team-group')).innerText()).replace(/\s+/g, ' ');
      record(where, 'old Hub: one version line, nothing else', { note: (await win.locator(tid('team-old-hub')).count()) === 1 && text.includes('需要 Hub ≥ 0.9.0-preview.116'), noPanel: (await win.locator(tid('team-desktop')).count()) === 0 }, { text });
    });
  });
}

// ── phone ──
for (const theme of ['light', 'dark']) {
  const where = `phone/${theme}`;
  const V = { w: 390, h: 844 };
  const ctx = await browser.newContext({ viewport: { width: V.w, height: V.h }, userAgent: ANDROID_UA, hasTouch: true, colorScheme: theme, deviceScaleFactor: 2, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
  const step = async (what, fn) => { try { await fn(); } catch (e) { record(where, what, { ran: false }, { error: String(e).split('\n')[0] }); if (OUT) await page.screenshot({ path: `${OUT}/phone-${theme}-FAIL-${what}.png` }); } };
  await page.addInitScript(initScript, { theme });
  await page.addInitScript(fixture, { role: 'owner' });
  await page.addInitScript(lang);
  await page.goto(`${web.url}?safeAreaSim=32,0,24,0`);
  await step('drill', async () => {
    await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'settings' }));
    await page.locator(tid('settings-row-users')).click({ timeout: 10000 });
    await page.locator(tid('team-open')).tap({ timeout: 10000 });
    await page.locator(tid('team-phone')).waitFor({ timeout: 5000 });
    await page.waitForTimeout(300);
    const rootRows = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="team-row-"]')].map(e => e.dataset.testid).join());
    const rootTitle = (await page.locator(tid('team-phone-title')).innerText()).trim();
    if (OUT) await page.screenshot({ path: `${OUT}/phone-${theme}-1-root.png` });
    await page.locator(tid('team-row-t_plat')).tap();
    await page.waitForTimeout(300);
    const title = (await page.locator(tid('team-phone-title')).innerText()).trim();
    const sub = await page.locator(tid('team-row-t_api')).count();
    const agents = await page.locator('[data-testid^="team-agent-"]').count();
    const bar = await page.locator(tid('team-phone-action')).boundingBox();
    const rowBoxes = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="team-row-"],[data-testid^="team-agent-"]')].map(e => { const r = e.getBoundingClientRect(); return [r.x, r.right]; }));
    if (OUT) await page.screenshot({ path: `${OUT}/phone-${theme}-2-team.png` });
    record(where, 'list drill-down: root → team', {
      root: rootTitle === 'Agent 组织' && rootRows === 'team-row-t_plat,team-row-t_ops,team-row-none', title: title === '平台', sub: sub === 1, agents: agents === 2,
      barAtBottom: !!bar && Math.abs(bar.y + bar.height - V.h) <= 1 && Math.abs(bar.height - 52 - 24) <= 1 && Math.abs(bar.width - V.w) <= 0.5,
      rowsFullWidth: rowBoxes.length === 3 && rowBoxes.every(([x, r]) => Math.abs(x) <= 0.5 && Math.abs(r - V.w) <= 0.5),
    }, { rootRows, bar: bar && `${r1(bar.y)}+${r1(bar.height)}`, rows: rowBoxes.map(([x, r]) => `${r1(x)}..${r1(r)}`).join(' ') });
  });
  await step('sheet', async () => {
    await page.locator(tid('team-agent-n2')).tap();
    await page.locator(tid('team-sheet')).waitFor({ timeout: 3000 });
    const items = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="team-sheet-"]')].map(e => e.dataset.testid).filter(x => !['team-sheet-scrim', 'team-sheet-cancel'].includes(x)).join());
    if (OUT) await page.screenshot({ path: `${OUT}/phone-${theme}-3-sheet.png` });
    await page.locator(tid('team-sheet-remove')).tap();
    await page.waitForTimeout(500);
    const put = (await calls(page)).filter(x => x.method === 'PUT').pop();
    const title = (await page.locator(tid('team-phone-title')).innerText()).trim();
    record(where, 'agent bottom sheet → remove', { items: items === 'team-sheet-lead,team-sheet-assign,team-sheet-remove', body: !!put && put.path.endsWith('/nodes/n2/agent-team') && JSON.stringify(put.body) === '{"team_id":null}', stayed: title === '平台', gone: (await page.locator(tid('team-agent-n2')).count()) === 0 }, { items });
  });
  record(where, 'page errors', { none: errors.length === 0 }, errors.length ? { errors: errors.slice(0, 3) } : {});
  await ctx.close();
}
// Real settings navigation, no Hub or privileged member API for non-admins.
for (const phone of [false, true]) for (const role of ['member', 'viewer', 'teamOwner']) {
  const where = `${phone ? 'phone' : 'desktop'} independent ${role}`;
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1200, height: 800 }, ...(phone ? { userAgent: ANDROID_UA, hasTouch: true } : {}), locale: 'zh-CN' });
  const page = await ctx.newPage();
  const scripts = [[initScript, { theme: 'light' }], [fixture, { role: role === 'viewer' ? 'viewer' : 'member', teamOwner: role === 'teamOwner' }], [lang, undefined]];
  for (const [fn, arg] of scripts) await page.addInitScript(fn, arg);
  try {
    await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
    let screen = page;
    if (phone) {
      await page.waitForFunction(() => !!window.__anetLayoutSweep);
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'settings' }));
      record(where, 'no admin entry', { hidden: await page.locator(tid('settings-row-users')).count() === 0 });
      await page.locator(tid('settings-row-agentTeams')).tap();
      await page.locator(tid('agent-org-page')).waitFor({ timeout: 10000 });
    } else {
      await page.getByRole('tab', { name: '设置', exact: true }).click();
      screen = await openStubWindow(page, 'settings', scripts);
      if (!screen) throw Error('settings window missing');
      await screen.setViewportSize({ width: 1200, height: 800 });
      record(where, 'no admin entry', { hidden: await screen.getByRole('button', { name: '设置分类 用户管理', exact: true }).count() === 0 });
      await screen.getByRole('button', { name: '设置分类 Agent 组织架构', exact: true }).click();
      await screen.locator(tid('agent-org-page')).waitFor({ timeout: 10000 });
    }
    const bannerCount = await screen.locator(tid('agent-org-demo-banner')).count();
    record(where, 'org page opens and does not write', {
      page: await screen.locator(tid('agent-org-page')).count() === 1,
      noDemoBanner: bannerCount === 0,
      noTeamEditor: (await screen.locator(tid('team-open')).count()) === 0 && (await screen.locator(tid('team-desktop')).count()) === 0,
      noAdminReads: await screen.evaluate(() => window.__memberReads === 0),
      noWritesOnOpen: (await calls(screen)).length === 0,
    }, { bannerCount });
    const layout = await screen.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
    record(where, 'org page stays in the viewport', { noOverflow: !layout.overflow }, { measured: layout });
    if (OUT) await screen.screenshot({ path: `${OUT}/${phone ? 'phone-390x844' : 'desktop-1200x800'}-${role}.png` });
  } catch (error) { record(where, 'entry flow', { ran: false }, { error: String(error).split('\n')[0] }); }
  await ctx.close();
}
await browser.close();
web.close();
console.log(failures ? `\n${failures}/${rows} rows failed` : `\nall ${rows} rows passed`);
process.exit(failures || rows === 0 ? 1 : 0);
