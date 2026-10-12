// 任务页搜索 —— 在 web 导出里量出来,不靠眼睛。
// CI: task-search-pagination.yml runs the exported UI in Docker. Hub data is placeholder, answered in-page by the
// Tauri stub in tests/test-layout-sweep/harness.mjs (window.__tasksFixture) — no hub process, no port, no HOME.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-task-search/drive.mjs
//
// Desktop 1320×754 / 1000×700 (mouse, desktop workspace), light + dark:
//   toolbar   : the search box sits in the task toolbar, on the header's centre line ±1, inside the header (nothing cut)
//   keys      : 「/」 and Ctrl+K focus it; Esc clears it
//   filter    : typing narrows 列表 / 看板 / 甘特图 / 日历 to the matching tasks (after the ~120ms debounce), matched text is
//               highlighted in the titles, two terms are ANDed, search + 优先级 filter combine
//   empty     : a query with no match shows 「没有找到包含 “…” 的任务」 and its 清除搜索 brings every row back
//   archived  : 「包含已归档」 is on by default (owner 2026-10-01: old finished tasks get archived and then could not be
//               found) — archived rows show up with the 已归档 tag; unticking it in the search menu hides them
// Tablet 1000×700 (Android UA, touch — the owner's landscape tablet) and phone 390×844, light + dark:
//   a magnifier in the title bar (no always-on box); tapping it opens a search field + 「取消」 (phone: in place of the
//   title row; tablet: a row under the title bar), field and 取消 on one centre line ±1, inside the 16/24px gutters,
//   the input is focused; typing filters; 取消 clears and closes.
//   No horizontal page overflow anywhere.
// Truncated list (desktop 1320×754): on a hub with capability search whose list says has_more, a query matching only an
//   older task (not in the loaded rows) shows it via ?q=; on an old hub (no search, exactly 500 rows) the empty state
//   says only the latest 500 were searched and no ?q= request is made.
// History (desktop 1320×754 + phone 390×844, light): on a search hub, an old done task, an old archived task (tagged
//   已归档) and the first page of 250 older matches come back; 「加载更多」 reads the next page with the cursor; with
//   「隐藏已完成」 on, the status line says how many hits the filter hides and 清除筛选 brings them back.
// Exit 1 when any check fails or a viewport could not be opened.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

