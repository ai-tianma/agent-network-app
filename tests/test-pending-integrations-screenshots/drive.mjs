// Screenshots for Hub / Daemon / Node pending-integration shells.
// Hub and Daemon keep the SKILLS / 令牌 / Provider tabs. The node page keeps its
// section list and shows the key demo under 密钥, with the shared demo banner.
//   WEB_DIR=<expo web export> OUT=/opt/cursor/artifacts node tests/test-pending-integrations-screenshots/drive.mjs
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, TEST_LOCALE } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '/opt/cursor/artifacts';
mkdirSync(OUT, { recursive: true });

const hostSupervisorStub = () => {
  window.__routeOverride = (u, bodyText, method) => {
    if (u.pathname === '/api/nodes') {
      const base = [
        { node_id: 'd_sweep_1', alias: '示例-守护', role: 'host_supervisor', lifecycle_state: 'running', lifecycle_controllable: true, runtime: 'codex-app-server', hostname: 'host-d', config_revision: 1, config_snapshot: { model: 'model-x', role: 'host_supervisor' } },
        { node_id: 'n_sweep_a', alias: '示例-A', lifecycle_state: 'running', lifecycle_controllable: true, runtime: 'agent-node', hostname: 'host-a', config_revision: 1, config_snapshot: { model: 'model-x' } },
        { node_id: 'n_sweep_b', alias: '示例-B', lifecycle_state: 'running', lifecycle_controllable: true, runtime: 'agent-node', hostname: 'host-b', config_revision: 1, config_snapshot: { model: 'model-x' } },
      ];
      return { ok: true, nodes: base, count: base.length };
    }
    if (u.pathname === '/api/status' && !u.searchParams.get('light')) {
      const now = new Date().toISOString();
      const sessions = [
        { alias: '示例-守护', status: 'idle', agent: 'codex', runtime: 'codex-app-server', node_id: 'd_sweep_1', hostname: 'host-d', updated_at: now, skills_capable: false },
        { alias: '示例-A', status: 'idle', agent: 'claude-code', runtime: 'agent-node', node_id: 'n_sweep_a', hostname: 'host-a', updated_at: now, rules_file_capable: true, skills_capable: true, files_capable: true },
        { alias: '示例-B', status: 'working', agent: 'codex', runtime: 'agent-node', node_id: 'n_sweep_b', hostname: 'host-b', updated_at: now, task: '示例任务', skills_capable: false },
      ];
      return { ok: true, sessions, files_capable: true };
    }
    return undefined;
  };
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ executablePath: findChromium(), headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: 'dark',
  locale: TEST_LOCALE,
});
const page = await ctx.newPage();
await page.addInitScript(initScript, { theme: 'dark' });
await page.addInitScript(hostSupervisorStub);
await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 30000 });

const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`saved ${OUT}/${name}.png`);
};

// Hub — sidebar tabs + main pane (one per tab). The banner stays on every panel.
await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'server' }));
await page.locator('[data-testid="server-sidebar"]').waitFor({ timeout: 15000 });
for (const tab of ['skills', 'tokens', 'provider']) {
  await page.locator(`[data-testid="server-pending-tabs-${tab}"]`).click();
  await page.locator('[data-testid="hub-pending-screen"]').waitFor({ timeout: 10000 });
  await page.locator('[data-testid="backend-pending-banner"]').waitFor({ timeout: 10000 });
  await shot(`hub-pending-${tab}`);
}

// Daemon management — the same three tabs live in the settings sidebar.
await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'chat', alias: '示例-守护' }));
await page.locator('[data-testid="daemon-management"]').waitFor({ timeout: 15000 });
for (const tab of ['skills', 'tokens', 'provider']) {
  await page.locator(`[data-testid="daemon-section-tabs-${tab}"]`).click();
  await page.locator('[data-testid="daemon-pending-shell"]').waitFor({ timeout: 10000 });
  await page.locator('[data-testid="backend-pending-banner"]').waitFor({ timeout: 10000 });
  await shot(`daemon-pending-${tab}`);
}

// Node — section list stays; the key demo is the 密钥 section, not a second tab set.
await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'nodeDetail', alias: '示例-A' }));
await page.locator('[data-testid="node-section-nav"]').waitFor({ timeout: 15000 });
await page.locator('[data-testid="node-section-nav"]').getByText('密钥', { exact: true }).click();
await page.locator('[data-testid="node-secret-demo"]').waitFor({ timeout: 10000 });
await page.locator('[data-testid="backend-pending-banner"]').waitFor({ timeout: 10000 });
await shot('node-pending-secrets');

await browser.close();
await web.close();
console.log('done');
