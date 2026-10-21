// 任务「仪表盘」视图 —— 在 web 导出里量出来,不靠眼睛。
// Not in CI: needs Playwright + Chromium and a web export. Hub data is placeholder, answered in-page by the
// Tauri stub in tests/test-layout-sweep/harness.mjs (window.__tasksFixture) — no hub process, no port, no HOME.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-task-dashboard/drive.mjs
//
// Two hubs: `hub` (capability stats → GET /api/requirements/stats) and `old` (no stats, no completed_at: the app pages
// through the list + archived and estimates from updatedAt, with the 近似 note). Light + dark.
//   desktop 1440×900 : 四个大数字 painted with the final count-up values; 最近完成 is the first card under them
//                      (full width, 8 rows, each title painted ≥ 40px); 近似 note only on the old hub;
//                      clicking an archived row opens its detail (GET /api/requirements/<id>); no horizontal scroll;
//                      hub: a completion added to the hub slides into the top of the timeline on the next poll.
//   share            : the export is a real PNG — signature + IHDR 1080×1920, then 4:5 = 1080×1350; an unticked task
//                      is left out of the model the card is drawn from (checked through the preview re-render).
//   phone 390×844    : the 仪表盘 tab is reachable, 今天完成 hero painted, 最近完成 directly under it with 5 rows and
//                      展开 → more rows, no horizontal scroll.
// Exit 1 when any check fails or a viewport could not be opened.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serveExport, initScript, findChromium, ANDROID_UA, paintedText } from '../test-layout-sweep/harness.mjs';

// The fixture completes today's tasks up to ~5h ago, so between midnight and ~05:00 local half of them fell on yesterday and 今日 / the bar chart / the hero count failed (2026-10-02 sweep, run at 03:00). A fixed midday clock makes every run the same at any hour.
const FIXED_NOW = new Date('2026-10-15T12:00:00Z'); // 20:00 in UTC+8, 12:00 in UTC (the CI runner) — midday-ish in both

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

