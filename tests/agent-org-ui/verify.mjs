import { mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from './server.mjs';

const here = dirname(fileURLToPath(import.meta.url)), out = resolve(here, 'artifacts');
mkdirSync(out, { recursive: true });
for (const name of readdirSync(out)) {
  if (/^(desktop|mobile)-(light|dark)-.*\.(png|txt|json)$/.test(name) || name === 'report.json') rmSync(resolve(out, name));
}
const modulePath = process.env.PLAYWRIGHT_MODULE || '/Users/vansin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(modulePath).href);
const browser = await chromium.launch({ headless: true, executablePath: existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined });
const { server, url } = await startServer();
const results = [], errors = [], blocked = [], screenshots = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` ${JSON.stringify(detail)}` : ''}`); };
const state = async () => (await fetch(`${url}__fixture/state`)).json();
const cases = [
  { name: 'desktop-light', width: 1440, height: 1100, theme: 'light' },
  { name: 'desktop-dark', width: 1440, height: 1100, theme: 'dark' },
  { name: 'mobile-light', width: 390, height: 844, theme: 'light', phone: true },
  { name: 'mobile-dark', width: 390, height: 844, theme: 'dark', phone: true },
];
try {
  for (const c of cases) {
    await fetch(`${url}__fixture/reset`, { method: 'POST' });
    const context = await browser.newContext({ viewport: { width: c.width, height: c.height }, colorScheme: c.theme, locale: 'zh-CN', serviceWorkers: 'block', ...(c.phone ? { hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36' } : {}) });
    await context.route('**/*', route => { if (new URL(route.request().url()).origin !== new URL(url).origin) { blocked.push(route.request().url()); return route.abort(); } return route.continue(); });
    const page = await context.newPage(); page.setDefaultTimeout(8000);
    page.on('pageerror', e => errors.push({ case: c.name, error: e.message }));
    const el = id => page.getByTestId(`agent-org-${id}`);
    const test = (name, ok, detail) => check(`${c.name} ${name}`, ok, detail);
    const shot = async name => { await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(200); const path = resolve(out, `${c.name}-${name}.png`); await page.screenshot({ path }); screenshots.push(path); };
    const navigate = async () => {
      await page.goto(`${url}?theme=${c.theme}`);
      if (c.phone) await page.getByText('设置', { exact: true }).last().click();
      else await page.locator('[data-testid="desktop-rail"] [aria-label="设置"]').click();
      if (c.phone) await page.getByTestId('settings-row-agentTeams').click();
      else await page.getByTestId('settings-sidebar').getByText('Agent 组织架构', { exact: true }).click();
      await el('tree').waitFor();
    };
    const back = async () => { if (c.phone) await el('back').click(); };
    const dept = async id => { await back(); await el(`dept-${id}`).click(); };
    const count = async (id, n) => await el(`dept-${id}-value`).innerText() === String(n);
    const selected = async id => el(`dept-${id}`).evaluate(e => ({ attributes: Object.fromEntries([...e.attributes].map(a => [a.name, a.value])), background: getComputedStyle(e).backgroundColor, weight: getComputedStyle(e.querySelector('[data-testid$="-label"]')).fontWeight }));
    const pick = async (kind, query, id) => {
      await el(`pick-${kind}`).click(); await el('selector').waitFor();
      await el('selector-search').fill(query); await el(`demo-${kind === 'agent' ? 'agent' : 'dept'}-${id}`).click();
      await el('selector').waitFor({ state: 'hidden' });
    };
    try {
      await navigate();
      test('normal App Settings navigation', true);
      test('329 unassigned / empty root / paginated directory', await count('unassigned', 329) && await count('tmai', 0) && (await state()).requests.some(r => r.path.endsWith('/directory') && r.query.includes('offset=200')));
      test('adjustment initially collapsed', await el('pick-agent').count() === 0 && await el('demo-apply').count() === 0);
      if (c.phone) { test('initial mobile tree only', await el('detail').count() === 0); await el('dept-unassigned').click(); }
      else { const s = await selected('unassigned'); test('initial desktop unassigned visually selected', s.weight === '600', s); }
      test('unassigned member rows populated', await el('agent-original-000').count() === 1 && await el('agent-original-328').count() === 1);
      await shot('workspace');
      await el('member-search').fill('original-328');
      test('member ID search', await page.locator('[data-testid^="agent-org-agent-"]:not([data-testid$="-label"])').count() === 1);
      await el('member-search').fill('Fixture Owner 200');
      test('member owner search', await page.locator('[data-testid^="agent-org-agent-"]:not([data-testid$="-label"])').count() === 200);
      await el('member-search').fill('no-match-xyz'); await el('no-results').waitFor(); test('member no-results', true);
      await el('member-search').fill('');
      await dept('tmai'); await el('no-agents').waitFor();
      test('empty root detail / selected highlight', c.phone || (await selected('tmai')).weight === '600');
      if (!c.phone) test('selected department exposes accessibility state', await el('dept-tmai').getAttribute('aria-selected') === 'true', await selected('tmai'));
      await shot('empty-root');
      if (c.phone) { await el('child-tmwork').click(); test('nested child navigation', (await el('detail').innerText()).includes('TMWork')); await back(); test('back restores tree', await el('departments').isVisible()); }
      await el('adjust-toggle').click();
      await el('demo-apply').click();
      test('incomplete apply performs no writes', (await state()).writes.length === 0 && await el('demo-result').isVisible());
      for (const kind of ['agent', 'department']) {
        await el(`pick-${kind}`).click(); await el('selector').waitFor(); await page.waitForTimeout(250);
        const box = await el('selector').boundingBox();
        test(`${kind} picker bounded`, box && box.x >= 0 && box.y >= 0 && box.x + box.width <= c.width + 1 && box.y + box.height <= c.height + 1 && box.width <= 481 && box.height <= c.height * .81, box);
        test(`${kind} list scroll bounded`, await el('selector').evaluate(e => [...e.querySelectorAll('*')].some(n => n.scrollHeight > n.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(n).overflowY))));
        await shot(`${kind}-picker`);
        await el('selector-search').fill('no-match-xyz');
        test(`${kind} no results`, await el('selector').getByText('没有匹配结果', { exact: true }).count() > 0 || (await el('selector').innerText()).includes('没有'));
        await el('selector-search').fill(kind === 'agent' ? 'original-000' : 'station-a');
        const option = el(`demo-${kind === 'agent' ? 'agent-original-000' : 'dept-station-a'}`); await option.waitFor();
        test(`${kind} ID search`, await option.isVisible()); await option.click(); await el('selector').waitFor({ state: 'hidden' });
      }
      test('picker selection only performs no writes', (await state()).writes.length === 0);
      await el('adjust-toggle').click(); test('collapse hides fields', await el('pick-agent').count() === 0); await el('adjust-toggle').click();
      await el('demo-apply').click();
      await page.waitForFunction(() => document.querySelector('[data-testid="agent-org-demo-result"]')?.textContent.includes('保存'));
      await page.waitForTimeout(500);
      let s = await state();
      test('explicit apply exactly one successful PUT', s.writes.length === 1 && s.writes[0].status === 200 && s.writes[0].body.department_id === 'station-a' && s.agents[0].department_id === 'station-a', s.writes);
      if (!c.phone) test('successful move subtree counts', await count('unassigned', 328) && await count('station-a', 1) && await count('stations', 1) && await count('tmai', 1));
      await navigate();
      if (c.phone) await el('dept-station-a').click();
      test('reload selects populated department rather than empty root', await el('agent-original-000').count() === 1 && (c.phone || (await selected('station-a')).weight === '600'));
      await shot('populated');
      await el('adjust-toggle').click();
      await pick('agent', 'original-000', 'original-000'); await pick('department', 'station-b', 'station-b');
      await fetch(`${url}__fixture/deny`, { method: 'POST' });
      await el('demo-apply').click();
      await page.waitForTimeout(800);
      s = await state();
      test('denied save rolls back member and persisted data', s.writes.length === 2 && s.writes[1].status === 403 && s.agents[0].department_id === 'station-a' && await el('agent-original-000').count() === 1, await el('demo-result').innerText());
      if (!c.phone) test('denied save restores counts', await count('station-a', 1) && await count('station-b', 0) && await count('unassigned', 328));
      await shot('denied-rollback');
      // Repeated failure must restore an already successful in-memory move, too.
      await fetch(`${url}__fixture/deny?value=0`, { method: 'POST' });
      await el('demo-apply').click(); await page.waitForTimeout(800);
      await fetch(`${url}__fixture/deny`, { method: 'POST' });
      await pick('department', 'station-a', 'station-a'); await el('demo-apply').click(); await page.waitForTimeout(800);
      s = await state();
      test('denied subsequent move preserves earlier successful override', s.writes.length === 4 && s.agents[0].department_id === 'station-b' && await el('agent-original-000').count() === 0);
      test('no unexpected mutations', s.unhandled.length === 0, s.unhandled);
      test('document no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      writeFileSync(resolve(out, `${c.name}-state.json`), JSON.stringify(s, null, 2));
      await fetch(`${url}__fixture/reset?populated=1`, { method: 'POST' });
      await navigate();
      test('populated seed aggregate counts', await count('tmai', 3) && await count('tmwork', 3) && await count('stations', 3) && await count('station-a', 3) && await count('unassigned', 326));
      if (c.phone) await el('dept-station-a').click();
      test('populated seed direct members / automatic desktop focus', await el('agent-original-000').count() === 1 && await el('agent-original-002').count() === 1 && await el('agent-original-003').count() === 0 && (c.phone || (await selected('station-a')).weight === '600'));
      await shot('populated-seed');
      await el('adjust-toggle').click(); await el('pick-agent').click(); await el('selector').waitFor();
      await page.keyboard.press('Escape'); await el('selector').waitFor({ state: 'hidden' });
      test('Escape dismisses picker without writes', (await state()).writes.length === 0);
    } catch (e) {
      test('scenario completed', false, e.stack); await shot('failure');
      writeFileSync(resolve(out, `${c.name}-failure.txt`), await page.locator('body').innerText());
    } finally { await context.close(); }
  }
  check('No uncaught App errors', errors.length === 0, errors);
  check('No external browser requests', blocked.length === 0, blocked);
} finally {
  const finalState = await state();
  await browser.close(); await new Promise(r => server.close(r));
  writeFileSync(resolve(out, 'report.json'), JSON.stringify({ results, errors, blocked, screenshots, modulePath, assets: finalState.assets, indexSha256: finalState.indexSha256 }, null, 2));
}
console.log(`${results.filter(r => r.ok).length}/${results.length} checks passed`);
process.exitCode = results.some(r => !r.ok) ? 1 : 0;
