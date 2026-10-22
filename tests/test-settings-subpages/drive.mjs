// 手机「设置」子页(Vincent 2026-09-27「设置界面有点体验太差」)—— 真应用(expo web 导出 + Tauri 桥桩)里
// 逐页截图、量真框。不进 CI:要 Playwright + Chromium。Hub 数据是 tests/test-layout-sweep/harness.mjs 的页内
// 假数据,另外在这里桩了两个账号(其中一个是本地工作区,好让「本地 Hub」页出现)、本地 Hub 状态
// (占位端口 19299,不是生产 9200)和语音凭据(假 key,尾号 abcd)。不起 hub、不占端口、不碰 HOME。
//
//   WEB_DIR=<expo export 目录> [OUT=<截图目录>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] \
//   node tests/test-settings-subpages/drive.mjs
//
// 390×844 安卓 UA、模拟安全区 32/24,浅色 + 深色,每个子页(含三级页)截图并断言:
//   gutter   每张卡片左右边距 16±1
//   labels   同一页所有行的标签左边缘相等 ±1
//   accessory 同一页所有 › / ✓ 右边缘相等 ±1(开关的右边缘单列,不参与)
//   height   每行 ≥ 48
//   tabs     子页 / 三级页上没有底部 tab 栏;列表页上有
// 另:通知子页再用 ?fixture=notify-settings&platform=android 按安卓渲染一遍(后台保持连接等安卓专属行)。
// 1200×800 桌面(非安卓 UA):点「设置」要开出设置窗口(960×720),逐个分类截图,供与改动前的导出逐像素比对(DESKTOP_BASELINE=<旧截图目录>)。
// 任何一页没打开 = FAIL(不是 skip)。
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA, paintedText, openStubWindow, TEST_LOCALE } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });
const DESKTOP_ONLY = process.env.DESKTOP_ONLY === '1';