// Runs in the page. mode 'hub' | 'old'. Placeholder names only.
const fixture = (mode) => {
  const now = Date.now();
  const H = 3600000, D = 86400000;
  const iso = (ms) => new Date(ms).toISOString();
  const titles = ['示例:登录页改版', '示例:修复构建脚本', '示例:整理发布说明', '示例:补充单元测试', '示例:优化首屏加载', '示例:接入新的通知渠道', '示例:清理过期配置', '示例:文档站目录调整', '示例:看板拖动手感', '示例:导出报表', '示例:统一图标尺寸', '示例:数据库索引'];
  const people = [
    { kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: '示例成员甲' },
    { kind: 'user', id: 'u_two', networkId: 'net-sweep', name: '示例成员乙' },
    { kind: 'node', id: 'n_sweep_a', networkId: 'net-sweep', name: '示例-A' },
    { kind: 'node', id: 'n_sweep_b', networkId: 'net-sweep', name: '示例-B' },
  ];
  const who = [people[2], people[0], people[3], people[2], people[1]];
  const rows = [];
  const archived = [];
  let seq = 1;
  // 近 40 天每天若干完成;今天 9 张(最新的一张 3 分钟前,归档)。
  for (let d = 40; d >= 0; d--) {
    const n = d === 0 ? 9 : (d % 7 === 5 || d % 7 === 6) ? 2 : 3 + (d % 4);
    for (let i = 0; i < n; i++) {
      const doneAt = d === 0 ? now - (i * 37 + 3) * 60000 : now - d * D - i * H;
      const by = who[(d + i) % who.length];
      const r = {
        id: `t${seq}`, seq, name: titles[(seq - 1) % titles.length] + ` ${seq}`, priority: 'normal', assignee: '', column: 'done', due: '',
        owner: { kind: 'user', id: 'u_tester' }, participants: [], agent_owner: by.kind === 'node' ? { kind: 'node', id: by.id } : null,
        project_id: seq % 3 ? 'p_a' : 'p_b', createdAt: iso(doneAt - 2 * D), updatedAt: iso(doneAt), updated_by: { kind: by.kind, id: by.id },
        description: '', checklist: [], tags: [], parent_id: null,
        ...(mode === 'hub' ? { completedAt: iso(doneAt), completedAtApprox: false, completedBy: { kind: by.kind, id: by.id } } : {}),
      };
      seq++;
      if (d === 0 && i === 0) archived.push({ ...r, archived: true }); else rows.push(r);
    }
  }
  for (let i = 0; i < 6; i++) rows.push({ id: `o${i}`, seq: seq++, name: `示例:进行中 ${i}`, priority: 'normal', assignee: '', column: 'doing', due: '', owner: null, participants: [], agent_owner: null, project_id: 'p_a', createdAt: iso(now - i * H), updatedAt: iso(now - i * H), description: '', checklist: [], tags: [], parent_id: null, ...(mode === 'hub' ? { completedAt: null, completedAtApprox: false, completedBy: null } : {}) });
  const caps = ['agent_owner', 'description', 'checklist', 'projects', 'due_datetime', 'priority_lowest', 'start_date', 'tags', 'sub_requirements', 'requirement_seq', 'archived', ...(mode === 'hub' ? ['search', 'paging', 'completed_at', 'stats'] : [])];
  const ymd = (ms) => { const x = new Date(ms); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const stats = (q) => {
    const all = [...window.__tasksFixture.requirements, ...window.__tasksFixture.archived];
    const done = all.filter(r => r.column === 'done').map(r => ({ r, at: Date.parse(r.completedAt) })).sort((a, b) => b.at - a.at);
    const from = q.get('from') ? Date.parse(q.get('from')) : -Infinity;
    const days = Number(q.get('days') || 30);
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const daily = [];
    for (let i = days - 1; i >= 0; i--) { const d0 = new Date(today0); d0.setDate(d0.getDate() - i); const k = ymd(d0.getTime()); daily.push({ date: k, n: done.filter(x => ymd(x.at) === k).length }); }
    const inRange = done.filter(x => x.at >= from);
    const byC = new Map();
    for (const x of inRange) { const k = `${x.r.completedBy.kind}:${x.r.completedBy.id}`; byC.set(k, (byC.get(k) || 0) + 1); }
    const byP = new Map();
    for (const x of inRange) byP.set(x.r.project_id, (byP.get(x.r.project_id) || 0) + 1);
    const created = all.filter(r => Date.parse(r.createdAt) >= from);
    return {
      ok: true, networkId: 'net-sweep',
      totals: { done: inRange.length, done_approx: 0, created: created.length, created_done: created.filter(r => r.column === 'done').length, completion_rate: created.length ? created.filter(r => r.column === 'done').length / created.length : null, doing: all.filter(r => r.column === 'doing' && !r.archived).length, pool: 0 },
      daily,
      by_project: [...byP].map(([project_id, n]) => ({ project_id, n })).sort((a, b) => b.n - a.n),
      by_completer: [...byC].map(([k, n]) => ({ kind: k.split(':')[0], id: k.split(':')[1], n, spark: Array.from({ length: 14 }, (_, i) => (i * 7 + n) % 5) })).sort((a, b) => b.n - a.n),
      unattributed: 0,
      recent: inRange.slice(0, Number(q.get('recent') || 10)).map(x => ({ id: x.r.id, seq: x.r.seq, name: x.r.name, project_id: x.r.project_id, completed_at: x.r.completedAt, completed_at_approx: false, completed_by: x.r.completedBy, archived: !!x.r.archived })),
    };
  };
  window.__tasksFixture = {
    requirements: rows, archived,
    projects: [{ id: 'p_a', name: '示例项目-A', color: '#2563eb', sort: 1, archived: false }, { id: 'p_b', name: '示例项目-B', color: '#d97706', sort: 2, archived: false }],
    people, capabilities: caps,
    ...(mode === 'hub' ? { stats, hasMore: false } : {}),
  };
};

const rows = [];
let failures = 0;
const r1 = (n) => Math.round(n * 10) / 10;
function record(vp, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  const row = { vp, what, ...detail, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-' };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const tid = (id) => `[data-testid="${id}"]`;
const box = (page, sel) => page.evaluate((s) => {
  const el = [...document.querySelectorAll(s)].find(e => e.getClientRects().length);
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom, text: el.textContent };
}, sel);
const count = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter(e => e.getClientRects().length).length, sel);

const { url, close } = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--disable-web-security'] });

async function open(page, phone) {
  await page.goto(phone ? `${url}?safeAreaSim=0,0,0,0` : url);
  if (!phone) await page.locator('[data-testid="desktop-rail"] [aria-label="任务"]').first().click({ timeout: 30000 });
  else { await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 30000 }); await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' })); }
  await page.locator(tid('tasks-view-dashboard')).first().click({ timeout: 20000 });
  await page.locator(tid('task-dashboard')).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500); // count-up 0.9 s
}

