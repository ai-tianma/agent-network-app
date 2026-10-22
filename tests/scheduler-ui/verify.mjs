import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { startServer } from './server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, 'artifacts');
mkdirSync(out, { recursive: true });
const require = createRequire(import.meta.url);
let modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) {
  try { modulePath = require.resolve('playwright'); } catch {
    modulePath = [
      `${process.env.HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`,
      `${process.env.HOME}/code/chat-ui/node_modules/playwright/index.mjs`,
    ].find(existsSync);
  }
}
if (!modulePath) throw new Error('Set PLAYWRIGHT_MODULE to an existing playwright/index.mjs; no installation is performed.');
const { chromium } = await import(pathToFileURL(resolve(modulePath)).href);
const executablePath = process.env.CHROME_PATH || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
// Wait for the other agent's export; never invoke a build or test an old bundle silently.
const dist = resolve(here, '../../dist');
const deadline = Date.now() + Number(process.env.BUILD_WAIT_MS || 180000);
let buildReady = false;
do {
  try {
    const html = readFileSync(resolve(dist, 'index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => readFileSync(resolve(dist, `.${m[1]}`), 'utf8'));
    buildReady = scripts.some(s => s.includes('schedule-node-picker-search-clear'));
  } catch { /* Export may be replacing its output directory. */ }
  if (buildReady) break;
  await new Promise(r => setTimeout(r, 2000));
} while (Date.now() < deadline);
if (!buildReady) throw new Error('Compiled node picker redesign is not ready in dist. Wait for the main build and rerun; no build was started.');
for (const name of readdirSync(out)) {
  if (/^(desktop|mobile)-(light|dark)-.*\.(png|txt|html|json)$/.test(name) || name === 'report.json') rmSync(resolve(out, name));
}
const { server, url } = await startServer();
const results = [], errors = [], blocked = [], screenshots = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${JSON.stringify(detail)}` : ''}`); };
const tid = id => `[data-testid="${id}"]`;
const browser = await chromium.launch({ headless: true, executablePath });
const cases = [
  { name: 'desktop-light', width: 1440, height: 1000, theme: 'light' },
  { name: 'desktop-dark', width: 1440, height: 1000, theme: 'dark' },
  { name: 'mobile-light', width: 390, height: 844, theme: 'light', phone: true },
  { name: 'mobile-dark', width: 390, height: 844, theme: 'dark', phone: true },
];
try {
  for (const c of cases) {
    await fetch(`${url}__fixture/reset`, { method: 'POST' });
    const context = await browser.newContext({ viewport: { width: c.width, height: c.height }, colorScheme: c.theme, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', serviceWorkers: 'block', ...(c.phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36', hasTouch: true } : {}) });
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== new URL(url).origin) { blocked.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push({ case: c.name, error: e.message }));
    const shot = async suffix => {
      await page.mouse.move(c.width - 5, c.height - 5);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      const path = resolve(out, `${c.name}-${suffix}.png`); await page.screenshot({ path }); screenshots.push(path);
    };
    try {
      await page.goto(`${url}?theme=${c.theme}`);
      const nav = c.phone ? page.getByText('定时任务', { exact: true }).first() : page.locator('[data-testid="desktop-rail"] [aria-label*="定时"]').first();
      await nav.click({ timeout: 30000 });
      await page.locator(tid('schedule-row-daily')).waitFor();
      check(`${c.name} active filter / two rows`, await page.locator('[data-testid^="schedule-row-"]').count() === 2);
      const attrs = el => el.evaluate(e => Object.fromEntries([...e.attributes].map(a => [a.name, a.value])));
      check(`${c.name} active filter selected`, await page.locator(tid('schedule-filter-active')).getAttribute('aria-selected') === 'true', await attrs(page.locator(tid('schedule-filter-active'))));
      for (const [status, count] of [['all', 5], ['active', 2], ['paused', 1], ['completed', 1], ['cancelled', 1]]) {
        check(`${c.name} ${status} count`, (await page.locator(tid(`schedule-filter-${status}`)).innerText()).trim().endsWith(String(count)));
      }
       await shot('list');
       const verifyPicker = async (dense = false) => {
         const prefix = `${c.name} ${dense ? 'dense ' : ''}picker`;
         const picker = page.locator(tid('schedule-node-picker'));
         const search = page.locator(tid('schedule-node-picker-search'));
         const all = page.locator(tid('schedule-node-option-all'));
         const options = picker.locator('[data-testid^="schedule-node-option-"]');
         const open = async () => {
           await page.locator(tid('schedule-search-node')).click();
           await picker.waitFor({ state: 'visible' });
           await page.waitForTimeout(300);
         };
         const checked = async id => {
           const row = page.locator(tid(id));
            return await row.getAttribute('role') === 'radio' && await row.getAttribute('aria-checked') === 'true';
         };
         await open();
         const panelBox = await picker.boundingBox();
         const searchBox = await search.locator('..').boundingBox();
         check(`${prefix} compact search <65px`, searchBox?.height > 0 && searchBox.height < 65, searchBox);
         check(`${prefix} dialog contained / desktop <=440x560`, panelBox && panelBox.x >= 0 && panelBox.y >= 0 && panelBox.x + panelBox.width <= c.width + 1 && panelBox.y + panelBox.height <= c.height + 1 && (c.phone || (panelBox.width <= 441 && panelBox.height <= 561)), panelBox);
         check(`${prefix} all radio selected / total count`, await checked('schedule-node-option-all') && await all.getAttribute('aria-label') === `全部节点，${dense ? 49 : 5} 个计划`);
         check(`${prefix} option count`, await options.count() === (dense ? 47 : 3), await options.count());
         await shot(dense ? 'node-picker-dense' : 'node-picker');
         if (dense) {
           for (const id of ['node-dense-00', 'node-dense-01']) {
             const row = page.locator(tid(`schedule-node-option-${id}`));
             check(`${prefix} duplicate label exposes ${id}`, (await row.innerText()).includes(id) && (await row.getAttribute('aria-label')).includes(id));
           }
           const pinnedBefore = await all.boundingBox();
           const last = page.locator(tid('schedule-node-option-node-dense-43'));
           await last.scrollIntoViewIfNeeded();
           const pinnedAfter = await all.boundingBox();
           const lastBox = await last.boundingBox();
           const scroll = await last.evaluate(el => {
             for (let p = el.parentElement; p; p = p.parentElement) {
               if (p.scrollHeight > p.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(p).overflowY)) return { top: p.scrollTop, height: p.clientHeight, content: p.scrollHeight };
             }
             return null;
           });
           check(`${prefix} many rows scroll / all stays pinned`, scroll?.top > 0 && Math.abs(pinnedAfter.y - pinnedBefore.y) < 1 && lastBox.y >= panelBox.y && lastBox.y + lastBox.height <= panelBox.y + panelBox.height + 1, { scroll, pinnedBefore, pinnedAfter, lastBox });
           await shot('node-picker-dense-scrolled');
           await search.fill('long-alias-');
           await page.locator(tid('schedule-node-option-node-dense-02')).waitFor();
           check(`${prefix} long alias stays contained`, await picker.evaluate(el => [...el.querySelectorAll('*')].every(e => { const r = e.getBoundingClientRect(), p = el.getBoundingClientRect(); return !r.width || (r.left >= p.left - 1 && r.right <= p.right + 1); })));
           await shot('node-picker-long-alias');
         }
         await search.fill('demo-reporter');
         await page.locator(tid('schedule-node-option-node-fixture-b')).waitFor();
         check(`${prefix} alias search / all pinned`, await options.count() === 2 && await all.isVisible());
         await search.fill('node-fixture-a');
         await page.locator(tid('schedule-node-option-node-fixture-a')).waitFor();
         check(`${prefix} node ID search`, await options.count() === 2);
         await page.locator(tid('schedule-node-picker-search-clear')).click();
         check(`${prefix} clear restores options`, await search.inputValue() === '' && await options.count() === (dense ? 47 : 3));
         await search.fill('no-such-fixture-node-xyz');
         await picker.getByText('没有匹配的节点', { exact: true }).waitFor();
         check(`${prefix} no results / all still available`, await options.count() === 1 && await all.isVisible());
         await shot(dense ? 'node-picker-dense-empty' : 'node-picker-empty');
         await page.locator(tid('schedule-node-picker-search-clear')).click();
          await page.locator(tid('schedule-node-option-node-fixture-b')).focus();
          await page.keyboard.press('Space');
         await picker.waitFor({ state: 'hidden' });
         await page.locator(tid('schedule-row-weekly')).waitFor();
         check(`${prefix} selection closes / one active row`, await page.locator('[data-testid^="schedule-row-"]').count() === 1);
          for (const [status, count] of [['all', 1], ['active', 1], ['paused', 0], ['completed', 0], ['cancelled', 0]]) {
            const chip = page.locator(tid(`schedule-filter-${status}`));
            const absentTerminal = count === 0 && ['completed', 'cancelled'].includes(status) && await chip.count() === 0;
            check(`${prefix} selected ${status} count`, absentTerminal || (await chip.innerText()).trim().endsWith(String(count)));
         }
         await open();
         check(`${prefix} reopen remembers single radio`, await checked('schedule-node-option-node-fixture-b') && await picker.locator('[role="radio"][aria-checked="true"]').count() === 1 && await search.inputValue() === '');
         await shot(dense ? 'node-picker-dense-selected' : 'node-picker-selected');
          await all.focus();
          await page.keyboard.press('Enter');
         await picker.waitFor({ state: 'hidden' });
         await page.locator(tid('schedule-row-daily')).waitFor();
         check(`${prefix} all resets active rows / counts`, await page.locator('[data-testid^="schedule-row-"]').count() === 2 && (await page.locator(tid('schedule-filter-all')).innerText()).trim().endsWith(String(dense ? 49 : 5)));
         await open();
         check(`${prefix} reset remembered`, await checked('schedule-node-option-all'));
         await all.click();
         await picker.waitFor({ state: 'hidden' });
       };
       await verifyPicker();
      if (c.phone) await page.locator(tid('schedule-row-daily')).getByRole('button').click();
      await page.locator(tid('schedule-detail')).waitFor();
      check(`${c.name} initial detail`, (await page.locator(tid('schedule-detail')).innerText()).includes('Daily node inspection'));
      for (const id of ['schedule-next-execution', 'schedule-last-execution']) {
        const el = page.locator(tid(id));
        const box = await el.boundingBox();
        check(`${c.name} ${id} visible / contained`, !!box && box.x >= 0 && box.x + box.width <= c.width + 1 && box.y >= 0 && box.y + box.height <= c.height + 1, { box, text: await el.innerText() });
      }
      await page.locator(tid('schedule-run-daily-done')).waitFor();
      check(`${c.name} fixture run states`, (await page.locator(tid('schedule-run-status-daily-done')).innerText()) === '已完成' && (await page.locator(tid('schedule-run-status-daily-failed')).innerText()) === '失败');
      await shot('detail');
      await page.locator(tid('schedule-run-toggle-daily-done')).click();
      await page.locator(tid('schedule-run-reply')).waitFor();
      check(`${c.name} expanded run result`, (await page.locator(tid('schedule-run-reply')).innerText()).includes('Fixture inspection complete'));
      await page.locator(tid('schedule-run-reply')).scrollIntoViewIfNeeded();
      await shot('result');
      if (c.phone) await page.getByRole('button', { name: '返回定时任务', exact: true }).click();
      else {
        await page.locator(tid('schedule-row-weekly')).getByRole('button').click();
        check(`${c.name} selection updates detail`, (await page.locator(tid('schedule-detail')).innerText()).includes('Weekly team digest'));
        check(`${c.name} selection accessibility`, await page.locator(tid('schedule-row-weekly')).getByRole('button').getAttribute('aria-selected') === 'true');
      }
      for (const [status, title] of [['paused', 'Paused backup audit'], ['completed', 'Completed release check'], ['cancelled', 'Cancelled legacy report']]) {
        await page.locator(tid(`schedule-filter-${status}`)).click();
        check(`${c.name} filter ${status}`, await page.locator('[data-testid^="schedule-row-"]').count() === 1 && (await page.locator(tid(`schedule-row-${status}`)).innerText()).includes(title));
      }
      await page.locator(tid('schedule-filter-all')).click();
      check(`${c.name} all filter / five rows`, await page.locator('[data-testid^="schedule-row-"]').count() === 5);
      const sw = page.getByRole('switch', { name: '暂停 Daily node inspection', exact: true });
      check(`${c.name} switch has accessible name and keyboard focus`, await sw.getAttribute('tabindex') === '0');
      check(`${c.name} switch accessible / checked`, await sw.getAttribute('aria-checked') === 'true' && await sw.getAttribute('tabindex') === '0', await attrs(sw));
      await sw.focus(); await page.keyboard.press('Space');
      const resumed = page.getByRole('switch', { name: '恢复 Daily node inspection', exact: true });
      await resumed.waitFor({ timeout: 1500 }).catch(() => {});
      check(`${c.name} keyboard Space toggles switch`, await resumed.count() > 0);
      if (!(await resumed.count())) await sw.click();
      await resumed.waitFor();
      check(`${c.name} switch click updates checked state`, await resumed.getAttribute('aria-checked') === 'false', await attrs(resumed));
      const state = await (await fetch(`${url}__fixture/state`)).json();
       check(`${c.name} one local revision-checked PATCH`, state.writes.length === 1 && state.writes[0].body.status === 'paused' && state.writes[0].body.revision === 1, state.writes);
       await resumed.focus();
       await page.keyboard.down('Enter');
       await page.waitForTimeout(700);
       await page.keyboard.up('Enter');
       await sw.waitFor();
       const enterState = await (await fetch(`${url}__fixture/state`)).json();
       check(`${c.name} held Enter toggles exactly once`, enterState.writes.length === 2 && enterState.writes[1].body.status === 'active' && enterState.writes[1].body.revision === 2, enterState.writes);
      check(`${c.name} no unexpected writes`, state.unhandled.length === 0, state.unhandled);
      check(`${c.name} no horizontal document overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await shot('all-toggled');
      writeFileSync(resolve(out, `${c.name}-requests.json`), JSON.stringify(state, null, 2));
      await page.goto(`${url}?theme=${c.theme}&scheduler=1`);
      await page.locator(tid('schedule-row-weekly')).waitFor();
       check(`${c.name} preview shortcut opens real scheduler`, true);
       await fetch(`${url}__fixture/reset?dense=1`, { method: 'POST' });
       await page.reload();
       await page.locator(tid('schedule-row-weekly')).waitFor();
       await verifyPicker(true);
       const denseState = await (await fetch(`${url}__fixture/state`)).json();
       check(`${c.name} dense picker read-only`, denseState.writes.length === 0 && denseState.unhandled.length === 0, denseState.writes);
       writeFileSync(resolve(out, `${c.name}-dense-requests.json`), JSON.stringify(denseState, null, 2));
    } catch (e) {
      check(`${c.name} completed`, false, e.stack);
      await shot('failure');
      writeFileSync(resolve(out, `${c.name}-failure.txt`), await page.locator('body').innerText());
      writeFileSync(resolve(out, `${c.name}-failure.html`), await page.content());
    } finally { await context.close(); }
  }
  check('No uncaught App errors', errors.length === 0, errors);
  check('No attempted external browser requests', blocked.length === 0, blocked);
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
  writeFileSync(resolve(out, 'report.json'), JSON.stringify({ results, errors, blocked, screenshots, modulePath, executablePath }, null, 2));
}
console.log(`${results.filter(r => r.ok).length}/${results.length} checks passed. Artifacts: ${out}`);
process.exitCode = results.some(r => !r.ok) ? 1 : 0;