// ── fixture: placeholder names only ──
const fixture = () => {
  const day = 86400000;
  const now = Date.now();
  const at = (d) => new Date(now + d * day).toISOString();
  const A = { kind: 'node', id: 'n_sweep_a' }, B = { kind: 'node', id: 'n_sweep_b' };
  // seq (#563, capability requirement_seq): s1 → #1 … so the ID column shows next to the search results
  const R = (id, name, o) => ({ id, seq: /^s\d+$/.test(id) ? Number(id.slice(1)) : null, name, priority: 'normal', assignee: '', column: 'pool', owner: { kind: 'user', id: 'u_tester' }, participants: [], agent_owner: A, project_id: 'p_a', due: '', createdAt: at(-5), updatedAt: at(-1), description: '', checklist: [], tags: [], parent_id: null, ...o });
  window.__tasksFixture = {
    requirements: [
      R('s1', '示例企业组织树权限设置', { priority: 'high', column: 'doing', due: at(-0.2) }),
      R('s2', '示例文案 | Space 统一为智能体', { agent_owner: B, description: '把 Portal 里的旧说法统一掉' }),
      R('s3', 'Portal Token 管理 | 估算成本卡布局', { agent_owner: B, project_id: 'p_b', tags: ['前端'] }),
      R('s4', '示例模型同步 | 清除选择器陈旧项', { column: 'done' }),
      R('s5', 'Space node-path | 重启导致 binding 丢失', { priority: 'high', description: '复现步骤见截图 ![](/api/files/abc)' }),
      R('s6', 'Portal 文案 | 网络策略“待目录”改为…', { project_id: 'p_b', column: 'doing' }),
      R('s7', '示例网络策略 | 历史 receipt 误报', { agent_owner: B }),
      R('s8', 'Portal 模型目录 | 降级路径过滤一致性', { project_id: 'p_b', due: at(3) }),
    ],
    archived: [R('z1', '已归档:旧版组织树方案', { archived: true })],
    projects: [{ id: 'p_a', name: '示例项目-A', color: '#2563eb', sort: 1, archived: false }, { id: 'p_b', name: '示例门户', color: '#16a34a', sort: 2, archived: false }],
    people: [
      { kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' },
      { kind: 'node', id: 'n_sweep_a', networkId: 'net-sweep', name: '示例-A' },
      { kind: 'node', id: 'n_sweep_b', networkId: 'net-sweep', name: '示例-门户牛' },
    ],
    capabilities: ['agent_owner', 'description', 'checklist', 'projects', 'due_datetime', 'priority_lowest', 'start_date', 'tags', 'sub_requirements', 'archived', 'requirement_seq'],
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
  return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom, cy: b.y + b.height / 2, cx: b.x + b.width / 2, text: el.textContent };
}, sel);
const overflow = (page) => page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
// ids of the task rows / cards / gantt entries on screen right now
const shown = (page, prefix) => page.evaluate((p) => [...new Set([...document.querySelectorAll(`[data-testid^="${p}"]`)].filter(e => e.getClientRects().length).map(e => e.dataset.testid.slice(p.length)).filter(id => /^[sz]\d+$/.test(id)))].sort().join(','), prefix);
// Painted hits only. In 0.2.159–0.2.162 the list title box was 0px wide with overflow:hidden: the highlight span inside
// kept its own client rects and full width, it was just clipped away — so intersect with every clipping ancestor.
const hits = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid="task-search-hit"]')].filter(e => {
  const b = e.getBoundingClientRect();
  let w = b.width, h = b.height;
  for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
    const cs = getComputedStyle(a);
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
    const r = a.getBoundingClientRect();
    w = Math.min(w, Math.min(b.right, r.right) - Math.max(b.left, r.left));
    h = Math.min(h, Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top));
  }
  return w >= 1 && h >= 1;
}).map(e => e.textContent));
const inputValue = (page) => page.evaluate(() => document.querySelector('[data-testid="task-search-input"]')?.value ?? null);
const focused = (page) => page.evaluate(() => document.activeElement?.dataset?.testid ?? '');
const settle = (page) => page.waitForTimeout(400); // > the 120ms debounce + a render

const { url, close } = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--disable-web-security'] });

async function open(page, kind) {
  await page.goto(kind === 'desktop' ? url : `${url}?safeAreaSim=0,0,0,0`);
  if (kind === 'desktop') {
    await page.locator('[data-testid="desktop-rail"] [aria-label="任务"]').first().click({ timeout: 30000 });
  } else {
    await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 30000 });
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' }));
  }
  await page.locator(tid('tasks-view-list')).first().click({ timeout: 20000 });
  await page.locator(tid('req-row-s1')).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
}

const ALL = 's1,s2,s3,s4,s5,s6,s7,s8';
const VIEWPORTS = [
  { w: 1320, h: 754, kind: 'desktop' },
  { w: 1000, h: 700, kind: 'desktop' },
  { w: 1000, h: 700, kind: 'tablet' },
  { w: 390, h: 844, kind: 'phone' },
];

