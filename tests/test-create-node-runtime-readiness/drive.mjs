// 新建节点:每台机器 × 每个 runtime 的真实可用性(app 看板 #623;数据契约 agent-network PR #2429 / 看板 #622)。
// web export + tests/test-layout-sweep 的页内 Tauri 桩,不起 hub、不占端口、不碰 HOME;nothing touches 127.0.0.1:9200。
// 占位数据:daemon-example / host-example(报了 runtime_readiness,五种情形混着)+ daemon-legacy / host-legacy(旧 daemon,没这个键)。
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [SHOT_TAG=after] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] \
//     node tests/test-create-node-runtime-readiness/drive.mjs
//
// 视口 桌面 1200×850 / 手机 390×844 × 主题 浅 / 深:
//   选服务器
//     (1) daemon-example 卡片:每个 runtime 一颗胶囊,✓ / ✗ / ? 与 state 一致;「可建节点」那一行被胶囊排替掉
//     (2) 原因:桌面悬停 ✗ 胶囊 → 提示条,写着 hub 给的原因;手机点按 → 胶囊排下面展开同一句,再点收起
//     (3) 🔴 旧 daemon(没 runtime_readiness):和以前一样 —— 没有胶囊排、「可建节点」行还在、runtime 名 chip 还在
//     (4) 几何:每颗胶囊都在自己的卡片里(左右不出界),卡片在视口里,页面没有横向滚动(手机 390 尤其)
//   向导 Runtime 步
//     (5) 🔴 建不了的 runtime(missing_cli / not_logged_in)禁用:点了选不中、选中的仍是原来那个;名字下面写着原因+修法
//     (6) 未检测(hub unknown)仍可选,带「未检测」;共用登录 → 「与 3 个节点共用登录」,仍可选
//     (7) 初始 runtime 是第一个能用的
//     (8) 🔴 旧 daemon:没有任何原因 / 未检测行,声明支持的 runtime 都能选(和以前一样)
// 任一断言失败或页面打不开 → exit 1。先对改动前的 export 跑:必须红。
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA, TEST_LOCALE } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
const TAG = process.env.SHOT_TAG || 'after';
if (OUT) mkdirSync(OUT, { recursive: true });

const CHECKED = '2026-10-06T03:00:00.000Z';
const REASON_GROK = '这台机器没装 grok：在该机器上安装 grok CLI 后再试';
const REASON_CODEX = 'codex 没登录：在该机器 CODEX_HOME 下 codex login --device-auth';
const MIXED = {
  daemon_node_id: 'd_example_1', alias: 'daemon-example', hostname: 'host-example', online: true, last_seen_at: new Date().toISOString(),
  runtimes_supported: ['claude-agent-sdk', 'codex-sdk', 'grok-build-acp', 'claude-code-cli', 'codex-app-server'],
  can_create_nodes: true, create_capability_observed_ms_ago: 1000,
  runtime_readiness: {
    'claude-agent-sdk': { ok: true, state: 'ready', reason: '可以创建', checked_at: CHECKED, version: '0.0.0', cli: 'bundled', auth: 'present', network: 'reachable' },
    'codex-sdk': { ok: false, state: 'not_logged_in', reason: REASON_CODEX, checked_at: CHECKED, cli: 'found', auth: 'absent' },
    'grok-build-acp': { ok: false, state: 'missing_cli', reason: REASON_GROK, checked_at: CHECKED, cli: 'missing' },
    'claude-code-cli': { ok: false, state: 'unknown', reason: '检测超时', checked_at: CHECKED },
    'codex-app-server': { ok: true, state: 'ready', reason: '可以创建', checked_at: CHECKED, cli: 'found', auth: 'present', shared_login_count: 3 },
  },
};
const LEGACY = {
  daemon_node_id: 'd_legacy_1', alias: 'daemon-legacy', hostname: 'host-legacy', online: true, last_seen_at: new Date().toISOString(),
  runtimes_supported: ['claude-agent-sdk', 'grok-build-acp'], can_create_nodes: true, create_capability_observed_ms_ago: 1000,
};
const EXPECT_ICON = { 'claude-agent-sdk': '✓', 'codex-sdk': '✗', 'grok-build-acp': '✗', 'claude-code-cli': '?', 'codex-app-server': '✓' };

