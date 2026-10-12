// Rendered production Expo web export + page-local Hub/Tauri fixture.
// This is NOT a real Hub/daemon/native-app end-to-end test.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, TEST_LOCALE, ANDROID_UA } from '../test-layout-sweep/harness.mjs';
const source = process.env.SOURCE_COMMIT || process.env.GITHUB_SHA;
assert.match(source ?? '', /^[0-9a-f]{40}$/);
if (process.env.SOURCE_COMMIT) assert.equal(source, process.env.EXPECTED_SOURCE_COMMIT);
console.log(`source=${source}`);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
mkdirSync(process.env.OUT || '/artifacts', { recursive: true });
const daemon = { daemon_node_id: 'd_fixture', alias: 'daemon-fixture', hostname: 'host-fixture', online: true,
  runtimes_supported: ['opencode-cli', 'codex-app-server'], can_create_nodes: true };
const fixture = () => {
  window.__createCalls = []; window.__proof = null; window.__failure = false; window.__oldHub = false; window.__childStatus = 'idle';
  window.__routeOverride = (u, bodyText) => {
    if (u.pathname === '/mcp') {
      const params = JSON.parse(bodyText || '{}')?.params;
      if (params?.name !== 'create_node') return undefined;
      window.__createCalls.push(params.arguments);
      return { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(window.__oldHub
        ? { ok: false, error: 'flag_key_unknown', field: 'opencodeGeneration' }
        : { ok: true, request_id: 'cr_fixture' }) }] } };
    }
    if (u.pathname === '/api/node-create-requests') {
      const spec = window.__createCalls.at(-1)?.node_spec;
      return { ok: true, request: { request_id: 'cr_fixture', child_name: spec?.name, runtime: spec?.runtime,
        child_node_id: 'node_fixture', status: window.__failure ? 'runtime_capability_check_failed' : 'succeeded',
        error: window.__failure ? 'fixture late launch failure' : null, launch_verified_at: window.__proof } };
    }
    if (u.pathname === '/api/status') {
      const spec = window.__createCalls.at(-1)?.node_spec;
      // Match Hub's real contract: unfiltered light rows omit node_id.
      return { sessions: spec ? [{ alias: spec.name,
        ...(u.searchParams.get('light') === '1' ? {} : { node_id: 'node_fixture' }),
        status: window.__childStatus, runtime: spec.runtime, network_id: 'net-sweep' }] : [] };
    }
  };
};
const next = page => page.getByTestId('create-node-next').click();
async function open(page) {
  await page.evaluate(() => { window.__createCalls = []; window.__proof = null; window.__failure = false; window.__oldHub = false; window.__childStatus = 'idle'; });
  await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'agents' }));
  await page.evaluate(d => window.__anetLayoutSweep.setScreen({ name: 'wizard', daemon: d }), daemon);
  await page.getByTestId('create-name-input').fill('v2-fixture'); await next(page);
  await page.getByTestId('runtime-row-opencode-cli').click();
}
async function chooseV2(page) {
  await page.getByTestId('opencode-generation-v2').click();
  assert.equal(await page.getByTestId('opencode-v2-consent').getAttribute('aria-checked'), 'false');
  assert.equal(await page.getByTestId('create-node-next').isDisabled(), true);
  await page.getByTestId('opencode-v2-consent').click();
  assert.equal(await page.getByTestId('create-node-next').isDisabled(), false);
}
async function confirmV2(page) {
  await chooseV2(page); await next(page);
  await page.getByTestId('opencode-v2-model').fill('stub/model'); await next(page);
  await page.getByTestId('opencode-v2-confirm-warning').waitFor();
}
async function submit(page) {
  await page.getByTestId('create-node-submit').click();
  await page.waitForFunction(() => window.__createCalls.length === 1);
  return page.evaluate(() => window.__createCalls[0].node_spec);
}
try {
  for (const mobile of [false, true]) for (const theme of ['light', 'dark']) {
    const tag = `${mobile ? 'phone' : 'desktop'}-${theme}`;
    const ctx = await browser.newContext({ locale: TEST_LOCALE, colorScheme: theme,
      viewport: mobile ? { width: 390, height: 844 } : { width: 1200, height: 850 },
      ...(mobile ? { userAgent: ANDROID_UA, isMobile: true, hasTouch: true } : {}) });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(initScript, { theme }); await page.addInitScript(fixture);
    await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
    await page.waitForFunction(() => !!window.__anetLayoutSweep);
    await open(page);
    assert.equal((await page.getByTestId('runtime-row-opencode-cli').innerText()).includes('TUI 共存'), false,
      'shared OpenCode runtime label must not promise TUI copresence for V1');
    assert.equal(await page.getByTestId('opencode-generation-v1').innerText(), 'V1（兼容默认 · headless）');
    assert.match(await page.getByTestId('opencode-v1-mode-note').innerText(), /不请求 TUI 共存/);
    assert.equal(await page.getByTestId('opencode-generation-v1').getAttribute('aria-checked'), 'true');
    await chooseV2(page);
    assert.equal(await page.getByTestId('opencode-v1-mode-note').count(), 0);
    await page.getByTestId('opencode-generation-v1').click(); await chooseV2(page);
    await page.getByTestId('runtime-row-codex-app-server').click();
    await page.getByTestId('runtime-row-opencode-cli').click();
    assert.equal(await page.getByTestId('opencode-generation-v1').getAttribute('aria-checked'), 'true');
    await chooseV2(page);
    await page.getByTestId('opencode-v2-consent').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.OUT}/${tag}-consent.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await next(page);
    await page.getByTestId('opencode-v2-model').fill('bad/model/extra');
    assert.equal(await page.getByTestId('create-node-next').isDisabled(), true);
    await page.getByTestId('opencode-v2-model').fill('stub/model'); await next(page);
    await page.getByTestId('opencode-v2-confirm-warning').waitFor();
    // Hub returns working verbatim when a new node immediately starts a task.
    // Cover both states across the rendered matrix; proof remains required.
    await page.evaluate(status => { window.__childStatus = status; }, mobile ? 'working' : 'idle');
    const spec = await submit(page);
    assert.deepEqual(spec.flags, { opencodeGeneration: 'v2', opencodeUnsafeTools: true });
    assert.equal(spec.model, 'stub/model'); assert.equal(spec.runtime, 'opencode-cli');
    assert.equal('opencodeGeneration' in spec, false);
    // Real UI poll runs. Registration plus matching roster is insufficient for V2.
    await page.waitForTimeout(3300);
    assert.equal(await page.getByText('✓ v2-fixture 已上线', { exact: true }).count(), 0);
    await page.evaluate(() => { window.__failure = true; });
    await page.getByText(/fixture late launch failure/).first().waitFor({ timeout: 7000 });
    assert.equal(await page.getByText('✓ v2-fixture 已上线', { exact: true }).count(), 0);
    console.log(`PASS ${tag}: default V1, consent/reset, model gate, exact V2 payload, no early success, late failure`);
    await open(page); await confirmV2(page); await submit(page);
    await page.evaluate(() => { window.__proof = Date.now(); });
    await page.getByText('✓ v2-fixture 已上线', { exact: true }).waitFor({ timeout: 7000 });
    console.log(`PASS ${tag}: explicit proof + matching registered live identity succeeds`);
    if (!mobile && theme === 'light') {
      await open(page); await confirmV2(page); await submit(page);
      // Slow successful reads must not multiply the advertised 45s window
      // by the poll count. Keep proof absent until after the UI deadline.
      await page.evaluate(() => { window.__stubDelayMs = 2000; });
      await page.getByText(/45s 内未确认本次启动检查/).waitFor({ timeout: 48000 });
      assert.equal(await page.getByText(/正在确认 v2-fixture 启动/).count(), 0);
      await page.evaluate(() => { window.__stubDelayMs = 0; window.__proof = Date.now(); });
      await page.waitForTimeout(5000);
      assert.equal(await page.getByText('✓ v2-fixture 已上线', { exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => window.__createCalls.length), 1);
      console.log(`PASS ${tag}: wall-clock deadline stops slow polls; late proof cannot revive UI or resubmit`);
    }
    await open(page); await confirmV2(page);
    await page.evaluate(() => { window.__oldHub = true; }); await submit(page);
    await page.getByText(/不会自动改为 V1/).first().waitFor();
    assert.equal(await page.evaluate(() => window.__createCalls.length), 1);
    console.log(`PASS ${tag}: old Hub rejection displayed, no automatic downgrade/retry`);
    await open(page); await next(page); await next(page); const v1 = await submit(page);
    assert.equal(v1.flags?.opencodeGeneration, undefined); assert.equal(v1.flags?.opencodeUnsafeTools, undefined);
    await page.getByText('✓ v2-fixture 已上线', { exact: true }).waitFor({ timeout: 7000 });
    await open(page); await chooseV2(page);
    await page.getByTestId('runtime-row-codex-app-server').click(); await next(page);
    const codex = await submit(page);
    assert.deepEqual(codex.flags, {
      copresence: true,
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
      skipGitRepoCheck: true,
      copresenceFullAccess: true,
    });
    console.log(`PASS ${tag}: V1 completion; OpenCode consent does not leak; Codex carries copresence + yolo defaults`);
    if (tag === 'desktop-light') {
      await open(page);
      await page.getByTestId('runtime-row-codex-app-server').click();
      const consent = page.getByTestId('codex-auto-execute-consent');
      await consent.waitFor();
      if (await consent.getAttribute('aria-checked') === 'true') await consent.click();
      assert.equal(await consent.getAttribute('aria-checked'), 'false');
      await next(page);
      const codexNoYolo = await submit(page);
      assert.deepEqual(codexNoYolo.flags, { copresence: true });
      console.log(`PASS ${tag}: Codex with auto-exec off sends only copresence`);
    }
    assert.deepEqual(errors, []); await ctx.close();
  }
  console.log('PASS rendered V2 creation UI; fixture Hub only, no native app or production acceptance');
} finally { await browser.close(); await web.close(); }