for (const theme of ['light', 'dark']) {
  for (const v of VIEWPORTS) {
    const vp = `${v.kind} ${v.w}x${v.h} ${theme}`;
    const touch = v.kind !== 'desktop';
    const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, colorScheme: theme, deviceScaleFactor: 2, timezoneId: 'Asia/Shanghai', locale: 'zh-CN', ...(touch ? { userAgent: ANDROID_UA, hasTouch: true } : {}) });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
    await page.addInitScript(fixture);
    await page.addInitScript(initScript, { theme });
    try {
      await open(page, v.kind);
    } catch (e) {
      record(vp, 'open', { opened: false }, { error: String(e).split('\n')[0] });
      await ctx.close();
      continue;
    }
    const shot = (name) => OUT && page.screenshot({ path: join(OUT, `${v.kind}-${v.w}x${v.h}-${theme}-${name}.png`) });
    const header = await box(page, tid('task-header'));
    const typeQuery = async (text) => { await page.locator(tid('task-search-input')).first().fill(text); await settle(page); };
    await shot('0-before');
    // nothing in the toolbar is cut: every filter chip and 新建 lies inside the visible part of its scroll strip and the window
    const clipped = async () => page.evaluate(() => {
      const strip = document.querySelector('[data-testid="task-header-filters"]');
      if (!strip) return ['no strip'];
      const sb = strip.getBoundingClientRect();
      const out = [];
      for (const id of ['task-filter-owner', 'task-filter-priority', 'task-scope', 'task-filter-project', 'task-filter-status']) {
        const e = document.querySelector(`[data-testid="${id}"]`);
        if (!e) continue;
        const b = e.getBoundingClientRect();
        if (b.x < sb.x - 0.5 || b.right > sb.right + 0.5 || b.right > window.innerWidth) out.push(`${id} ${Math.round(b.x)}..${Math.round(b.right)} strip ${Math.round(sb.x)}..${Math.round(sb.right)}`);
      }
      const nb = document.querySelector('[data-testid="req-new"]')?.getBoundingClientRect();
      if (nb && nb.right > window.innerWidth) out.push('req-new');
      return out;
    });
    if (v.kind !== 'phone') {
      const cut = await clipped();
      const strip = await box(page, tid('task-header-filters'));
      record(vp, 'toolbar: nothing cut', { none: cut.length === 0 }, { cut: cut.join(' | ') || '-', filtersRow: strip && strip.y > header.b - 1 ? 'second row' : 'inline' });
    }

    try {
    if (v.kind === 'desktop') {
      const sb = await box(page, tid('task-search'));
      const nb = await box(page, tid('req-new'));
      const seg = await box(page, tid('tasks-view'));
      record(vp, 'toolbar box', {
        present: !!sb, noIcon: !(await box(page, tid('task-search-open'))),
        centre: !!sb && Math.abs(sb.cy - nb.cy) <= 1 && Math.abs(sb.cy - seg.cy) <= 1,
        insideHeader: !!sb && sb.r <= header.r && nb.r <= header.r && sb.r <= nb.x,
        noOverflow: (await overflow(page)) <= 0,
      }, { box: sb && `${r1(sb.x)}..${r1(sb.r)} w${r1(sb.w)}`, cy: `${r1(sb?.cy)}/${r1(nb.cy)}/${r1(seg.cy)}`, headerR: r1(header.r) });

      await page.mouse.click(v.w / 2, v.h - 6);
      await page.keyboard.press('/');
      const slash = await focused(page);
      await page.mouse.click(v.w / 2, v.h - 6);
      await page.keyboard.press('Control+k');
      const ctrlk = await focused(page);
      record(vp, 'keys focus', { slash: slash === 'task-search-input', ctrlK: ctrlk === 'task-search-input' }, { slash, ctrlk });

      await page.keyboard.type('组织树');
      await settle(page);
      const listHit = await shown(page, 'req-row-');
      const hl = await hits(page);
      const seqCell = await box(page, tid('task-seq-s1'));
      record(vp, 'type filters list (archived z1 included by default)', { rows: listHit === 's1,z1', highlighted: hl.includes('组织树'), idColumn: seqCell?.text === '#1' }, { rows: listHit, hits: hl.join('|'), id: seqCell?.text });
      await shot('1-list-search');

      await page.keyboard.press('Escape');
      await settle(page);
      record(vp, 'Esc clears', { value: (await inputValue(page)) === '', rows: (await shown(page, 'req-row-')) === ALL }, { rows: await shown(page, 'req-row-') });

      await typeQuery('portal 门户牛');
      record(vp, 'two terms AND (title + agent)', { rows: (await shown(page, 'req-row-')) === 's2,s3' }, { rows: await shown(page, 'req-row-') });
      await typeQuery('网络策略');
      await page.locator(tid('task-filter-priority')).first().click();
      await page.locator(tid('task-filter-opt-high')).first().click().catch(() => {});
      await page.locator(tid('task-filter-scrim')).first().click({ position: { x: 5, y: v.h - 5 } }).catch(() => {});
      await settle(page);
      const combo = await shown(page, 'req-row-');
      await page.locator(tid('task-filter-clear')).first().click().catch(() => {});
      await settle(page);
      const noFilter = await shown(page, 'req-row-');
      record(vp, 'search + 优先级 filter', { none: combo === '', both: noFilter === 's6,s7' }, { withHigh: combo || '(empty)', without: noFilter });

      await typeQuery('portal');
      await page.locator(tid('tasks-view-board')).first().click();
      await settle(page);
      const cards = await shown(page, 'req-card-');
      await shot('2-board-search');
      await page.locator(tid('tasks-view-gantt')).first().click();
      await settle(page);
      const gantt = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-testid^="gantt-bar-"],[data-testid^="gantt-undated-"],[data-testid^="gantt-name-"]')].map(e => e.dataset.testid.replace(/^gantt-(bar|undated|name)-/, '')).filter(id => /^s\d$/.test(id)))].sort().join(','));
      await shot('3-gantt-search');
      record(vp, 'board + gantt follow the search', { board: cards === 's2,s3,s6,s8', gantt: gantt === 's2,s3,s6,s8' }, { board: cards, gantt });
      // 日历(#558):同一个 visibleTasks 集合 —— 有期限的 s8 在格子里,不匹配的 s1(今天到期)不在
      await page.locator(tid('tasks-view-calendar')).first().click();
      await settle(page);
      const cal = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-testid^="cal-item-"],[data-testid^="cal-row-"],[data-testid^="cal-undated-"]')].filter(e => e.getClientRects().length).map(e => e.dataset.testid.replace(/^cal-(item|row|undated)-/, '')).filter(id => /^s\d+$/.test(id)))].sort().join(','));
      const calHits = await hits(page);
      await shot('3b-calendar-search');
      record(vp, 'calendar follows the search', { s8: cal.split(',').includes('s8'), onlyMatches: cal.split(',').filter(Boolean).every(id => ['s2', 's3', 's6', 's8'].includes(id)), highlighted: calHits.includes('Portal') }, { calendar: cal, hits: calHits.join('|') });
      await page.locator(tid('tasks-view-list')).first().click();
      await settle(page);

      await typeQuery('完全不存在的词');
      const empty = await box(page, tid('task-search-empty-text'));
      await shot('4-empty');
      await page.locator(tid('task-search-empty-clear')).first().click();
      await settle(page);
      record(vp, 'empty state', { text: empty?.text === '没有找到包含 “完全不存在的词” 的任务', cleared: (await shown(page, 'req-row-')) === ALL && (await inputValue(page)) === '' }, { text: empty?.text });

      await typeQuery('组织树');
      await page.waitForTimeout(700);
      const before = await shown(page, 'req-row-');
      const tag = await box(page, tid('task-archived-tag'));
      await shot('5-archived');
      await page.locator(tid('task-search-options')).first().click();
      await page.locator(tid('task-search-archived')).first().click();
      await settle(page);
      const after = await shown(page, 'req-row-');
      record(vp, 'archived toggle', { shownByDefault: before === 's1,z1', tagged: !!tag, hiddenWhenOff: after === 's1' }, { before, after });
      await page.locator(tid('task-search-options')).first().click();
      await page.locator(tid('task-search-archived')).first().click();
      await typeQuery('');
    } else {
      const icon = await box(page, tid('task-search-open'));
      const nb = await box(page, tid('req-new'));
      record(vp, 'magnifier in title bar', {
        icon: !!icon, noInlineBox: !(await box(page, tid('task-search'))),
        centre: !!icon && Math.abs(icon.cy - nb.cy) <= 1, inside: !!icon && nb.r <= v.w - 16 + 0.5 && icon.r <= nb.x,
      }, { icon: icon && `${r1(icon.x)}..${r1(icon.r)} cy${r1(icon.cy)}`, newCy: r1(nb.cy) });
      const titleXBefore = await page.evaluate(() => { const h = document.querySelector('[data-testid="task-header"] [role="heading"]'); return h ? h.getBoundingClientRect().x : -1; });
      await page.locator(tid('task-search-open')).first().click();
      await page.waitForTimeout(400);
      const field = await box(page, tid('task-search'));
      const cancel = await box(page, tid('task-search-cancel'));
      const titleX = titleXBefore;
      record(vp, 'expanded search bar', {
        field: !!field, cancel: !!cancel, focused: (await focused(page)) === 'task-search-input',
        centre: !!field && !!cancel && Math.abs(field.cy - cancel.cy) <= 1,
        // phone: the 16px gutters; tablet: the header's own gutters (field starts under the 任务 title, 取消 ends where 新建 ends)
        gutters: !!field && !!cancel && (v.kind === 'phone' ? Math.abs(field.x - 16) <= 1 && Math.abs(cancel.r - (v.w - 16)) <= 1 : Math.abs(field.x - titleX) <= 1 && Math.abs(cancel.r - nb.r) <= 1),
        order: !!field && !!cancel && field.r <= cancel.x,
        // phone: the field replaces the title row (新建 goes away with it); tablet: the title bar stays as it was
        titleRow: v.kind === 'phone' ? !(await box(page, tid('req-new'))) : !!(await box(page, tid('req-new'))),
      }, { field: field && `${r1(field.x)}..${r1(field.r)} cy${r1(field.cy)} h${r1(field.h)}`, cancel: cancel && `${r1(cancel.x)}..${r1(cancel.r)} cy${r1(cancel.cy)}` });
      await shot('1-open');
      await page.locator(tid('task-search-input')).first().fill('portal');
      await settle(page);
      const got = await shown(page, 'req-row-');
      const hl = await hits(page);
      await shot('2-typed');
      record(vp, 'typing filters', { rows: got === 's2,s3,s6,s8', highlighted: hl.filter(h => h === 'Portal').length === 3, noOverflow: (await overflow(page)) <= 0 }, { rows: got, hits: hl.join('|') });
      await page.locator(tid('task-search-input')).first().fill('完全不存在的词');
      await settle(page);
      const empty = await box(page, tid('task-search-empty-text'));
      await shot('3-empty');
      record(vp, 'empty state', { text: empty?.text === '没有找到包含 “完全不存在的词” 的任务' }, { text: empty?.text });
      await page.locator(tid('task-search-cancel')).first().click();
      await settle(page);
      record(vp, '取消 clears and closes', { closed: !(await box(page, tid('task-search'))), rows: (await shown(page, 'req-row-')) === ALL, icon: !!(await box(page, tid('task-search-open'))) }, { rows: await shown(page, 'req-row-') });
    }
    } catch (e) {
      record(vp, 'drive', { finished: false }, { error: String(e).split('\n')[0] });
      await shot('x-error');
    }
    await ctx.close();
  }
}