let pass = 0; const failures = [];
const ck = (name, ok, extra = '') => { if (ok) pass++; else failures.push(name); console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`); };

// 在 harness 的桩外面再包一层:账号表、本地 Hub、语音凭据。全是占位值。
const extraStub = () => {
  const inner = window.__TAURI_INTERNALS__;
  if (!inner) return;
  const invoke = inner.invoke;
  const profiles = {
    schema_version: 1,
    active_profile_id: 'p-sweep',
    profiles: [
      { profileId: 'p-sweep', serverUrl: 'http://mock-hub.invalid', username: 'tester', displayName: 'tester', networkId: 'net-sweep', createdAt: 0, updatedAt: 0 },
      { profileId: 'local-workspace', serverUrl: 'http://127.0.0.1:19299', username: 'local', displayName: '本地工作区', createdAt: 0, updatedAt: 0 },
    ],
  };
  const hub = { state: 'running', endpoint: 'http://127.0.0.1:19299', port: 19299, hubVersion: '0.0.0-fixture', logsPath: '/data/logs', requiresMigration: false, expectedHubVersion: '0.0.0-fixture' };
  inner.invoke = async (cmd, args) => {
    switch (cmd) {
      case 'list_desktop_profiles': return JSON.stringify(profiles);
      case 'desktop_storage_diagnostics': return JSON.stringify({ root: '/data/app', profile_count: 2, corrupt_backups: [] });
      case 'local_hub_status': return JSON.stringify(hub);
      case 'load_voice_credentials': return window.__voiceCreds === null ? null : JSON.stringify({ accessToken: 'fake-key-abcd' });
      case 'save_voice_credentials': window.__voiceCreds = args?.json ?? null; return null;
      case 'clear_voice_credentials': window.__voiceCreds = null; return null;
      default: return invoke(cmd, args);
    }
  };
  // #2051: the org page must measure at least one **named** department row. Without an answer for these
  // two endpoints the harness catch-all returns { ok: true }, the tree only renders the synthetic
  // `agent-org-dept-unassigned` row, and a page whose real department rows are all broken still passes.
  // Fixtures are representative names/ids (no production data); the drive-only route override keeps
  // other layout drives on the old generic stub.
  const orgDepartments = [
    { id: 'dept-eng', name: 'Engineering', parent_id: null, leader_user_id: null, sort: 0, member_count: 1 },
    { id: 'dept-design', name: 'Design', parent_id: null, leader_user_id: null, sort: 1, member_count: 1 },
  ];
  window.__routeOverride = (u, bodyText, method) => {
    const p = u.pathname;
    if ((method || 'GET') === 'GET' && /^\/api\/networks\/[^/]+\/departments$/.test(p)) {
      return {
        ok: true,
        departments: orgDepartments,
        members: [
          { user_id: 'u-eng-1', department_id: 'dept-eng' },
          { user_id: 'u-des-1', department_id: 'dept-design' },
        ],
      };
    }
    if (p === '/api/requirements/people/directory') {
      return {
        ok: true, has_more: false, next_offset: null, agent_department_supported: true,
        people: [
          { user_id: 'u-eng-1', username: 'eng_lead', display_name: 'Eng Lead', department: { id: 'dept-eng', name: 'Engineering' }, agents: [{ node_id: 'n_eng_1', alias: 'eng-agent', department_id: 'dept-eng' }] },
          { user_id: 'u-des-1', username: 'design_lead', display_name: 'Design Lead', department: { id: 'dept-design', name: 'Design' }, agents: [{ node_id: 'n_des_1', alias: 'design-agent', department_id: 'dept-design' }] },
        ],
        agents_without_owner: [],
      };
    }
    return undefined;
  };
};

// 在页内量:每张卡片的左右边距、每行的标签左边缘 / 高度 / › ✓ 右边缘 / 开关右边缘。
const measure = () => {
  const W = window.innerWidth;
  const r = (el) => el.getBoundingClientRect();
  const visible = (el) => { const b = r(el); return b.width > 0 && b.height > 0; };
  const cards = [...document.querySelectorAll('[data-testid="settings-kit-card"]')].filter(visible).map(c => {
    const b = r(c);
    const rows = [];
    for (const label of c.querySelectorAll('[data-testid$="-label"]')) {
      const id = label.getAttribute('data-testid').slice(0, -'-label'.length);
      const row = [...c.querySelectorAll(`[data-testid="${id}"]`)].find(el => el.contains(label));
      if (!row || !visible(row)) continue;
      const acc = row.querySelector(`[data-testid="${id}-accessory"]`);
      const sw = row.querySelector('[role="switch"]') || row.querySelector('input[type="checkbox"]')?.parentElement;
      rows.push({ id, text: label.textContent.slice(0, 18), labelX: r(label).left, h: r(row).height, accRight: acc ? r(acc).right : null, switchRight: sw ? r(sw).right : null });
    }
    // 没有标签的输入框行(API Key):标签左边缘 = 输入框左边缘。
    for (const row of c.querySelectorAll('[data-testid$="-row"]')) {
      const id = row.getAttribute('data-testid');
      const input = row.querySelector('input');
      if (!input || row.querySelector(`[data-testid="${id}-label"]`) || !visible(row)) continue;
      rows.push({ id, text: '(input)', labelX: r(input).left, h: r(row).height, accRight: null, switchRight: null });
    }
    return { left: b.left, right: W - b.right, rows };
  });
  const tabBar = document.querySelector('[data-testid="mobile-tab-bar"]');
  return { cards, tabBar: !!tabBar && visible(tabBar), title: document.querySelector('[data-testid="settings-subpage-title"]')?.textContent ?? null };
};

// 标题要真画出来:textContent 对但被裁成 0 宽(title-blank)的那种也要红。返回 [ok, extra] 给 ck。
const TITLE = '[data-testid="settings-subpage-title"]';
const fmtPaint = (p) => p ? `painted ${p.painted} ${p.w.toFixed(1)}×${p.h.toFixed(1)}` : 'painted null';
const titleIs = async (page, want) => {
  const text = await page.locator(TITLE).innerText(); const p = await paintedText(page, TITLE, want);
  return [text === want && !!p?.painted && p.w >= 8, `${text} · ${fmtPaint(p)}`];
};

const table = [];
// b78a5d60 把「成员/团队」子页从 settings-kit 卡片改成自定义树（AgentOrgScreen）：
// 该页不再产出 settings-kit-card，但自己的行契约还在（departmentRow 的 minHeight 44）。
// 所以按结构分流：有卡片的页量卡片；agent-org-tree 量树行。两种都仍然要求
// 「有内容 + 行高够 + 每行有可读标签」，不是删断言、也不是放宽到「有节点就行」。
const TREE = '[data-testid="agent-org-tree"]';
const TREE_ROW = '[data-testid^="agent-org-dept-"][role="button"]';
const measureTree = () => {
  const visible = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  // #2051: textContent alone passes zero-width/clipped labels. Mirror harness `paintedText`: intersect the
  // label box with every overflow-hidden ancestor, and require the painted box to be ≥ 1×1.
  const painted = (el) => {
    const b = el.getBoundingClientRect();
    let w = b.width, h = b.height;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const r = a.getBoundingClientRect();
      w = Math.min(w, Math.max(0, Math.min(b.right, r.right) - Math.max(b.left, r.left)));
      h = Math.min(h, Math.max(0, Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top)));
    }
    return w >= 1 && h >= 1;
  };
  const rows = [...document.querySelectorAll('[data-testid^="agent-org-dept-"][role="button"]')]
    .filter(visible)
    .map(el => {
      const label = el.querySelector('[data-testid$="-label"]');
      return { id: el.getAttribute('data-testid'), h: el.getBoundingClientRect().height, text: (label?.textContent || '').trim(), painted: label ? painted(label) : false };
    });
  const tabBar = document.querySelector('[data-testid="mobile-tab-bar"]');
  return { rows, tabBar: !!tabBar && visible(tabBar) };
};

// 这一页是已知的「非卡片」布局（b78a5d60 之后）。按页名直接走树分支，并显式等树出现：
// 之前用「先看树在不在」判分流，浅色通过、深色仍会因树晚一拍落到卡片分支量出 0。
// 若树在 8 s 内没出现，下面的「至少一行」会红——那是真实问题（该页没渲染），不是被等待掩盖。
const TREE_PAGES = new Set(['agentTeams']);

const checkPage = async (page, name, theme) => {
  if (TREE_PAGES.has(name) || await page.locator(TREE).count()) {
    await page.locator(TREE_ROW).first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(150);
    if (OUT) await page.screenshot({ path: `${OUT}/phone-${name}-${theme}.png`, fullPage: true });
    const m = await page.evaluate(measureTree);
    const minH = m.rows.length ? Math.min(...m.rows.map(r => r.h)) : 0;
    const blank = m.rows.filter(r => !r.text || !r.painted).map(r => r.id);
    const named = m.rows.filter(r => r.id !== 'agent-org-dept-unassigned' && r.text && r.painted);
    table.push({ page: name, theme, layout: 'agent-org-tree', rows: m.rows.length, minRowH: minH, tabBar: m.tabBar });
    ck(`${theme} ${name}: 至少有部门/成员行`, m.rows.length > 0, String(m.rows.length));
    ck(`${theme} ${name}: 行高 ≥ 44(该页 departmentRow minHeight)`, m.rows.length > 0 && minH >= 44 - 0.5, `${minH.toFixed(1)} over ${m.rows.length}`);
    ck(`${theme} ${name}: 每行都有可读标签`, blank.length === 0, blank.join(',') || 'all labelled');
    ck(`${theme} ${name}: 至少一行命名真实部门`, named.length > 0, named.map(r => r.text).join(',') || 'only unassigned');
    ck(`${theme} ${name}: 没有底部 tab 栏`, !m.tabBar);
    return m;
  }
  await page.waitForTimeout(500);
  if (OUT) await page.screenshot({ path: `${OUT}/phone-${name}-${theme}.png`, fullPage: true });
  const m = await page.evaluate(measure);
  const rows = m.cards.flatMap(c => c.rows);
  const gutters = m.cards.map(c => [c.left, c.right]);
  const badGutter = gutters.filter(([l, rr]) => Math.abs(l - 16) > 1 || Math.abs(rr - 16) > 1);
  const xs = rows.map(x => x.labelX);
  const accs = rows.map(x => x.accRight).filter(x => x !== null);
  const sws = rows.map(x => x.switchRight).filter(x => x !== null);
  const minH = rows.length ? Math.min(...rows.map(x => x.h)) : 0;
  const span = (a) => a.length ? Math.max(...a) - Math.min(...a) : 0;
  table.push({ page: name, theme, title: m.title, cards: m.cards.length, rows: rows.length, gutterL: gutters.map(g => g[0]), gutterR: gutters.map(g => g[1]), labelX: xs.length ? [Math.min(...xs), Math.max(...xs)] : [], accRight: accs.length ? [Math.min(...accs), Math.max(...accs)] : [], switchRight: sws.length ? [Math.min(...sws), Math.max(...sws)] : [], minRowH: minH, tabBar: m.tabBar });
  ck(`${theme} ${name}: 至少一张卡片`, m.cards.length > 0, String(m.cards.length));
  ck(`${theme} ${name}: 卡片左右边距 16±1`, badGutter.length === 0, JSON.stringify(gutters.map(g => g.map(v => +v.toFixed(1)))));
  ck(`${theme} ${name}: 标签左边缘相等 ±1`, span(xs) <= 1, xs.length ? `${Math.min(...xs).toFixed(1)}..${Math.max(...xs).toFixed(1)}` : 'no rows');
  ck(`${theme} ${name}: › / ✓ 右边缘相等 ±1`, span(accs) <= 1, accs.length ? `${Math.min(...accs).toFixed(1)}..${Math.max(...accs).toFixed(1)} (${accs.length})` : 'none');
  // 快捷键页(只在窄的桌面窗口出现)沿用宽屏那段自绘行,放在一张卡片里:只量卡片边距。
  if (name === 'shortcuts') console.log(`INFO: ${theme} shortcuts: 卡片内是 ShortcutsSettings 自绘行(${rows.length} 个 kit 行),行级断言不适用`);
  else ck(`${theme} ${name}: 行高 ≥ 48`, rows.length > 0 && minH >= 48 - 0.5, `${minH.toFixed(1)} over ${rows.length}`);
  ck(`${theme} ${name}: 没有底部 tab 栏`, !m.tabBar);
  return m;
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ executablePath: findChromium() });

if (!DESKTOP_ONLY) for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: ANDROID_UA, colorScheme: theme, deviceScaleFactor: 1, locale: TEST_LOCALE });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
  await page.addInitScript(initScript, { theme });
  await page.addInitScript(extraStub);
  await page.goto(`${web.url}?safeAreaSim=32,0,24,0`);
  await page.getByText('示例-A', { exact: true }).first().waitFor({ timeout: 20000 });
  await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'settings' }));
  await page.locator('[data-testid="settings-phone-list"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  if (OUT) await page.screenshot({ path: `${OUT}/phone-list-${theme}.png` });
  ck(`${theme} list: 列表页有底部 tab 栏`, await page.locator('[data-testid="mobile-tab-bar"]').isVisible());
  table.push({ page: 'list', theme, tabBar: await page.locator('[data-testid="mobile-tab-bar"]').isVisible() });

  const open = async (key) => {
    await page.locator(`[data-testid="settings-row-${key}"]`).click();
    await page.locator(`[data-testid="settings-subpage-${key}"]`).waitFor({ timeout: 8000 });
  };
  const back = async () => { await page.locator('[data-testid="settings-back"]').click(); await page.waitForTimeout(250); };
  const run = async (name, fn) => {
    try { await fn(); } catch (e) { ck(`${theme} ${name}: 打开`, false, String(e.message || e).split('\n')[0]); }
  };

  const keys = await page.locator('[data-testid^="settings-row-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')).filter(id => !/-(label|chevron)-/.test(id) && !/-(label|value|accessory|lead)$/.test(id)).map(id => id.replace('settings-row-', '')));
  ck(`${theme} list: 子页清单`, keys.length >= 6, keys.join(','));
  for (const key of keys) {
    // 服务器 is not a settings subpage: on the phone its row opens the full 服务器 page (#501), whose ‹ goes back to 设置.
    if (key === 'server') {
      await run(key, async () => {
        await page.locator('[data-testid="settings-row-server"]').click();
        await page.locator('[data-testid="server-header"]').waitFor({ timeout: 8000 });
        const title = await paintedText(page, '[data-testid="server-header"] *', 'Hub');
        ck(`${theme} server: 打开 Hub 页`, !!title?.painted && title.w >= 8, fmtPaint(title));
        await page.locator('[data-testid="server-header"] [aria-label="返回设置"]').click();
        await page.locator('[data-testid="settings-phone-list"]').waitFor({ timeout: 5000 });
        ck(`${theme} server: ‹ 回到设置`, true);
      });
      continue;
    }
    await run(key, async () => {
      await open(key);
      await checkPage(page, key, theme);
      // 账号:「管理账号」三级页已收进每行的 ⋯(#427,tests/test-settings-redesign/drive.mjs 量那一页)。
      if (key === 'notifications') {
        const quiet = page.getByRole('switch', { name: '免打扰时段' });
        if (!(await quiet.isChecked())) await quiet.click();
        await page.locator('[data-testid="notify-quiet-hours"]').click();
        await page.locator('[data-testid="notify-quiet-start"]').waitFor({ timeout: 5000 });
        await checkPage(page, 'notifications-quiet', theme);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
        ck(`${theme} notifications: Esc 先退三级页`, ...(await titleIs(page, '通知')));
      }
      if (key === 'voice') {
        const value = (await page.locator('[data-testid="voice-api-key-row-value"]').innerText()).trim();
        const vp = await paintedText(page, '[data-testid="voice-api-key-row-value"]');
        ck(`${theme} voice: API Key 行值 = 已配置 …abcd`, value === '已配置 …abcd' && !!vp?.painted && vp.w >= 8, `${value} · ${fmtPaint(vp)}`);
        ck(`${theme} voice: 页面上没有输入框`, (await page.locator('[data-testid="settings-subpage-voice"] input').count()) === 0);
        await page.locator('[data-testid="voice-api-key-row"]').click();
        await page.locator('[data-testid="voice-api-key"]').waitFor({ timeout: 5000 });
        ck(`${theme} voice→API Key: 标题`, ...(await titleIs(page, 'API Key')));
        ck(`${theme} voice→API Key: 密钥栏是密码框、不回显`, (await page.locator('[data-testid="voice-api-key"]').getAttribute('type')) === 'password' && (await page.locator('[data-testid="voice-api-key"]').inputValue()) === '');
        await checkPage(page, 'voice-apikey', theme);
        const save = await page.locator('[data-testid="voice-save"]').boundingBox();
        const clear = await page.locator('[data-testid="voice-clear"]').boundingBox();
        ck(`${theme} voice→API Key: 保存 / 清除 整宽(左右 16±1)`, [save, clear].every(b => b && Math.abs(b.x - 16) <= 1 && Math.abs(390 - b.x - b.width - 16) <= 1), JSON.stringify([save, clear].map(b => b && [+b.x.toFixed(1), +(390 - b.x - b.width).toFixed(1), +b.height.toFixed(1)])));
        await back();
        await page.locator('[data-testid="voice-advanced-toggle"]').click();
        await page.locator('[data-testid="voice-advanced"]').waitFor({ timeout: 5000 });
        await page.locator('[data-testid="voice-console-old"]').click();
        await page.locator('[data-testid="voice-app-id"]').waitFor({ timeout: 5000 });
        await checkPage(page, 'voice-advanced', theme);
        await page.locator('[data-testid="voice-console-new"]').click();
        await back();
      }
      await back();
      await page.locator('[data-testid="settings-phone-list"]').waitFor({ timeout: 5000 });
    });
  }
  ck(`${theme}: 没有页面错误`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();

  // 安卓专属的通知行(后台保持连接 / 勿扰 / 小米指引 / 测试通知):web 里只能经通知设置夹具按安卓渲染。
  const fctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: ANDROID_UA, colorScheme: theme, deviceScaleFactor: 1, locale: TEST_LOCALE });
  const fp = await fctx.newPage();
  await fp.goto(`${web.url}?fixture=notify-settings&platform=android&theme=${theme}`);
  try {
    await fp.locator('[data-testid="settings-subpage-notifications"]').waitFor({ timeout: 20000 });
    await checkPage(fp, 'notifications-android', theme);
    ck(`${theme} notifications-android: 安卓行都在`, (await fp.locator('[data-testid="notify-keepalive-row"]').count()) === 1 && (await fp.locator('[data-testid="notify-xiaomi-guide"]').count()) === 1 && (await fp.locator('[data-testid="notify-mode-all"]').count()) === 1);
  } catch (e) { ck(`${theme} notifications-android: 打开`, false, String(e.message || e).split('\n')[0]); }
  await fctx.close();
}

// ── 桌面 1200×800:只截图(与改动前逐像素比对)──────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, colorScheme: 'light', deviceScaleFactor: 1, locale: TEST_LOCALE });
  const page = await ctx.newPage();
  await page.addInitScript(initScript, { theme: 'light' });
  await page.addInitScript(extraStub);
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.locator('[data-testid="desktop-rail"]').waitFor({ timeout: 20000 });
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  // 桌面的设置是单独的窗口(desktop-settings-window.ts):桩记下开窗请求,这里把那个 URL 作为同一 context 的第二页打开。
  const win = await openStubWindow(page, 'settings', [[initScript, { theme: 'light' }], [extraStub]]);
  ck('desktop: 点「设置」开的是设置窗口', !!win);
  if (win) {
    await win.setViewportSize({ width: 960, height: 720 });  // the window's own size (openSettingsWindow)
    await win.locator('[data-testid="dedicated-settings-window"]').waitFor({ timeout: 20000 }).catch(() => {});
    for (const label of ['账号', '本地 Hub', '外观', '通知', '语音输入', '快捷键', '关于']) {
      try {
        await win.getByRole('button', { name: `设置分类 ${label}` }).click();
        await win.waitForTimeout(600);
        if (OUT) await win.screenshot({ path: `${OUT}/desktop-${label}.png` });
      } catch (e) { ck(`desktop ${label}: 打开`, false, String(e.message || e).split('\n')[0]); }
    }
  }
  await ctx.close();
}
await browser.close(); web.close();

const BASE = process.env.DESKTOP_BASELINE;
if (BASE && OUT) {
  const { PNG } = await import('pngjs');
  for (const label of ['账号', '本地 Hub', '外观', '通知', '语音输入', '快捷键', '关于']) {
    const a = `${BASE}/desktop-${label}.png`, b = `${OUT}/desktop-${label}.png`;
    if (!existsSync(a) || !existsSync(b)) { ck(`desktop ${label}: 与改动前逐像素相同`, false, 'missing screenshot'); continue; }
    const pa = PNG.sync.read(readFileSync(a)), pb = PNG.sync.read(readFileSync(b));
    let diff = 0;
    if (pa.width !== pb.width || pa.height !== pb.height) diff = -1;
    else for (let i = 0; i < pa.data.length; i += 4) { if (pa.data[i] !== pb.data[i] || pa.data[i + 1] !== pb.data[i + 1] || pa.data[i + 2] !== pb.data[i + 2]) diff++; }
    ck(`desktop ${label}: 与改动前逐像素相同`, diff === 0, `${diff} px differ`);
  }
}

if (table.length) {
  console.log('\npage                   theme  cards rows  gutterL..       gutterR..       labelX       ›/✓ right     switch right  minRowH tabBar');
  const f = (a) => a && a.length ? (a.length === 2 && typeof a[0] === 'number' && a !== undefined ? `${a[0].toFixed(1)}..${a[1].toFixed(1)}` : '') : '-';
  const g = (a) => a && a.length ? `${Math.min(...a).toFixed(1)}..${Math.max(...a).toFixed(1)}` : '-';
  for (const t of table) console.log(`${t.page.padEnd(22)} ${t.theme.padEnd(6)} ${String(t.cards ?? '-').padStart(5)} ${String(t.rows ?? '-').padStart(4)}  ${g(t.gutterL).padEnd(15)} ${g(t.gutterR).padEnd(15)} ${f(t.labelX).padEnd(12)} ${f(t.accRight).padEnd(13)} ${f(t.switchRight).padEnd(13)} ${t.minRowH != null ? t.minRowH.toFixed(1).padStart(7) : '      -'} ${t.tabBar ? 'yes' : 'no'}`);
}
console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) { console.log('FAILED:\n  ' + failures.join('\n  ')); process.exit(1); }