// 选服务器页的三档验收尺寸(admin 2026-10-21):手机 390×844 / 窄桌面 1000×700 / 桌面 1200×800。
const VIEWPORTS = [
  { name: 'phone-390x844', w: 390, h: 844, mobile: true },
  { name: 'desktop-1000x700', w: 1000, h: 700, desktop: true },
  { name: 'desktop-1200x800', w: 1200, h: 800, desktop: true },
];
const THEMES = ['light', 'dark'];

// 中性灰 vs 红:admin 2026-10-21 明确不可用要灰、不要红。颜色按 rgb 通道差判,不锁具体色值。
const rgb = (s) => (s || '').match(/\d+/g)?.slice(0, 3).map(Number) || null;
const isRed = (s) => { const c = rgb(s); return !!c && c[0] - Math.max(c[1], c[2]) > 30; };
const isGrey = (s) => { const c = rgb(s); return !!c && Math.max(...c) - Math.min(...c) <= 24; };

let fails = 0;
const ck = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`); };

const fixtureScript = ({ daemons }) => {
  window.__routeOverride = (u) => (u.pathname === '/api/host-supervisors' ? { ok: true, count: daemons.length, daemons } : undefined);
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
const settle = (page, ms = 250) => page.waitForTimeout(ms);
const q = (id) => `[data-testid="${id}"]`;
const visible = async (page, id) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, q(id));
const textOf = (page, id) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, q(id));
const runtimeRow = (page, id) => page.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e) return null;
  return { disabled: e.getAttribute('aria-disabled') === 'true', checked: e.getAttribute('aria-checked') === 'true', text: e.textContent || '' };
}, q(`runtime-row-${id}`));

for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    const tag = `${vp.name}-${theme}`;
    const ctx = await browser.newContext({ locale: TEST_LOCALE, colorScheme: theme, viewport: { width: vp.w, height: vp.h }, ...(vp.mobile ? { userAgent: ANDROID_UA, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    const page = await ctx.newPage();
    await page.addInitScript(initScript, { theme });
    await page.addInitScript(fixtureScript, { daemons: [MIXED, LEGACY] });
    await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
    const shot = async (name) => { if (OUT && theme === 'light') await page.screenshot({ path: `${OUT}/${TAG}-${vp.name}-${name}.png` }); };

    // ── 选服务器 ──
    try {
      await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 15000 });
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'agents' }));
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'picker' }));
      await page.getByText('daemon-legacy', { exact: true }).first().waitFor({ timeout: 10000 });
      await settle(page);
      await shot('picker');

      const cards = await page.evaluate(() => {
        const card = (id) => document.querySelector(`[data-testid="daemon-card-${id}"]`);
        const box = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, r: r.right, y: r.y, b: r.bottom, w: r.width }; };
        const out = {};
        for (const id of ['d_example_1', 'd_legacy_1']) {
          const c = card(id);
          if (!c) { out[id] = null; continue; }
          out[id] = {
            box: box(c), text: c.textContent || '',
            chips: [...c.querySelectorAll('[data-testid^="readiness-chip-"]')].map(e => ({ id: e.getAttribute('data-testid').replace('readiness-chip-', ''), text: (e.textContent || '').trim(), box: box(e) })),
            hasRow: !!c.querySelector('[data-testid="picker-readiness"]'),
          };
        }
        return { ...out, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth };
      });
      const m = cards.d_example_1, l = cards.d_legacy_1;
      ck(`${tag} picker: both daemon cards render`, !!m && !!l);
      if (m && l) {
        // (1) 胶囊
        ck(`🔴 ${tag} picker: daemon-example has one readiness chip per runtime (5)`, m.chips.length === 5, m.chips.map(c => c.id).join());
        for (const [rt, icon] of Object.entries(EXPECT_ICON)) {
          const c = m.chips.find(x => x.id === rt);
          ck(`${tag} picker: ${rt} chip reads ${icon}`, !!c && c.text.startsWith(icon) && c.text.includes(rt), c?.text ?? 'missing');
        }
        ck(`${tag} picker: daemon-example's 「可建节点」 line is replaced by the chips`, !m.text.includes('可建节点'));
        // (3) 旧 daemon 照旧
        ck(`🔴 ${tag} picker: legacy daemon has no readiness row`, !l.hasRow && l.chips.length === 0);
        ck(`${tag} picker: legacy daemon keeps 「可建节点」 and its runtime name chips`, l.text.includes('可建节点') && l.text.includes('claude-agent-sdk') && l.text.includes('grok-build-acp'));
        // (4) 几何
        const out = m.chips.filter(c => c.box.x < m.box.x - 0.5 || c.box.r > m.box.r + 0.5);
        ck(`🔴 ${tag} picker: every chip stays inside its card`, out.length === 0, out.map(c => `${c.id} ${Math.round(c.box.x)}..${Math.round(c.box.r)} vs card ${Math.round(m.box.x)}..${Math.round(m.box.r)}`).join('; '));
        ck(`${tag} picker: card inside the viewport (${Math.round(m.box.x)}..${Math.round(m.box.r)} / ${vp.w})`, m.box.x >= 0 && m.box.r <= vp.w + 0.5);
        ck(`${tag} picker: no horizontal page scroll (${cards.scrollW} ≤ ${cards.innerW})`, cards.scrollW <= cards.innerW);
      }

      // (5) 2026-10-21 视觉返工:术语、次要 ID、中性灰、单一选中态、灰按钮给理由
      const look = await page.evaluate(() => {
        const card = document.querySelector('[data-testid="daemon-card-d_example_1"]');
        const title = card?.querySelector('[data-testid="daemon-card-title"]');
        const idLine = card?.querySelector('[data-testid="daemon-card-id"]');
        const chip = document.querySelector('[data-testid="readiness-chip-grok-build-acp"]');
        const chipText = chip?.querySelector('div,span') || chip;
        const accentOf = (el) => (el ? getComputedStyle(el).color : null);
        return {
          header: document.body.innerText.split('\n').find(t => t.includes('服务器')) || '',
          titleSize: title ? parseFloat(getComputedStyle(title).fontSize) : null,
          idSize: idLine ? parseFloat(getComputedStyle(idLine).fontSize) : null,
          idText: idLine?.textContent || '',
          blockedChipColor: accentOf(chipText),
          readyChipColor: accentOf((document.querySelector('[data-testid="readiness-chip-claude-agent-sdk"]')?.querySelector('div,span')))
            || accentOf(document.querySelector('[data-testid="readiness-chip-claude-agent-sdk"]')),
          radios: document.querySelectorAll('[data-testid="daemon-radio"]').length,
          dots: document.querySelectorAll('[data-testid="daemon-card-d_example_1"] [data-testid="daemon-health-dot"]').length,
          footerHint: document.querySelector('[data-testid="picker-footer-hint"]')?.textContent || '',
        };
      });
      ck(`${tag} picker: header says 服务器, not host_supervisor`, look.header.includes('服务器') && !look.header.includes('host_supervisor'), look.header);
      ck(`${tag} picker: machine name is the title, id is smaller copy`, look.titleSize != null && look.idSize != null && look.idSize < look.titleSize && look.idText.includes('机器 ID'), JSON.stringify({ title: look.titleSize, id: look.idSize, text: look.idText }));
      ck(`🔴 ${tag} picker: an unavailable runtime chip is neutral, not red`, isGrey(look.blockedChipColor) && !isRed(look.blockedChipColor), look.blockedChipColor);
      ck(`${tag} picker: health dot is not next to the selection radio`, look.dots === 1 && look.radios > 0, JSON.stringify(look));
      ck(`${tag} picker: the disabled 下一步 says why`, look.footerHint.includes('先选一台服务器'), look.footerHint);
      // (2) 原因
      const grok = page.locator(q('readiness-chip-grok-build-acp')).first();
      if (vp.desktop) {
        await grok.hover();
        await settle(page);
        ck(`🔴 ${tag} picker: hovering ✗ grok shows a tooltip with the reason`, (await visible(page, 'readiness-tip-grok-build-acp')) && ((await textOf(page, 'readiness-tip-grok-build-acp')) || '').includes(REASON_GROK));
        const tip = await page.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { x: r.x, r: r.right, y: r.y } : null; }, q('readiness-tip-grok-build-acp'));
        ck(`${tag} picker: tooltip is on screen`, !!tip && tip.x >= 0 && tip.r <= vp.w && tip.y >= 0, JSON.stringify(tip));
        await shot('picker-tooltip');
        await page.mouse.move(5, vp.h - 5);
        await settle(page);
        ck(`${tag} picker: tooltip goes away on hover out`, !(await visible(page, 'readiness-tip-grok-build-acp')));
      } else {
        await grok.tap();
        await settle(page);
        ck(`🔴 ${tag} picker: tapping ✗ grok expands the reason`, (await visible(page, 'readiness-detail-grok-build-acp')) && ((await textOf(page, 'readiness-detail-grok-build-acp')) || '').includes(REASON_GROK));
        const det = await page.evaluate((s) => { const e = document.querySelector(s); const r = e?.getBoundingClientRect(); return r ? { x: r.x, r: r.right } : null; }, q('readiness-detail-grok-build-acp'));
        ck(`${tag} picker: expanded reason wraps inside the 390 viewport`, !!det && det.x >= 0 && det.r <= vp.w + 0.5, JSON.stringify(det));
        await shot('picker-expanded');
        await grok.tap();
        await settle(page);
        ck(`${tag} picker: tapping again collapses it`, !(await visible(page, 'readiness-detail-grok-build-acp')));
      }
    } catch (e) {
      ck(`${tag} picker: case ran`, false, String(e?.message || e).split('\n')[0]);
      if (OUT) await page.screenshot({ path: `${OUT}/${TAG}-${tag}-picker-crash.png` }).catch(() => {});
    }

    // ── 向导 Runtime 步:报了 readiness 的 daemon ──
    try {
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'agents' }));
      await page.evaluate((d) => window.__anetLayoutSweep.setScreen({ name: 'wizard', daemon: d }), MIXED);
      await page.getByPlaceholder('例如 my-agent-1').fill('demo_agent');
      await page.getByText('下一步', { exact: true }).click();
      // 按文字等(不按 testID):改动前的 export 也能走到这页、截到「改动前」的图,再如实变红
      await page.getByText('Claude Agent SDK', { exact: true }).first().waitFor({ timeout: 5000 });
      await settle(page);
      await shot('runtime');

      const sdk0 = await runtimeRow(page, 'claude-agent-sdk');
      ck(`${tag} wizard: initial runtime is the first usable one (Claude Agent SDK, checked)`, !!sdk0?.checked && !sdk0.disabled);
      for (const [rt, reason] of [['grok-build-acp', REASON_GROK], ['codex-sdk', REASON_CODEX]]) {
        const row = await runtimeRow(page, rt);
        ck(`🔴 ${tag} wizard: ${rt} row is disabled`, !!row?.disabled, JSON.stringify(row));
        ck(`🔴 ${tag} wizard: ${rt} reason + fix visible under the name`, (await visible(page, `runtime-reason-${rt}`)) && ((await textOf(page, `runtime-reason-${rt}`)) || '').includes(reason));
        await page.locator(q(`runtime-row-${rt}`)).click({ force: true });
        await settle(page);
        const after = await runtimeRow(page, rt);
        const sdk = await runtimeRow(page, 'claude-agent-sdk');
        ck(`🔴 ${tag} wizard: clicking ${rt} does not select it`, !after?.checked && !!sdk?.checked, `${rt} checked=${after?.checked} sdk checked=${sdk?.checked}`);
      }
      // (6) 未检测:可选
      ck(`${tag} wizard: unknown runtime shows 「未检测」`, ((await textOf(page, 'runtime-unchecked-claude-code-cli')) || '').includes('未检测'));
      await page.locator(q('runtime-row-claude-code-cli')).click();
      await settle(page);
      ck(`🔴 ${tag} wizard: unknown runtime stays selectable`, !!(await runtimeRow(page, 'claude-code-cli'))?.checked);
      // 共用登录:提醒,仍可选
      ck(`${tag} wizard: shared login warning 「与 3 个节点共用登录」`, ((await textOf(page, 'runtime-shared-codex-app-server')) || '').includes('与 3 个节点共用登录'));
      await page.locator(q('runtime-row-codex-app-server')).click();
      await settle(page);
      ck(`${tag} wizard: shared-login runtime stays selectable`, !!(await runtimeRow(page, 'codex-app-server'))?.checked);
      // 几何:原因行在行内、行在视口里
      const geo = await page.evaluate(() => {
        const r = (s) => document.querySelector(s)?.getBoundingClientRect();
        const row = r('[data-testid="runtime-row-codex-sdk"]'), why = r('[data-testid="runtime-reason-codex-sdk"]');
        return row && why ? { rowX: row.x, rowR: row.right, whyX: why.x, whyR: why.right, scrollW: document.documentElement.scrollWidth, innerW: innerWidth } : null;
      });
      ck(`${tag} wizard: reason wraps inside its row, no horizontal scroll`, !!geo && geo.whyX >= geo.rowX && geo.whyR <= geo.rowR + 0.5 && geo.scrollW <= geo.innerW, JSON.stringify(geo));
      await page.locator(q('runtime-row-claude-agent-sdk')).click();
      await settle(page);
      await shot('runtime-final');
    } catch (e) {
      ck(`${tag} wizard: case ran`, false, String(e?.message || e).split('\n')[0]);
      if (OUT) await page.screenshot({ path: `${OUT}/${TAG}-${tag}-wizard-crash.png` }).catch(() => {});
    }

    // ── 向导 Runtime 步:旧 daemon(没 runtime_readiness)── 和以前一样
    try {
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'agents' }));
      await page.evaluate((d) => window.__anetLayoutSweep.setScreen({ name: 'wizard', daemon: d }), LEGACY);
      await page.getByPlaceholder('例如 my-agent-1').fill('demo_agent');
      await page.getByText('下一步', { exact: true }).click();
      await page.getByText('Claude Agent SDK', { exact: true }).first().waitFor({ timeout: 5000 });
      await settle(page);
      const notes = await page.evaluate(() => document.querySelectorAll('[data-testid^="runtime-reason-"], [data-testid^="runtime-unchecked-"], [data-testid^="runtime-shared-"]').length);
      ck(`🔴 ${tag} legacy wizard: no reason / 未检测 / shared lines`, notes === 0, String(notes));
      await page.getByText('Grok', { exact: true }).first().click();
      await settle(page);
      const g = await runtimeRow(page, 'grok-build-acp');
      ck(`🔴 ${tag} legacy wizard: a declared runtime (Grok) is selectable as before`, !!g?.checked && !g.disabled, JSON.stringify(g));
      await page.getByText('下一步', { exact: true }).click();
      await settle(page);
      ck(`${tag} legacy wizard: 下一步 moves on from Runtime`, (await page.locator(q('create-node-submit')).count()) > 0 || (await page.getByText('模型', { exact: true }).count()) > 0);
    } catch (e) {
      ck(`${tag} legacy wizard: case ran`, false, String(e?.message || e).split('\n')[0]);
    }
    await ctx.close();
  }
}
await browser.close();
web.close();
console.log(`\n${fails ? 'FAIL' : 'PASS'}: ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
