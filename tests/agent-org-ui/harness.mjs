import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startServer } from './server.mjs';

export const cases = ['desktop', 'mobile'].flatMap(device => ['light', 'dark'].map(theme => ({ name: `${device}-${theme}`, theme, phone: device === 'mobile', width: device === 'mobile' ? 390 : 1440, height: device === 'mobile' ? 844 : 1100 })));

export async function run(out, scenario) {
  mkdirSync(out, { recursive: true });
  for (const name of readdirSync(out)) {
    if (/^(desktop|mobile)-(light|dark)-.*\.(png|txt|json)$/.test(name) || name === 'report.json') rmSync(resolve(out, name));
  }
  const modulePath = process.env.PLAYWRIGHT_MODULE || '/Users/vansin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
  const { chromium } = await import(pathToFileURL(modulePath).href);
  const browser = await chromium.launch({ headless: true, executablePath: existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined });
  const { server, url } = await startServer();
  const results = [], screenshots = [], errors = [], blocked = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` ${JSON.stringify(detail)}` : ''}`); };
  const state = async () => (await fetch(`${url}__fixture/state`)).json();
  try {
    for (const c of cases) {
      await fetch(`${url}__fixture/reset`, { method: 'POST' });
      const context = await browser.newContext({ viewport: { width: c.width, height: c.height }, colorScheme: c.theme, locale: 'zh-CN', serviceWorkers: 'block', ...(c.phone ? { hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36' } : {}) });
      await context.route('**/*', route => { if (new URL(route.request().url()).origin !== new URL(url).origin) { blocked.push(route.request().url()); return route.abort(); } return route.continue(); });
      const page = await context.newPage(); page.setDefaultTimeout(5000);
      page.on('pageerror', e => errors.push({ case: c.name, message: e.message }));
      const test = (name, ok, detail) => check(`${c.name} ${name}`, ok, detail);
      const shot = async name => { await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(150); const path = resolve(out, `${c.name}-${name}.png`); await page.screenshot({ path }); screenshots.push(path); };
      const navigate = async category => {
        await page.goto(`${url}?theme=${c.theme}&safeAreaSim=${c.phone ? '32,0,24,0' : '0,0,0,0'}`);
        if (c.phone) await page.getByText('设置', { exact: true }).last().click();
        else await page.locator('[data-testid="desktop-rail"] [aria-label="设置"]').click();
        if (c.phone) await page.getByTestId(`settings-row-${category}`).click();
        else await page.getByTestId('settings-sidebar').getByText(category === 'users' ? '用户管理' : 'Agent 组织架构', { exact: true }).click();
      };
      try { await scenario({ c, page, test, shot, navigate, state, mode: async query => fetch(`${url}__fixture/mode?${query}`, { method: 'POST' }) }); }
      catch (e) { test('scenario completed', false, e.stack); await shot('failure'); writeFileSync(resolve(out, `${c.name}-failure.txt`), await page.locator('body').innerText()); }
      finally { writeFileSync(resolve(out, `${c.name}-state.json`), JSON.stringify(await state(), null, 2)); await context.close(); }
    }
    check('No uncaught App errors', errors.length === 0, errors);
    check('No external requests', blocked.length === 0, blocked);
  } finally {
    const s = await state(); await browser.close(); await new Promise(r => server.close(r));
    writeFileSync(resolve(out, 'report.json'), JSON.stringify({ results, screenshots, errors, blocked, assets: s.assets, indexSha256: s.indexSha256 }, null, 2));
  }
  console.log(`${results.filter(r => r.ok).length}/${results.length} checks passed; ${screenshots.length} screenshots`);
  if (results.some(r => !r.ok)) process.exitCode = 1;
}
