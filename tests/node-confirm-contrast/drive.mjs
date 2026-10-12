// Rendered app + page-local Hub fixture. NOT native IPC or packaged acceptance.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serveExport, initScript, findChromium } from '../test-layout-sweep/harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = process.env.OUT || '/artifacts';
mkdirSync(out, { recursive: true });
const web = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
const fixture = ({ stopped }) => {
  window.__confirmCalls = [];
  const node = { node_id: 'node_confirm_fixture', alias: 'confirm-fixture', runtime: 'opencode-cli',
    status: stopped ? 'offline' : 'idle', lifecycle_state: stopped ? 'stopped' : 'active',
    lifecycle_controllable: true, lifecycle_daemon_node_id: 'node_daemon_fixture',
    config_revision: 0, model: 'stub/model', managed: 'created', adoption: null,
    network_id: 'net-sweep', config_snapshot: { model: 'stub/model' } };
  window.__routeOverride = (u, bodyText) => {
    if (u.pathname === '/api/status') return { ok: true, sessions: [node] };
    if (u.pathname === '/api/nodes') return { ok: true, nodes: [node] };
    if (u.pathname === '/api/nodes/node_confirm_fixture/config') return { ...node, config_update_capable: true };
    if (u.pathname === '/mcp') {
      const params = JSON.parse(bodyText || '{}').params;
      if (!['start_node', 'restart_node', 'stop_node', 'delete_node'].includes(params?.name)) return undefined;
      window.__confirmCalls.push(params);
      return { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] } };
    }
  };
};
function contrast(a, b) {
  const luminance = value => {
    const c = value.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => {
      const s = n / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + .05) / (lo + .05);
}
try {
  for (const theme of ['light', 'dark']) {
    for (const [action, label] of [['start_node', '启动节点'], ['restart_node', '重启节点'], ['stop_node', '停止节点'], ['delete_node', '删除节点']]) {
      const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1200, height: 850 } });
      const page = await ctx.newPage();
      page.setDefaultTimeout(15000);
      const errors = []; page.on('pageerror', e => errors.push(String(e)));
      await page.addInitScript(initScript, { theme });
      await page.addInitScript(value => localStorage.setItem('theme_mode_v1', value), theme);
      await page.addInitScript(fixture, { stopped: action === 'start_node' });
      await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
      await page.waitForFunction(() => !!window.__anetLayoutSweep);
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'nodeDetail', alias: 'confirm-fixture' }));
      await page.getByRole('tab', { name: '危险操作', exact: true }).click();
      const open = () => page.getByRole('button', { name: label, exact: true }).click();
      await open();
      const confirm = page.getByText('确认', { exact: true });
      await confirm.waitFor();
      if (action === 'delete_node') await page.getByPlaceholder('confirm-fixture', { exact: true }).fill('confirm-fixture');
      // RN Modal fades in: measure the fully opaque dialog, not its first frame.
      await page.waitForFunction(() => {
        const text = [...document.querySelectorAll('*')].find(el => el.textContent === '确认' && el.children.length === 0);
        if (!text) return false;
        for (let el = text; el; el = el.parentElement) {
          if (Number(getComputedStyle(el).opacity) !== 1) return false;
          if (el.getAnimations().some(a => a.playState === 'running')) return false;
        }
        return true;
      });
      const style = await confirm.evaluate(el => {
        const text = getComputedStyle(el), button = getComputedStyle(el.parentElement);
        return { color: text.color, background: button.backgroundColor, border: button.borderColor };
      });
      const ratio = contrast(style.color, style.background);
      const expectedBackground = action === 'delete_node'
        ? (theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(24, 24, 27)')
        : (theme === 'light' ? 'rgb(27, 101, 219)' : 'rgb(94, 155, 255)');
      assert.equal(style.background, expectedBackground, `actual rendered theme must be ${theme}`);
      await page.screenshot({ path: join(out, `${theme}-${action}.png`) });
      assert.ok(ratio >= 4.5, `confirm text contrast ${theme}/${action}: ${ratio.toFixed(2)} < 4.5; ${JSON.stringify(style)}`);
      if (action === 'delete_node') assert.equal(style.color, style.border, 'delete keeps destructive outline/text');
      await page.getByText('返回', { exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.__confirmCalls), [], 'cancel must not submit');
      await open();
      if (action === 'delete_node') {
        const button = confirm.locator('..');
        assert.equal(await button.getAttribute('aria-disabled'), 'true');
        await page.getByPlaceholder('confirm-fixture', { exact: true }).fill('wrong-alias');
        assert.equal(await button.getAttribute('aria-disabled'), 'true');
        await page.getByPlaceholder('confirm-fixture', { exact: true }).fill('confirm-fixture');
      }
      await confirm.click();
      await page.waitForFunction(() => window.__confirmCalls.length === 1);
      const args = action === 'start_node'
        ? { node_id: 'node_confirm_fixture', daemon_node_id: 'node_daemon_fixture', network_id: 'net-sweep' }
        : action === 'restart_node' ? { node_id: 'node_confirm_fixture', network_id: 'net-sweep' }
        : action === 'stop_node' ? { child_node_id: 'node_confirm_fixture', network_id: 'net-sweep' }
        : { child_node_id: 'node_confirm_fixture', confirm_alias: 'confirm-fixture', network_id: 'net-sweep' };
      assert.deepEqual(await page.evaluate(() => window.__confirmCalls), [{ name: action, arguments: args }]);
      assert.deepEqual(errors, []);
      console.log(`PASS: ${theme}/${action} contrast=${ratio.toFixed(2)}, cancel has no write, exact confirm payload`);
      await ctx.close();
    }
  }
} finally { await browser.close(); await web.close(); }
