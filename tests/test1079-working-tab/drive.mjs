// Real exported UI, synthetic read-only Hub status. No real accounts or models.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
mkdirSync('/evidence', { recursive: true });
try {
  for (const [name, viewport, userAgent] of [
    ['desktop', { width: 1440, height: 900 }, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15'],
    ['phone', { width: 390, height: 844 }, ANDROID_UA],
  ]) {
    const ctx = await browser.newContext({ viewport, userAgent, locale: 'zh-CN' });
    const page = await ctx.newPage();
    await page.route('**/*', route => new URL(route.request().url()).host === new URL(web.url).host ? route.continue() : route.abort());
    await page.addInitScript(initScript, { theme: 'light' });
    await page.addInitScript(() => {
      localStorage.setItem('anet.language.v1', 'zh');
      localStorage.removeItem('agent_list_tab_v1');
      localStorage.removeItem('agent_list_collapsed_v1');
      window.__workingStatus = 'working';
      window.__routeOverride = u => u.pathname === '/api/status' ? { ok: true, sessions: [
        { alias: '示例/执行', status: window.__workingStatus, node_id: 'n_working_fixture', updated_at: new Date().toISOString() },
        { alias: '示例/空闲', status: 'idle', task: 'old task', queue_depth: 2, node_id: 'n_idle_fixture' },
        { alias: '示例/离线', status: 'offline', node_id: 'n_offline_fixture' },
      ] } : undefined;
    });
    await page.goto(web.url);
    const tab = page.getByTestId('conversation-tab-working');
    await tab.waitFor({ timeout: 30000 });
    await tab.click();
    await page.getByTestId('agent-row-示例/执行').waitFor();
    assert.equal(await page.getByTestId('agent-row-示例/空闲').count(), 0);
    assert.equal(await page.getByTestId('agent-row-示例/离线').count(), 0);
    const b = await tab.boundingBox();
    assert.ok(b && b.x >= 0 && b.x + b.width <= viewport.width && b.height >= 28);
    await page.screenshot({ path: `/evidence/${name}-working.png` });
    // Existing status polling drives the transition; no reload or new task.
    await page.evaluate(() => { window.__workingStatus = 'idle'; });
    await page.getByTestId('agents-empty-working').waitFor({ timeout: 25000 });
    await page.getByTestId('agents-empty-working-show-all').click();
    await page.getByTestId('agent-row-示例/空闲').waitFor();
    console.log(`${name}: visible tab + active-only rows + live completion + show all PASS`);
    await ctx.close();
  }
} finally {
  await browser.close();
  await web.close();
}