// ── truncated list (more than the hub returns in one page) ──
// new hub (capabilities search + paging, has_more: true): a query that only matches an older task not in the list
// shows it (asked with ?q=); old hub (no search capability, exactly 500 rows, no has_more): the empty state says only
// the latest 500 were searched.
const truncatedFixture = (kind) => {
  const at = (d) => new Date(Date.now() + d * 86400000).toISOString();
  const R = (id, name, o) => ({ id, name, priority: 'normal', assignee: '', column: 'pool', owner: { kind: 'user', id: 'u_tester' }, participants: [], agent_owner: null, project_id: null, due: '', createdAt: at(-1), updatedAt: at(-1), description: '', checklist: [], tags: [], parent_id: null, ...o });
  const base = kind === 'old' ? Array.from({ length: 500 }, (_, i) => R(`n${i}`, `示例新任务 ${i}`)) : [R('n1', '示例新任务一'), R('n2', '示例新任务二')];
  window.__tasksFixture = {
    requirements: base,
    serverOnly: [R('old1', '很久以前的归档前方案', { createdAt: at(-400) })],
    projects: [], people: [{ kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' }],
    capabilities: kind === 'old' ? ['agent_owner', 'description', 'archived'] : ['agent_owner', 'description', 'archived', 'search', 'paging'],
    ...(kind === 'old' ? {} : { hasMore: true }),
  };
};
for (const kind of ['new', 'old']) {
  const vp = `desktop 1320x754 light truncated-${kind}-hub`;
  const ctx = await browser.newContext({ viewport: { width: 1320, height: 754 }, deviceScaleFactor: 2, timezoneId: 'Asia/Shanghai', locale: 'zh-CN' });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await page.addInitScript(truncatedFixture, kind);
  await page.addInitScript(initScript, { theme: 'light' });
  try {
    await page.goto(url);
    await page.locator('[data-testid="desktop-rail"] [aria-label="任务"]').first().click({ timeout: 30000 });
    await page.locator(tid('tasks-view-list')).first().click({ timeout: 20000 });
    // Old-Hub rows are sorted before paging; n0 need not be on the first page.
    await page.locator('[data-testid^="req-row-n"]').first().waitFor({ timeout: 20000 });
    await page.locator(tid('task-search-input')).first().fill('归档前方案');
    await page.waitForTimeout(900);
    const got = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="req-row-"]')].map(e => e.dataset.testid.slice(8)).filter(id => /^[a-z]+\d+$/.test(id)).join(','));
    const asked = await page.evaluate(() => (window.__tasksQueries || []).join(' '));
    if (OUT) await page.screenshot({ path: join(OUT, `desktop-1320x754-light-truncated-${kind}.png`) });
    if (kind === 'new') {
      record(vp, 'older task found via ?q=', { row: got === 'old1', asked: asked.includes('q=') }, { rows: got || '(none)', asked });
    } else {
      const partial = await box(page, tid('task-search-partial'));
      record(vp, 'old hub: says only the latest 500 were searched', { noRow: got === '', note: !!partial, notAsked: asked === '' }, { note: partial?.text });
    }
  } catch (e) {
    record(vp, 'drive', { finished: false }, { error: String(e).split('\n')[0] });
  }
  await ctx.close();
}

// ── history: old done / archived tasks, paging, filters ──
const historyFixture = () => {
  const at = (d) => new Date(Date.now() + d * 86400000).toISOString();
  const R = (id, name, o) => ({ id, name, priority: 'normal', assignee: '', column: 'pool', owner: { kind: 'user', id: 'u_tester' }, participants: [], agent_owner: null, project_id: null, due: '', createdAt: at(-1), updatedAt: at(-1), description: '', checklist: [], tags: [], parent_id: null, ...o });
  window.__tasksFixture = {
    requirements: [R('n1', '示例新任务一', { column: 'doing' }), R('n2', '示例新任务二')],
    serverOnly: [
      R('h1', '示例旧发票导出', { column: 'done', createdAt: at(-300), updatedAt: at(-290) }),
      ...Array.from({ length: 250 }, (_, i) => R(`m${i}`, `示例周报 第 ${i} 期`, { column: i % 2 ? 'done' : 'pool', createdAt: at(-30 - i) })),
    ],
    archived: [R('a1', '示例雪豹计划', { column: 'done', archived: true, createdAt: at(-400) })],
    projects: [], people: [{ kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' }],
    capabilities: ['agent_owner', 'description', 'archived', 'search', 'paging', 'list_summary'],
    hasMore: false,
  };
};
for (const v of [{ w: 1320, h: 754, kind: 'desktop' }, { w: 390, h: 844, kind: 'phone' }]) {
  const vp = `${v.kind} ${v.w}x${v.h} light history`;
  const touch = v.kind !== 'desktop';
  const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 2, timezoneId: 'Asia/Shanghai', locale: 'zh-CN', ...(touch ? { userAgent: ANDROID_UA, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await page.addInitScript(historyFixture);
  await page.addInitScript(initScript, { theme: 'light' });
  const shot = (name) => OUT && page.screenshot({ path: join(OUT, `${v.kind}-${v.w}x${v.h}-light-history-${name}.png`) });
  const ids = () => page.evaluate(() => [...new Set([...document.querySelectorAll('[data-testid^="req-row-"]')].filter(e => e.getClientRects().length).map(e => e.dataset.testid.slice(8)).filter(id => /^[a-z]+\d+$/.test(id)))]);
  // Count exact results across render pages, not simultaneously mounted DOM rows.
  // Keep server cursor/loading assertions independent of the 50-row render window.
  const allIds = async () => {
    const previous = page.locator(tid('task-page-previous')).first();
    const next = page.locator(tid('task-page-next')).first();
    const reset = async () => {
      for (let i = 0; i < 16 && await previous.getAttribute('aria-disabled') !== 'true'; i++) {
        await previous.click(); await settle(page);
      }
      if (await previous.getAttribute('aria-disabled') !== 'true') throw new Error('pager did not reach first page');
    };
    await reset();
    const result = [];
    for (let i = 0; i < 16; i++) {
      const current = await ids();
      if (current.length > 50) throw new Error('render page exceeded 50 rows');
      result.push(...current);
      if (await next.getAttribute('aria-disabled') === 'true') {
        if (new Set(result).size !== result.length) throw new Error('duplicate result across pages');
        await reset();
        return result.sort();
      }
      await next.click(); await settle(page);
    }
    throw new Error('pager did not reach last page');
  };
  const sameIds = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected.sort());
  try {
    if (v.kind === 'desktop') {
      await page.goto(url);
      await page.locator('[data-testid="desktop-rail"] [aria-label="任务"]').first().click({ timeout: 30000 });
    } else {
      await page.goto(`${url}?safeAreaSim=0,0,0,0`);
      await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 30000 });
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' }));
    }
    await page.locator(tid('tasks-view-list')).first().click({ timeout: 20000 });
    await page.locator(tid('req-row-n1')).first().waitFor({ timeout: 20000 });
    if (touch) { await page.locator(tid('task-search-open')).first().click(); await page.waitForTimeout(300); }
    const search = async (text) => { await page.locator(tid('task-search-input')).first().fill(text); await page.waitForTimeout(900); };

    await search('发票');
    record(vp, 'old done task by title word', { row: (await ids()).join() === 'h1' }, { rows: (await ids()).join() || '(none)' });
    await search('雪豹');
    const tag = await box(page, tid('task-archived-tag'));
    await shot('1-archived');
    record(vp, 'old archived task found by default, tagged', { row: (await ids()).join() === 'a1', tagged: !!tag, askedInclude: (await page.evaluate(() => (window.__tasksQueries || []).join(' '))).includes('include_archived=1') }, { rows: (await ids()).join() || '(none)' });

    await search('周报');
    const first = await allIds();
    const count1 = (await box(page, tid('task-search-count')))?.text;
    const more = await box(page, tid('task-search-load-more'));
    await shot('2-load-more');
    await page.locator(tid('task-search-load-more')).first().click();
    await page.waitForTimeout(900);
    const second = await allIds();
    const asked = await page.evaluate(() => (window.__tasksQueries || []).filter(q => q.includes('cursor=')).join(' '));
    record(vp, '加载更多 reads the next page', { firstPage: sameIds(first, Array.from({ length: 200 }, (_, i) => `m${i}`)), button: !!more, allAfter: sameIds(second, Array.from({ length: 250 }, (_, i) => `m${i}`)), cursor: asked.includes('cursor=200'), gone: !(await box(page, tid('task-search-load-more'))), noOverflow: (await overflow(page)) <= 0 }, { first: first.length, second: second.length, count1 });

    // 隐藏已完成 via the status filter: the status line says how many hits it hides; 清除筛选 brings them back
    await page.locator(tid('task-filter-status')).first().click();
    await page.locator(tid('task-filter-opt-status-hide-done')).first().click().catch(() => {});
    await page.locator(tid('task-filter-scrim')).first().click({ position: { x: 5, y: v.h - 5 } }).catch(() => {});
    await page.waitForTimeout(500);
    const hidden = await box(page, tid('task-search-hidden'));
    const filtered = await allIds();
    await shot('3-hidden-by-filter');
    await page.locator(tid('task-search-clear-filters')).first().click();
    await page.waitForTimeout(500);
    record(vp, 'hits hidden by filters are counted and 清除筛选 shows them', { counted: hidden?.text === '另有 125 个被筛选隐藏', filtered: sameIds(filtered, Array.from({ length: 125 }, (_, i) => `m${i * 2}`)), back: sameIds(await allIds(), Array.from({ length: 250 }, (_, i) => `m${i}`)), barGone: !(await box(page, tid('task-search-hidden'))) }, { hidden: hidden?.text, filtered: filtered.length });
  } catch (e) {
    record(vp, 'drive', { finished: false }, { error: String(e).split('\n')[0] });
    await shot('x-error');
  }
  await ctx.close();
}

await browser.close();
close();
console.log(`\n${rows.length - failures}/${rows.length} checks passed`);
if (failures) process.exit(1);
