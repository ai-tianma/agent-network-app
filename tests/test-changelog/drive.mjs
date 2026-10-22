// 设置 → 关于 → 更新日志(owner 2026-09-30「更新日志可以复制，方便我复制去发那个小红书啊，或者发那个公众号推文」),
// end to end on the web export. Not in CI (same as test-schedule-copy): needs Playwright + Chromium and a web export.
// No hub at all: a Tauri stub signs in with a placeholder profile, page.route() answers every hub request with empty
// lists and plays the ModelScope mirror / GitHub. Nothing touches 127.0.0.1:9200 or ~/.anet.
//
//   WEB_DIR=<expo export dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> [OUT=<png dir>] node tests/test-changelog/drive.mjs
//
// For desktop 1440×900 (Tauri shell, pointer UI) and phone 390×844 (Android UA):
//   1  关于 has an 更新日志 row; it opens the page (desktop: pushed into the right pane with ‹ 关于; phone: detail page)
//   2  every version is listed newest first with its date, painted (paintedText), and the running version is there
//   3  geometry: each card head (check · version · date · 复制) is centred on one line; 复制 right edges line up; card
//      left edges line up
//   4  复制 on one version → preview; each of 小红书 / 公众号 / 纯文本 re-renders the preview (title line, hashtags,
//      numbered list, dashes) and it is painted; 复制 puts exactly the preview text on the clipboard
//   5  multi-select → 复制所选（2）→ the preview covers both versions, newest first
//   6  phone: after 复制 the 分享… button appears and hands the same text to the share sheet (navigator.share stub)
//   7  offline (mirror + GitHub unreachable): the page still lists the bundled notes incl. the running version, with the
//      offline hint
//   8  小红书 preview per release kind mix (feature-only / speed-only / fix-only / mixed, fixture notes): every item line
//      carries its kind's emoji (✨ / ⚡️ / 🔧), no `- ` lines; 复制 copies it (#468)
// Exit 1 when any assertion fails.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { paintedText } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR, OUT = process.env.OUT;
if (!WEB) throw new Error('need WEB_DIR');
if (OUT) mkdirSync(OUT, { recursive: true });
const HUB = 'http://hub.placeholder.invalid';
const MIRROR = 'https://modelscope.cn/datasets/SmartFlowAI/agent-network-releases/resolve/master';
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

// The mirror serves the real cumulative notes (the bundled copy of the release workflow's releaseBody) for the version
// the app says it is.
const bundledSrc = readFileSync(new URL('../../src/changelog-bundled.ts', import.meta.url), 'utf8');
const REAL_BODY = JSON.parse(`[${/BUNDLED_RELEASE_BODY: string = \[\n([\s\S]*?)\n\]\.join/.exec(bundledSrc)[1].replace(/,\s*$/, '')}]`).join('\n');
const APP_VERSION = /APP_VERSION = '([^']+)'/.exec(readFileSync(new URL('../../src/version.ts', import.meta.url), 'utf8'))[1];

