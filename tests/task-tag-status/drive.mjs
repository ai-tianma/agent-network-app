import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { serveExport, initScript, findChromium, TEST_LOCALE } from '../test-layout-sweep/harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR), browser = await chromium.launch({ headless: true, executablePath: findChromium() });
let checks = 0;
const ck = (name, value) => { assert(value, name); checks++; console.log(`PASS ${name}`); };
function fixture(mode) {
  const at = '1999-01-01T00:00:00Z';
  const card = (id, column, tags, project_id = 'p1') => ({ id, name: id, seq: 1, column, tags, project_id, priority: 'normal', assignee: '', owner: null, agent_owner: null, participants: [], description: '', checklist: [], createdAt: at, updatedAt: at, completedAt: column === 'done' ? at : null });
  const loaded = Array.from({ length: 20 }, (_, i) => card(`doing${i}`, 'doing', ['ANet']));
  loaded.push(card('poolA', 'pool', ['ANet', 'ANet', '知识库']), card('doneNone', 'done', [], null), card('abandonedLabel', 'abandoned', ['未设置标签']));
  for (let i = 0; i < 12; i++) loaded.push(card(`extra${i}`, 'pool', [`标签${String(i).padStart(2, '0')}`], 'p2'));
  const states = (tag, pool, doing, done, abandoned) => ({ tag, pool, doing, done, abandoned, total: pool + doing + done + abandoned });
  window.__tasksFixture = { requirements: loaded, archived: [], hasMore: false, people: [], projects: [{ id: 'p1', name: '项目-A', color: '#2563eb', sort: 1 }, { id: 'p2', name: '项目-B', color: '#d97706', sort: 2 }], capabilities: ['description', 'checklist', 'tags', 'projects', 'requirement_seq', 'column_abandoned', 'stats'], stats: q => {
    const project = q.get('project_id'), none = project === 'none';
    const buckets = [states('ANet', 1, 501, 0, 0), states('知识库', 1, 0, 0, 0), states(null, 0, 0, 1, 0), states('未设置标签', 0, 0, 0, 1), ...Array.from({ length: 12 }, (_, i) => states(`标签${String(i).padStart(2, '0')}`, 1, 0, 0, 0))];
    return { totals: { done: 0, done_approx: 0, created: 0, created_done: 0, completion_rate: null, doing: project ? none ? 0 : project === 'p1' ? 501 : 0 : 501, pool: 1 }, daily: [], by_project: [], by_completer: [], recent: [], unattributed: 0, ...(mode === 'full' ? { tag_status: { basis: 'current', complete: true, includes_archived: false, project_filter: project, total: none ? 1 : project === 'p1' ? 503 : project === 'p2' ? 12 : 516, by_tag: none ? [buckets[2]] : project === 'p1' ? [buckets[0], buckets[1], buckets[3]] : project === 'p2' ? buckets.slice(4) : buckets } } : {}) };
  } };
  // Delay only an old all-project stats request, then switch projects in the UI.
  const original = window.__TAURI_INTERNALS__.invoke, requests = new Map();
  window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
    if (cmd === 'plugin:http|fetch') { const id = await original(cmd, args); requests.set(id, args.clientConfig.url); return id; }
    const url = requests.get(args?.rid);
    if (cmd === 'plugin:http|fetch_send' && window.__lateGlobal && url?.includes('/api/requirements/stats') && !url.includes('project_id=')) await new Promise(r => setTimeout(r, 800));
    return original(cmd, args);
  };
}
async function indexOf(page, name) {
  return page.locator('[data-testid^="dash-tag-name-"]').evaluateAll((els, value) => {
    const e = els.find(x => x.textContent === value); if (!e) throw new Error(`missing tag ${value}`);
    return Number(e.getAttribute('data-testid').split('-').pop());
  }, name);
}
try {
  mkdirSync('/output', { recursive: true });
  for (const device of [{ name: 'desktop', viewport: { width: 1200, height: 900 } }, { name: 'phone', viewport: { width: 390, height: 844 }, userAgent: 'Android TEST-ONLY', isMobile: true, hasTouch: true }]) for (const mode of ['full', 'old']) {
    const { name, ...options } = device, ctx = await browser.newContext({ locale: TEST_LOCALE, ...options }), page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript({ content: `(${initScript.toString().replace('http://mock-hub.invalid', 'http://127.0.0.1:9200')})({theme:'light'});` });
    await page.addInitScript(fixture, mode); await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
    await page.waitForFunction(() => !!window.__anetLayoutSweep);
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' }));
    await page.getByTestId('tasks-view-dashboard').first().click();
    await page.getByTestId('dash-tag-status').waitFor();
    ck(`${name}/${mode} correct completeness and total`, (await page.getByTestId('dash-tag-scope').innerText()).includes(mode === 'full' ? '516 个可见任务' : '部分数据 · 35'));
    const a = await indexOf(page, 'ANet');
    ck('whole Hub count exceeds loaded page', (await page.getByTestId(`dash-tag-count-${a}-doing`).innerText()).endsWith(mode === 'full' ? '501' : '20'));
    ck('four status counters include zeros', await page.locator(`[data-testid^="dash-tag-count-${a}-"]`).count() === 4);
    ck('top10 default', await page.locator('[data-testid^="dash-tag-row-"]').count() === 10);
    await page.getByTestId('dash-tag-expand').click(); ck('expand all buckets', await page.locator('[data-testid^="dash-tag-row-"]').count() === 16);
    ck('responsive chart orientation', await page.getByTestId(name === 'phone' ? 'dash-tag-horizontal' : 'dash-tag-columns').count() === 1);
    if (name === 'desktop') {
      await page.evaluate(() => { window.__lateGlobal = true; });
      await page.getByTestId('dash-period').getByText('全部', { exact: true }).click();
      await page.getByTestId('task-side-project-p1').click();
      await page.waitForFunction(full => document.querySelector('[data-testid="dash-tag-scope"]')?.textContent.includes(full ? '503 个可见任务' : '部分数据 · 22'), mode === 'full');
      await page.waitForTimeout(1000);
      ck('late old scope cannot overwrite current project', (await page.getByTestId('dash-tag-scope').innerText()).includes(mode === 'full' ? '503 个可见任务' : '部分数据 · 22'));
      ck('project_id reaches Hub request', await page.evaluate(() => window.__statsQueries.some(q => q.includes('project_id=p1'))));
      await page.getByTestId('task-side-project-__none__').click();
      await page.waitForFunction(() => document.querySelector('[data-testid="dash-tag-scope"]')?.textContent.includes('1 个') || document.querySelector('[data-testid="dash-tag-scope"]')?.textContent.includes('· 1 '));
      ck('no-project scope', await page.locator('[data-testid^="dash-tag-row-"]').count() === 1);
      await page.evaluate(() => { window.__lateGlobal = false; });
      await page.getByTestId('task-side-project-all').click();
      await page.waitForFunction(full => document.querySelector('[data-testid="dash-tag-scope"]')?.textContent.includes(full ? '516 个可见任务' : '部分数据 · 35'), mode === 'full');
    }
    const rowA = await indexOf(page, 'ANet');
    await page.getByTestId(`dash-tag-bar-${rowA}-pool`).click();
    await page.getByTestId('req-row-poolA').waitFor();
    ck('actual list drill-down filters tag and status', await page.locator('[data-testid^="req-row-"]').count() === 1);
    await page.getByTestId('tasks-view-dashboard').first().click(); await page.getByTestId('dash-tag-status').waitFor(); await page.getByTestId('dash-tag-expand').click();
    const no = await indexOf(page, '未设置标签');
    // The first name match is the literal tagged abandoned task; select the no-label group by its done counter.
    const done = page.locator('[data-testid^="dash-tag-count-"][data-testid$="-done"]');
    const id = await done.evaluateAll(els => els.find(e => e.textContent.trim().endsWith('1'))?.getAttribute('data-testid'));
    assert(id, `no-label completion absent; literal index ${no}`);
    await page.getByTestId(id).click(); await page.getByTestId('req-row-doneNone').waitFor();
    ck('no-label drill-down excludes literal label', await page.locator('[data-testid^="req-row-"]').count() === 1);
    await page.getByTestId('tasks-view-dashboard').first().click(); await page.getByTestId('dash-tag-status').waitFor(); await page.getByTestId('dash-tag-expand').click();
    const abandoned = await page.locator('[data-testid^="dash-tag-count-"][data-testid$="-abandoned"]').evaluateAll(els => els.find(e => e.textContent.trim().endsWith('1'))?.getAttribute('data-testid'));
    await page.getByTestId(abandoned).click(); await page.getByTestId('req-row-abandonedLabel').waitFor();
    ck('abandoned explicit drill-down visible', await page.locator('[data-testid^="req-row-"]').count() === 1);
    ck('no client page errors', errors.length === 0);
    await page.screenshot({ path: `/output/${name}-${mode}-drilldown.png`, fullPage: true }); await ctx.close();
  }
  console.log(`${checks}/${checks} checks passed`); writeFileSync('/output/result.json', JSON.stringify({ checks, acceptance: 'synthetic Hub + actual exported UI; no native device/model claim' }, null, 2));
} finally { await browser.close(); web.close(); }