for (const theme of ['light', 'dark']) {
  for (const mode of ['hub', 'old']) {
    // ── desktop ──
    const vp = `desktop 1440x900 ${theme} ${mode}`;
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme, deviceScaleFactor: 1, timezoneId: 'Asia/Shanghai', locale: 'zh-CN', acceptDownloads: true });
    const page = await ctx.newPage();
    await page.clock.install({ time: FIXED_NOW });
    page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
    await page.addInitScript(fixture, mode);
    await page.addInitScript(initScript, { theme });
    try { await open(page, false); } catch (e) { record(vp, 'open', { opened: false }, { error: String(e).split('\n')[0] }); await ctx.close(); continue; }
    if (OUT) await page.screenshot({ path: join(OUT, `desktop-${theme}-${mode}.png`) });
    // today's bar is 9 of an axis max of 10: ≈ 90% of the plot height (a percentage height that resolves to 0 is the classic web bug)
    await page.evaluate(() => { const el = document.querySelector('[data-testid="dash-daily"]'); for (let a = el; a; a = a.parentElement) if (a.scrollHeight > a.clientHeight + 10 && getComputedStyle(a).overflowY !== 'visible') { a.scrollTop = a.scrollHeight; break; } });
    await page.waitForTimeout(300);
    const bar = await box(page, tid('dash-bar-today'));
    const plot = await box(page, tid('dash-daily'));
    const heat = await box(page, tid('dash-heat'));
    if (OUT) await page.screenshot({ path: join(OUT, `desktop-scrolled-${theme}-${mode}.png`) });
    // x-axis ticks: each label painted whole (not cut to 「9…」 by its one-bar-wide slot)
    const ticks = await page.evaluate(() => [...document.querySelectorAll('[data-testid="dash-tick"]')].map(e => { const b = e.getBoundingClientRect(); return { t: e.textContent, w: b.width, h: b.height, clipped: e.scrollWidth > e.clientWidth + 0.5 || e.scrollHeight > e.clientHeight + 0.5 }; }));
    record(vp, 'ticks', { five: ticks.length === 5, whole: ticks.every(t => !t.clipped && t.h < 20 && t.w >= 10 && !t.t.includes('…')) }, { ticks: ticks.map(t => `${t.t}:${r1(t.w)}x${r1(t.h)}${t.clipped ? '!' : ''}`).join(' ') });
    record(vp, 'charts', { barPainted: !!bar && !!plot && bar.h > plot.h * 0.6, heatPainted: !!heat && heat.w > 500 && heat.h > 60 }, { bar: bar && r1(bar.h), plot: plot && r1(plot.h), heat: heat && `${r1(heat.w)}x${r1(heat.h)}` });
    await page.evaluate(() => { const el = document.querySelector('[data-testid="dash-daily"]'); for (let a = el; a; a = a.parentElement) if (a.scrollTop > 0) a.scrollTop = 0; });
    await page.waitForTimeout(200);
    const source = await page.evaluate(() => document.querySelector('[data-testid="task-dashboard"]')?.getAttribute('data-dash-source'));
    const today = await paintedText(page, tid('dash-hero-today-value'));
    const week = await paintedText(page, tid('dash-hero-week-value'));
    const heroBox = await box(page, tid('dash-hero-today'));
    const recentBox = await box(page, tid('dash-recent-card'));
    const rateBox = await box(page, tid('dash-hero-rate'));
    const chartBox = await box(page, tid('dash-daily'));
    const recentRows = await count(page, `${tid('dash-recent')} [data-testid^="dash-recent-t"]:not([data-testid="dash-recent-title"])`);
    const firstTitle = await paintedText(page, `${tid('dash-recent')} ${tid('dash-recent-title')}`);
    const approx = await count(page, tid('dash-approx'));
    const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
    const queries = await page.evaluate(() => window.__statsQueries || []);
    record(vp, 'dashboard', {
      source: source === (mode === 'hub' ? 'hub' : 'client'),
      todayPainted: !!today?.painted && today.text === '9',
      weekPainted: !!week?.painted && Number(week.text) > 9,
      recentUnderHeroes: !!heroBox && !!recentBox && !!chartBox && recentBox.y > heroBox.b && recentBox.y - heroBox.b < 40 && recentBox.b < chartBox.y,
      recentFullWidth: !!recentBox && !!heroBox && !!rateBox && Math.abs(recentBox.x - heroBox.x) <= 1 && Math.abs(recentBox.r - rateBox.r) <= 1,
      recentRows: recentRows === 8,
      titlePainted: !!firstTitle?.painted && firstTitle.w >= 40,
      approxOnlyOld: mode === 'old' ? approx === 1 : approx === 0,
      statsAskedWithTz: mode === 'hub' ? queries.some(q => q.includes('tz=Asia%2FShanghai') && q.includes('days=371')) : queries.length === 0,
      noOverflow: overflow <= 0,
    }, { today: today?.text, week: week?.text, recentRows, firstTitle: firstTitle && `${firstTitle.text?.slice(0, 16)} w=${r1(firstTitle.w)}`, gap: heroBox && recentBox && r1(recentBox.y - heroBox.b) });

    // archived row (the latest one, 3 min ago) opens its detail through GET /api/requirements/<id>
    await page.locator(`${tid('dash-recent')} [data-testid^="dash-recent-t"]:not([data-testid="dash-recent-title"])`).first().click();
    await page.waitForTimeout(800);
    const detailName = await page.evaluate(() => document.querySelector('[data-testid="req-edit-name"]')?.value ?? null);
    const expected = await page.evaluate(() => window.__tasksFixture.archived[0].name);
    record(vp, 'open archived row', { detail: detailName === expected }, { detailName });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    // close the detail if Escape didn't
    const closeBtn = page.locator('[data-testid="req-detail-close"]');
    if (await closeBtn.count()) await closeBtn.first().click().catch(() => {});

    if (mode === 'hub') {
      // live: a completion lands on the hub → next poll (15 s) slides it into the top of the timeline
      const newId = await page.evaluate(() => {
        const f = window.__tasksFixture;
        const r = { ...f.requirements[0], id: 'live1', seq: 999, name: '示例:刚刚完成的任务', completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), archived: false };
        f.requirements.push(r);
        return r.id;
      });
      await page.waitForSelector(tid(`dash-recent-${newId}`), { timeout: 25000 }).catch(() => {});
      const top = await page.evaluate(() => document.querySelector('[data-testid="dash-recent"] [data-testid^="dash-recent-"]')?.getAttribute('data-testid'));
      const todayNow = await page.evaluate(() => document.querySelector('[data-testid="dash-hero-today-value"]')?.textContent);
      await page.waitForTimeout(1200);
      const todayAfter = await page.evaluate(() => document.querySelector('[data-testid="dash-hero-today-value"]')?.textContent);
      record(vp, 'live completion', { atTop: top === `dash-recent-${newId}`, todayCounted: todayAfter === '10' }, { top, todayNow, todayAfter });
    }
    await ctx.close();

    // ── phone ──
    const pvp = `phone 390x844 ${theme} ${mode}`;
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme, deviceScaleFactor: 2, timezoneId: 'Asia/Shanghai', locale: 'zh-CN', userAgent: ANDROID_UA, hasTouch: true });
    const pp = await pctx.newPage();
    await pp.clock.install({ time: FIXED_NOW });
    pp.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
    await pp.addInitScript(fixture, mode);
    await pp.addInitScript(initScript, { theme });
    try { await open(pp, true); } catch (e) { record(pvp, 'open', { opened: false }, { error: String(e).split('\n')[0] }); await pctx.close(); continue; }
    if (OUT) await pp.screenshot({ path: join(OUT, `phone-${theme}-${mode}.png`) });
    const tab = await box(pp, tid('tasks-view-dashboard'));
    const hero = await paintedText(pp, tid('dash-hero-today-value'));
    const heroB = await box(pp, tid('dash-hero-today'));
    const rc = await box(pp, tid('dash-recent-card'));
    const five = await count(pp, `${tid('dash-recent')} [data-testid^="dash-recent-t"]:not([data-testid="dash-recent-title"])`);
    const pTitle = await paintedText(pp, `${tid('dash-recent')} ${tid('dash-recent-title')}`);
    const cta = await box(pp, tid('dash-share'));
    const pOverflow = await pp.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
    await pp.locator(tid('dash-recent-expand')).first().click();
    await pp.waitForTimeout(300);
    const expanded = await count(pp, `${tid('dash-recent')} [data-testid^="dash-recent-t"]:not([data-testid="dash-recent-title"])`);
    record(pvp, 'dashboard', {
      tabVisible: !!tab && tab.x >= 0 && tab.r <= 390,
      heroPainted: !!hero?.painted && hero.text === '9',
      recentUnderHero: !!heroB && !!rc && rc.y > heroB.b && rc.y - heroB.b < 24,
      fiveRows: five === 5,
      expands: expanded > 5,
      titlePainted: !!pTitle?.painted && pTitle.w >= 40,
      // 「生成分享图」入口已下线：手机底部那条按钮必须不存在，别又被加回来盖住「最近完成」。
      noShareCta: cta === null,
      noOverflow: pOverflow <= 0,
    }, { tab: tab && `${r1(tab.x)}..${r1(tab.r)}`, five, expanded, gap: heroB && rc && r1(rc.y - heroB.b) });
    if (OUT) {
      await pp.locator(tid('dash-recent-expand')).first().click().catch(() => {});
      await pp.waitForTimeout(200);
      await pp.evaluate(() => { const sc = [...document.querySelectorAll('div')].find(d => d.scrollHeight > d.clientHeight + 200 && getComputedStyle(d).overflowY !== 'visible'); sc?.scrollBy(0, 760); });
      await pp.waitForTimeout(300);
      await pp.screenshot({ path: join(OUT, `phone-scrolled-${theme}-${mode}.png`) });
    }
    await pctx.close();
  }
}
await browser.close();
close();
console.log(`\n${rows.length - failures}/${rows.length} checks passed`);
if (failures) process.exit(1);