// The running version's own notes are a FIXTURE (#468): the 小红书 check used to require a ✨ line, so a release whose
// notes were all speed items (「更快」, release-notes.ts SPEED_WORDS) or all fixes failed it — the 0.2.194 bump PR had
// to be reworded to pass. The rest of the cumulative notes (older versions) stay the real bundled ones.
// Kinds are given by explicit prefixes, so each item's expected 小红书 line (emoji by kind) is known here, independently
// of the app's formatter: ✨ new · ⚡️ speed · 🔧 fix (changelog-model.ts XHS_EMOJI).
const KIND_ITEMS = {
  new: { bullet: '新功能：示例功能，可以把示例数据导出成表格', emoji: '✨', text: '示例功能，可以把示例数据导出成表格' },
  speed: { bullet: '提速：示例列表打开更快，首屏从两秒缩到半秒', emoji: '⚡️', text: '示例列表打开更快，首屏从两秒缩到半秒' },
  fix: { bullet: '修复：示例按钮在窄屏上错位的问题', emoji: '🔧', text: '示例按钮在窄屏上错位的问题' },
};
const KIND_CASES = { 'feature-only': ['new'], 'speed-only': ['speed'], 'fix-only': ['fix'], mixed: ['new', 'speed', 'fix'] };
/** REAL_BODY with the running version's section replaced by bullets of these kinds. */
const bodyWithKinds = (kinds) => {
  const lines = REAL_BODY.split('\n');
  const at = lines.findIndex(l => l.trim() === `What's new in ${APP_VERSION}:`);
  if (at < 0) throw new Error(`bundled notes have no section for ${APP_VERSION}`);
  let end = at + 1;
  while (end < lines.length && !/^What's new in\s/i.test(lines[end].trim()) && !/^Existing installations\b/i.test(lines[end].trim())) end++;
  return [...lines.slice(0, at + 1), ...kinds.map(k => `- ${KIND_ITEMS[k].bullet}`), '', ...lines.slice(end)].join('\n');
};
const BODY = bodyWithKinds(KIND_CASES.mixed);
// Release versions can have gaps (for example, an unpublished failed draft).
// Derive the expected cards from the supplied notes, not patch-number arithmetic
// or the rendered DOM; still require the complete list in numeric version order.
const NOTE_VERSIONS = [...BODY.matchAll(/^What's new in (\d+\.\d+\.\d+):$/gm)]
  .map(match => match[1])
  .sort((a, b) => {
    const av = a.split('.').map(Number), bv = b.split('.').map(Number);
    return bv[0] - av[0] || bv[1] - av[1] || bv[2] - av[2];
  });
if (NOTE_VERSIONS.length < 3 || NOTE_VERSIONS[0] !== APP_VERSION) {
  throw new Error('changelog fixture needs the running version and two older releases');
}
const [, PREV, PREV2] = NOTE_VERSIONS;
// Unpublished drafts sit in the notes without a bundled date. The geometry check
// below must use cards that actually have one, not the two newest neighbors.
const KNOWN_DATES = new Set([...bundledSrc.matchAll(/"(\d+\.\d+\.\d+)":\s*"20/g)].map(match => match[1]));
// What the running version's card must show, read from the same notes (not hard-coded: every release changes them —
// the drive used to expect 「任务仪表盘」 and exactly 新功能 / 修复, true for one release only). The first bullet's text
// (minus a 新功能：/修复：/提速： prefix), first 8 characters.
const CURRENT_FIRST = (() => {
  const lines = BODY.split('\n');
  const at = lines.findIndex(l => l.trim() === `What's new in ${APP_VERSION}:`);
  const first = lines.slice(at + 1).find(l => /^\s*[-*]\s+/.test(l)) ?? '';
  return first.replace(/^\s*[-*]\s+/, '').replace(/^(?:新功能|新增|提速|修复|New|Feature|Fix|Speed)\s*[:：]\s*/i, '').slice(0, 8);
})();

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json', '.ico': 'image/x-icon' };
const web = createServer((req, res) => {
  let p = join(WEB, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(WEB, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(0, '127.0.0.1');
await new Promise(r => setTimeout(r, 200));
const WEB_URL = `http://127.0.0.1:${web.address().port}/`;

// Desktop-shell stub (same as tests/test-schedule-copy): plugin:http goes to page fetch, which page.route() answers.
const initScript = ({ hubUrl }) => {
  try { localStorage.setItem('theme_mode_v1', 'light'); localStorage.setItem('anet.language.v1', 'zh'); } catch {}
  window.__shared = [];
  try { Object.defineProperty(navigator, 'share', { configurable: true, value: async (d) => { window.__shared.push(d); } }); } catch {}
  const profile = { serverUrl: hubUrl, token: 'utok_placeholder', username: 'tester', profileId: 'p-changelog', displayName: 'tester', networkId: 'net-placeholder' };
  let rid = 0; const reqs = new Map(); const bodies = new Map();
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window[`_${id}`] = cb; return id; },
    convertFileSrc: (p) => p,
    invoke: async (cmd, args) => {
      switch (cmd) {
        case 'load_active_desktop_profile': return JSON.stringify(profile);
        case 'save_desktop_profile': return args.sessionJson;
        case 'read_desktop_profile_file': return null;
        case 'get_theme_preference': return 'light';
        case 'plugin:event|listen': return 0;
        case 'plugin:http|fetch': { const id = ++rid; reqs.set(id, args.clientConfig); return id; }
        case 'plugin:http|fetch_send': {
          const c = reqs.get(args.rid);
          const r = await fetch(c.url, { method: c.method, headers: c.headers, body: c.data ? new Uint8Array(c.data) : undefined });
          const buf = new Uint8Array(await r.arrayBuffer());
          const id = ++rid; bodies.set(id, { buf, sent: false });
          return { status: r.status, statusText: r.statusText, url: r.url, headers: Array.from(r.headers.entries()), rid: id };
        }
        case 'plugin:http|fetch_read_body': {
          const b = bodies.get(args.rid);
          if (!b.sent) { b.sent = true; return [...b.buf, 0]; }
          return [1];
        }
        default: return null;
      }
    },
  };
};

const findExe = () => {
  const base = `${process.env.HOME}/.cache/ms-playwright`;
  for (const d of ['chromium-1234', 'chromium-1217', 'chromium-1208']) for (const p of [`${base}/${d}/chrome-linux64/chrome`, `${base}/${d}/chrome-linux/chrome`]) if (existsSync(p)) return p;
  return undefined;
};
const browser = await chromium.launch({ headless: true, executablePath: findExe(), args: ['--disable-web-security'] });
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
let failures = 0;
const ck = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`); };
const painted = (p) => !!p && p.painted && p.w >= 8;
const pw = (p) => p ? `painted ${p.w.toFixed(1)}×${p.h.toFixed(1)}` : 'painted (none)';
const tid = (id) => `[data-testid="${id}"]`;
const r1 = (n) => Math.round(n * 10) / 10;
const box = async (page, sel) => { const b = await page.locator(sel).first().boundingBox(); return b && { x: r1(b.x), y: r1(b.y), w: r1(b.width), h: r1(b.height) }; };
const cy = (b) => b.y + b.h / 2;

const open = async ({ phone, offline, body = BODY }) => {
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, userAgent: ANDROID_UA, locale: 'zh-CN', deviceScaleFactor: 2, hasTouch: true }
    : { viewport: { width: 1440, height: 900 }, locale: 'zh-CN', deviceScaleFactor: 2 });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: WEB_URL.replace(/\/$/, '') });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  const hits = [];
  await page.route(`${HUB}/**`, route => route.fulfill(json({ ok: true, messages: [], tasks: [], nodes: [], sessions: [], schedules: [] })));
  await page.route(`${MIRROR}/**`, route => {
    const u = route.request().url(); hits.push(u);
    if (offline) return route.abort('internetdisconnected');
    if (u.endsWith('/desktop/latest/VERSION')) return route.fulfill({ status: 200, contentType: 'text/plain', body: `${APP_VERSION}\n` });
    if (u.endsWith(`/desktop/${APP_VERSION}/latest.json`)) return route.fulfill(json({ version: APP_VERSION, notes: body, pub_date: '2026-09-30T10:30:38.172Z' }));
    return route.fulfill({ status: 404, body: '' });
  });
  await page.route('https://api.github.com/**', route => { hits.push(route.request().url()); return offline ? route.abort('internetdisconnected') : route.fulfill(json({ message: 'API rate limit exceeded' }, 403)); });
  await page.addInitScript(initScript, { hubUrl: HUB });
  // Desktop: 设置 is its own window (desktop-settings-window.ts) — load that window's URL, as the shell does.
  await page.goto(phone ? WEB_URL : `${WEB_URL}?settings=1&category=about`);
  return { ctx, page, hits };
};

const openChangelog = async (page, phone) => {
  if (phone) {
    await page.locator(tid('mobile-tab-settings')).click({ timeout: 25000 });
    await page.locator(tid('settings-row-about')).click({ timeout: 10000 });
  } else {
    await page.locator(tid('settings-sidebar')).getByText('关于', { exact: true }).click({ timeout: 25000 });
  }
  const row = page.locator(tid('settings-changelog-row'));
  await row.waitFor({ timeout: 10000 });
  ck(`${phone ? 'phone' : 'desktop'}: 关于 has an 更新日志 row`, await row.isVisible());
  if (OUT) await page.screenshot({ path: `${OUT}/${phone ? 'phone' : 'desktop'}-about.png` });
  await row.click();
  await page.locator(tid(phone ? 'changelog-phone' : 'changelog-desktop')).waitFor({ timeout: 10000 });
  await page.locator(tid(`changelog-card-${APP_VERSION}`)).waitFor({ timeout: 10000 });
};

// 小红书 shape for one version: title, hashtags at the end, no `- ` lines, at least one item line, and every item on
// its own line with the emoji of ITS kind (not 「a ✨ line somewhere」).
const ITEM_LINE = /^(✨|⚡️|🔧) /mu;
const xhsShapeOk = (t, kinds) => t.startsWith(`ANet ${APP_VERSION} 更新了什么\n`) && /\n#\S+( #\S+){2,4}$/.test(t)
  && !/^- /m.test(t) && ITEM_LINE.test(t)
  && kinds.every(k => t.split('\n').includes(`${KIND_ITEMS[k].emoji} ${KIND_ITEMS[k].text}`))
  && Object.keys(KIND_ITEMS).filter(k => !kinds.includes(k)).every(k => !t.includes(KIND_ITEMS[k].text));
// The assertion this replaces (kept only to witness it red on a speed-only release).
const xhsOldAssertion = t => t.startsWith(`ANet ${APP_VERSION} 更新了什么\n`) && /\n#\S+( #\S+){2,4}$/.test(t) && !/^- /m.test(t) && /^✨ /m.test(t);

const FORMATS = [
  ['xhs', t => xhsShapeOk(t, KIND_CASES.mixed)],
  ['wechat', t => t.startsWith(`ANet ${APP_VERSION} 更新说明\n`) && /^1\. /m.test(t) && t.includes('共带来')],
  ['plain', t => t.startsWith(`ANet v${APP_VERSION}（`) && /^- /m.test(t) && !/#AI工具/.test(t)],
];

async function run({ phone }) {
  const vp = phone ? 'phone 390×844' : 'desktop 1440×900';
  const tag = phone ? 'phone' : 'desktop';
  const { ctx, page, hits } = await open({ phone, offline: false });
  await openChangelog(page, phone);
  await page.waitForTimeout(800); // refresh from the (mocked) mirror lands
  ck(`${vp}: fetched one manifest from the mirror (no per-version fetches)`, hits.filter(u => u.includes('/latest.json')).length === 1, hits.join(' '));
  if (!phone) {
    const title = await paintedText(page, `${tid('settings-changelog-header')} *`, '更新日志');
    ck(`${vp}: pane title 更新日志 with ‹ 关于`, painted(title) && await page.locator(tid('settings-changelog-back')).isVisible(), pw(title));
  } else {
    const title = await paintedText(page, tid('settings-subpage-title'));
    ck(`${vp}: header title 更新日志`, title?.text === '更新日志' && painted(title), pw(title));
  }

  // 2 list
  const versions = await page.locator('[data-testid^="changelog-version-"]').evaluateAll(els => els.map(e => e.textContent));
  ck(`${vp}: versions newest first, running version on top`, versions.length > 50 && versions.length === NOTE_VERSIONS.length && versions.every((v, i) => v === `v${NOTE_VERSIONS[i]}`), `${versions.slice(0, 3).join(',')} … (${versions.length})`);
  const v0 = await paintedText(page, tid(`changelog-version-${APP_VERSION}`));
  const d0 = await paintedText(page, tid(`changelog-date-${APP_VERSION}`));
  ck(`${vp}: version + date painted`, painted(v0) && painted(d0) && /^\d{4}-\d{2}-\d{2}$/.test(d0?.text ?? ''), `${pw(v0)} / ${d0?.text} ${pw(d0)}`);
  const item = await page.locator(tid(`changelog-card-${APP_VERSION}`)).evaluate((el, head) => { const t = [...el.querySelectorAll('div')].find(d => d.textContent.startsWith(head)); const r = t?.getBoundingClientRect(); return r ? { w: r.width, h: r.height } : null; }, CURRENT_FIRST);
  ck(`${vp}: first item painted in the card`, CURRENT_FIRST.length >= 4 && !!item && item.w > 100 && item.h > 15, `${CURRENT_FIRST}… ${JSON.stringify(item)}`);
  const groupTitles = await page.locator(tid(`changelog-card-${APP_VERSION}`)).evaluate(el => [...el.querySelectorAll('div')].filter(d => ['新功能', '修复', '提速'].includes(d.textContent) && d.children.length === 0).map(d => d.textContent));
  const ORDER = ['新功能', '提速', '修复'];
  ck(`${vp}: grouped (新功能 / 提速 / 修复, in that order)`, groupTitles.length > 0 && groupTitles.every((g, i) => i === 0 || ORDER.indexOf(groupTitles[i - 1]) < ORDER.indexOf(g)), groupTitles.join('/'));
  if (OUT) await page.screenshot({ path: `${OUT}/${tag}-list.png` });

  // 3 geometry
  console.log(`\n${vp} card heads (CSS px):\n| version | check | version | date | copy | card x |\n|---|---|---|---|---|---|`);
  const heads = [];
  for (const v of [APP_VERSION, PREV, PREV2]) {
    const card = await box(page, tid(`changelog-card-${v}`));
    const ver = await box(page, tid(`changelog-version-${v}`));
    // A preceding desktop release may still be unpublished. Unknown dates are
    // omitted on phone and empty on desktop; never wait for or invent a date.
    const dateText = await paintedText(page, tid(`changelog-date-${v}`));
    const date = painted(dateText) ? await box(page, tid(`changelog-date-${v}`)) : null;
    const copy = await box(page, tid(`changelog-copy-${v}`));
    const check = phone ? null : await box(page, tid(`changelog-check-${v}`));
    heads.push({ v, card, ver, date, copy, check });
    console.log(`| ${v} | ${check ? `${check.x},${check.y} ${check.w}×${check.h}` : '—'} | ${ver.x},${ver.y} ${ver.w}×${ver.h} | ${date ? `${date.x},${date.y} ${date.w}×${date.h}` : 'unknown'} | ${copy.x},${copy.y} ${copy.w}×${copy.h} | ${card.x} |`);
  }
  ck(`${vp}: 复制 right edges line up`, heads.every(h => Math.abs((h.copy.x + h.copy.w) - (heads[0].copy.x + heads[0].copy.w)) <= 0.5));
  ck(`${vp}: card left edges line up`, heads.every(h => Math.abs(h.card.x - heads[0].card.x) <= 0.5));
  ck(`${vp}: 复制 inside the card with ≥ 12px to its right edge`, heads.every(h => h.card.x + h.card.w - (h.copy.x + h.copy.w) >= 12));
  if (phone) {
    // Phone: version + date stack on the left; 复制 is centred on that stack; card gutters 16 (settings-kit).
    // Measure the real title stack container rather than reconstructing it from the
    // version and date boxes: with CJK fonts a wrapped line inside the stack changes its
    // height without changing either box, and the reconstructed midpoint then drifts.
    // Same intent (复制 centred on the stack), same 1px tolerance, measured on the element.
    const deltas = [];
    for (const h of heads) {
      const stack = await box(page, tid(`changelog-titlestack-${h.v}`));
      deltas.push(stack ? (cy(h.copy) - cy(stack)).toFixed(1) : 'missing');
    }
    ck(`${vp}: 复制 centred on the title stack`, deltas.every(d => d !== 'missing' && Math.abs(Number(d)) <= 1), deltas.join('/'));
    ck(`${vp}: 16px gutters both sides`, heads.every(h => Math.abs(h.card.x - 16) <= 0.5 && Math.abs(390 - (h.card.x + h.card.w) - 16) <= 0.5), `${heads[0].card.x} / ${390 - heads[0].card.x - heads[0].card.w}`);
    ck(`${vp}: 复制 touch target ≥ 36 high`, heads.every(h => h.copy.h >= 36), heads.map(h => h.copy.h).join('/'));
  } else {
    ck(`${vp}: check · version · date · 复制 centred on one line`, heads.every(h => [h.check, h.ver, h.date].filter(Boolean).every(b => Math.abs(cy(b) - cy(h.copy)) <= 1)), heads.map(h => [h.check, h.ver, h.date].filter(Boolean).map(b => (cy(b) - cy(h.copy)).toFixed(1)).join(',')).join(' / '));
    // The running version carries a 当前版本 badge between version and date.
    // Neighbors may be unpublished and have no date; compare dated cards instead.
    const gap = (h) => h.date.x - h.ver.x - h.ver.w;
    let dated = heads.slice(1).filter(h => h.date);
    if (dated.length < 2) {
      for (const v of NOTE_VERSIONS) {
        if (v === APP_VERSION || !KNOWN_DATES.has(v) || dated.some(h => h.v === v)) continue;
        // Historical dates can be below the ScrollView's clipped viewport.
        // Scroll to the real card before requiring its date to be painted;
        // do not invent publication dates for the two unpublished neighbors.
        await page.locator(tid(`changelog-date-${v}`)).scrollIntoViewIfNeeded();
        const ver = await box(page, tid(`changelog-version-${v}`));
        const dateText = await paintedText(page, tid(`changelog-date-${v}`));
        const date = painted(dateText) ? await box(page, tid(`changelog-date-${v}`)) : null;
        if (ver && date) dated.push({ v, ver, date });
        if (dated.length === 2) break;
      }
    }
    ck(`${vp}: date right after the version (same gap each dated card)`, dated.length >= 2 && dated.every(h => Math.abs(gap(h) - gap(dated[0])) <= 0.5) && gap(dated[0]) > 0 && (!heads[0].date || gap(heads[0]) > gap(dated[0])), [...(heads[0].date ? [`current ${gap(heads[0]).toFixed(1)}`] : []), ...dated.map(h => `${h.v} ${gap(h).toFixed(1)}`)].join('/'));
    await page.locator(tid(`changelog-card-${APP_VERSION}`)).scrollIntoViewIfNeeded();
  }

  // 4 single-version preview in each format
  await page.locator(tid(`changelog-copy-${APP_VERSION}`)).click();
  await page.locator(tid('changelog-preview')).waitFor({ timeout: 5000 });
  await page.waitForTimeout(400);
  for (const [f, okText] of FORMATS) {
    await page.locator(tid(`changelog-format-${f}`)).click();
    await page.waitForTimeout(150);
    const text = await page.locator(tid('changelog-preview-text')).innerText();
    const pt = await paintedText(page, tid('changelog-preview-text'));
    ck(`${vp}: ${f} preview`, okText(text) && painted(pt), `${JSON.stringify(text.slice(0, 60))} ${pw(pt)}`);
    const seg = await paintedText(page, `${tid(`changelog-format-${f}`)} *`);
    ck(`${vp}: ${f} segment label painted`, painted(seg), pw(seg));
    if (OUT) await page.screenshot({ path: `${OUT}/${tag}-preview-${f}.png` });
  }
  await page.locator(tid('changelog-format-xhs')).click();
  const shown = await page.locator(tid('changelog-preview-text')).innerText();
  // footer button never scrolled off (desktop DialogFrame footer / phone bottom bar)
  const copyBtn = await box(page, tid('changelog-preview-copy'));
  ck(`${vp}: preview 复制 button on screen`, !!copyBtn && copyBtn.y + copyBtn.h <= (phone ? 844 : 900) && copyBtn.y > 0, JSON.stringify(copyBtn));
  await page.locator(tid('changelog-preview-copy')).click();
  await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  ck(`${vp}: clipboard == preview text (小红书)`, clip === shown && clip.length > 40, `${clip.length} vs ${shown.length}`);
  if (phone) {
    const share = page.locator(tid('changelog-preview-share'));
    ck(`${vp}: 分享… appears after copying`, await share.isVisible());
    const shareBox = await box(page, tid('changelog-preview-share'));
    ck(`${vp}: 复制 and 分享 side by side, same height`, !!shareBox && Math.abs(shareBox.h - copyBtn.h) <= 0.5 && Math.abs(cy(shareBox) - cy(copyBtn)) <= 0.5, `${JSON.stringify(copyBtn)} ${JSON.stringify(shareBox)}`);
    if (OUT) await page.screenshot({ path: `${OUT}/${tag}-copied-share.png` });
    await share.click();
    await page.waitForTimeout(200);
    const shared = await page.evaluate(() => window.__shared);
    ck(`${vp}: share sheet gets the same text`, shared.length === 1 && (shared[0].text === clip || shared[0].message === clip || shared[0].text?.includes(clip.slice(0, 30))), JSON.stringify(shared).slice(0, 120));
    await page.locator(tid('changelog-preview-cancel')).click();
  } else {
    const toast = await paintedText(page, `${tid('changelog-toast')} *`);
    ck(`${vp}: 已复制 toast`, painted(toast) && toast.text.startsWith('已复制'), `${toast?.text} ${pw(toast)}`);
    ck(`${vp}: dialog closed after copying`, !(await page.locator(tid('changelog-preview')).isVisible().catch(() => false)));
  }
  await page.waitForTimeout(500);

  // 5 multi-select
  if (phone) await page.locator(tid('changelog-select-toggle')).click();
  const pick = async (v) => page.locator(tid(phone ? `changelog-card-${v}` : `changelog-check-${v}`)).click();
  await pick(PREV2); await pick(PREV);
  const bulk = page.locator(tid('changelog-copy-selected'));
  ck(`${vp}: 复制所选（2）`, (await bulk.innerText()).includes('复制所选（2）'), await bulk.innerText());
  if (OUT) await page.screenshot({ path: `${OUT}/${tag}-multiselect.png` });
  if (phone) {
    const bar = await box(page, tid('changelog-phone-bar'));
    ck(`${vp}: select bar pinned to the bottom`, !!bar && Math.abs(bar.y + bar.h - 844) <= 1, JSON.stringify(bar));
  }
  await bulk.click();
  await page.locator(tid('changelog-preview')).waitFor({ timeout: 5000 });
  await page.waitForTimeout(400);
  const multi = await page.locator(tid('changelog-preview-text')).innerText();
  ck(`${vp}: multi preview covers both, newest first`, multi.startsWith(`ANet ${PREV2}–${PREV} 更新了什么`) && multi.indexOf(`📦 v${PREV}`) < multi.indexOf(`📦 v${PREV2}`) && multi.indexOf(`📦 v${PREV2}`) > 0, JSON.stringify(multi.slice(0, 80)));
  if (OUT) await page.screenshot({ path: `${OUT}/${tag}-preview-multi.png` });
  await ctx.close();

  // 7 offline
  const off = await open({ phone, offline: true });
  await openChangelog(off.page, phone);
  const hint = off.page.locator(tid('changelog-offline'));
  await hint.waitFor({ timeout: 15000 }).catch(() => {});
  const hp = await paintedText(off.page, tid('changelog-offline'));
  ck(`${vp}: offline → hint + bundled notes incl. v${APP_VERSION}`, painted(hp) && await off.page.locator(tid(`changelog-card-${APP_VERSION}`)).isVisible(), pw(hp));
  if (OUT) await off.page.screenshot({ path: `${OUT}/${tag}-offline.png` });
  await off.ctx.close();
}

// 8 (#468) the 小红书 preview for releases of each kind mix — feature-only / speed-only / fix-only / mixed. Each case
//   serves its own fixture notes for the running version; the new shape check must pass for all four, and the old
//   「needs a ✨ line」 assertion is shown to fail exactly the cases it wrongly failed (speed-only, fix-only).
async function kindCases() {
  for (const [name, kinds] of Object.entries(KIND_CASES)) {
    const { ctx, page } = await open({ phone: false, offline: false, body: bodyWithKinds(kinds) });
    await openChangelog(page, false);
    await page.waitForTimeout(800);
    await page.locator(tid(`changelog-copy-${APP_VERSION}`)).click();
    await page.locator(tid('changelog-preview')).waitFor({ timeout: 5000 });
    await page.locator(tid('changelog-format-xhs')).click();
    await page.waitForTimeout(150);
    const text = await page.locator(tid('changelog-preview-text')).innerText();
    const items = text.split('\n').filter(l => ITEM_LINE.test(l));
    ck(`kinds ${name}: 小红书 items carry their kind's emoji`, xhsShapeOk(text, kinds), items.join(' | '));
    const oldOk = xhsOldAssertion(text);
    ck(`kinds ${name}: old 「needs ✨」 assertion ${kinds.includes('new') ? 'passes' : 'fails (the false failure #468 fixes)'}`, oldOk === kinds.includes('new'), `old=${oldOk}`);
    await page.locator(tid('changelog-preview-copy')).click();
    await page.waitForTimeout(300);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    ck(`kinds ${name}: 复制 puts the preview on the clipboard`, clip === text && clip.length > 40, `${clip.length} vs ${text.length}`);
    await ctx.close();
  }
}

await run({ phone: false });
await run({ phone: true });
await kindCases();
await browser.close();
web.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
