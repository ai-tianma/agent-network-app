// 定时任务「复制」—— 端到端(owner 2026-09-29:「这个定时任务要支持一下复制的功能…然后可以去改里面的东西」)。
// Not in CI (same as test-schedule-edit-conflict): needs Playwright + Chromium and a web export. No hub at all:
// a mock answers the hub API through page.route() and records every write. Nothing touches 127.0.0.1:9200 or ~/.anet.
//
//   WEB_DIR=<expo export dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> [OUT=<png dir>] \
//   node tests/test-schedule-copy/drive.mjs
//
// A  desktop 1200×800 (Tauri shell, pointer UI): 复制 sits in the action row with its siblings (same height / y, even gaps);
//    click it ⇒ the NEW form (not 编辑) prefilled from the source, name + 「 副本」; rename, 保存 ⇒ exactly one
//    POST /api/scheduled-tasks with the expected body, and no PATCH / DELETE / run-now against the source.
// B  a completed one-shot whose time has passed: 复制 is still offered; the time is moved into the future and the
//    hint says so; the POST carries the future run_at, never the past one.
// C  the source's node is gone from the hub: the form keeps it selected (alias + 离线 state), saving posts that node_id.
// D  phone 390×844 (Android UA): the same row measured on the full-screen detail; 复制 opens the new-schedule sheet.
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
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

// ── mock hub ────────────────────────────────────────────────────────────────
const PAST = '2026-09-01T01:30:00.000Z';
let rows, writes;
const reset = () => {
  writes = [];
  rows = [
    {
      schedule_id: 'sched_1', network_id: 'net-placeholder', name: '巡检', target_node_id: 'node-a', target_alias: '测试甲',
      task_content: '检查一遍日志', priority: 'high', schedule: { type: 'weekly', time: '08:30', weekdays: [1, 3, 5] }, timezone: 'Asia/Shanghai',
      misfire_policy: 'skip', status: 'active', next_run_at: new Date(Date.now() + 3600_000).toISOString(), last_run_at: null, revision: 4,
    },
    {
      schedule_id: 'sched_once', network_id: 'net-placeholder', name: '一次性发布', target_node_id: 'node-a', target_alias: '测试甲',
      task_content: '发一次版', priority: 'normal', schedule: { type: 'once', run_at: PAST }, timezone: 'Asia/Shanghai',
      misfire_policy: 'catch_up_once', status: 'completed', next_run_at: null, last_run_at: PAST, revision: 2,
    },
    {
      schedule_id: 'sched_gone', network_id: 'net-placeholder', name: '旧节点任务', target_node_id: 'node-gone', target_alias: '测试已下线',
      task_content: '旧节点上的活', priority: 'low', schedule: { type: 'interval', every_seconds: 7200 }, timezone: 'UTC',
      misfire_policy: 'catch_up_once', status: 'paused', next_run_at: null, last_run_at: null, revision: 1,
    },
  ];
};
const answer = (req) => {
  const u = new URL(req.url()), p = u.pathname, method = req.method();
  if (p.startsWith('/api/scheduled-tasks') && method !== 'GET') {
    writes.push({ method, path: p, body: JSON.parse(req.postData() || '{}') });
    if (p === '/api/scheduled-tasks' && method === 'POST') return json({ ok: true, schedule: { ...rows[0], schedule_id: 'sched_new' } });
    return json({ ok: true });
  }
  if (p === '/api/status') return json({ sessions: [{ alias: '测试甲', node_id: 'node-a', status: 'idle', runtime: 'codex', updated_at: new Date().toISOString() }] });
  if (p === '/api/nodes') return json({ ok: true, nodes: [{ node_id: 'node-a', alias: '测试甲', runtime: 'codex' }], count: 1 });
  if (p === '/api/scheduled-tasks') return json({ ok: true, schedules: rows });
  if (p.endsWith('/runs')) return json({ ok: true, runs: [] });
  return json({ ok: true, messages: [], tasks: [], nodes: [], sessions: [], schedules: [] });
};

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json', '.ico': 'image/x-icon' };
const web = createServer((req, res) => {
  let p = join(WEB, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(WEB, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(0, '127.0.0.1');
await new Promise(r => setTimeout(r, 200));
const WEB_URL = `http://127.0.0.1:${web.address().port}/`;

// Desktop-shell stub for login (the plain web branch hits SecureStore); plugin:http goes to page fetch,
// which page.route() answers. Default Chromium UA ⇒ desktop pointer UI; Android UA ⇒ phone (wide-layout.ts).
const initScript = ({ hubUrl, theme }) => {
  const profile = { serverUrl: hubUrl, token: 'utok_placeholder', username: 'tester', profileId: 'p-copy', displayName: 'tester', networkId: 'net-placeholder' };
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
        case 'get_theme_preference': return theme;
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
// Text checks also demand the PAINTED box (after overflow clipping) — a 0-wide title keeps its textContent.
const painted = (p) => !!p && p.painted && p.w >= 8;
const pw = (p) => p ? `painted ${p.w.toFixed(1)}×${p.h.toFixed(1)}` : 'painted (none)';

const open = async ({ phone }) => {
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, userAgent: ANDROID_UA, locale: 'zh-CN', deviceScaleFactor: 2, hasTouch: true }
    : { viewport: { width: 1200, height: 800 }, locale: 'zh-CN', deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await page.route(`${HUB}/**`, route => route.fulfill(answer(route.request())));
  await page.addInitScript(initScript, { hubUrl: HUB, theme: 'light' });
  await page.goto(WEB_URL);
  // Phone: the tab bar has a 定时任务 label; desktop: the icon rail only carries it as aria-label.
  await page.locator('[aria-label="定时任务"]').or(page.getByText('定时任务', { exact: true })).first().click({ timeout: 25000 });
  return { ctx, page };
};
const selectRow = async (page, id, filter) => {
  if (filter) await page.locator(`[data-testid="schedule-filter-${filter}"]`).click({ timeout: 15000 });
  await page.locator(`[data-testid="schedule-row-${id}"]`).getByRole('button').first().click({ timeout: 15000 });
  await page.locator('[data-testid="schedule-detail"]').waitFor({ timeout: 10000 });
};
const LABELS = ['立即执行', '暂停', '恢复', '编辑', '复制', '取消计划'];
// The action row: every button's box (the Pressable = parent of its text).
const measureActions = async (page) => {
  const detail = page.locator('[data-testid="schedule-detail"]');
  const out = [];
  for (const label of LABELS) {
    const txt = detail.getByText(label, { exact: true });
    if (await txt.count() === 0) continue;
    const b = await txt.first().locator('xpath=..').boundingBox();
    out.push({ label, x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) });
  }
  out.sort((a, b) => a.y - b.y || a.x - b.x);
  return out;
};
const checkRow = (tag, boxes) => {
  console.log(`\n${tag} action row (CSS px):\n| button | x | y | w | h | gap to prev |\n|---|---|---|---|---|---|`);
  boxes.forEach((b, i) => {
    const prev = boxes[i - 1];
    const gap = prev && Math.abs(prev.y - b.y) < 1 ? (b.x - (prev.x + prev.w)).toFixed(1) : '—';
    console.log(`| ${b.label} | ${b.x} | ${b.y} | ${b.w} | ${b.h} | ${gap} |`);
  });
  const copy = boxes.find(b => b.label === '复制');
  ck(`${tag}: 复制 present`, !!copy);
  if (!copy) return;
  const line = boxes.filter(b => Math.abs(b.y - copy.y) < 1);
  ck(`${tag}: all buttons on one line (no wrap)`, line.length === boxes.length, `${line.length}/${boxes.length}`);
  ck(`${tag}: same height as siblings`, boxes.every(b => Math.abs(b.h - copy.h) < 0.5), boxes.map(b => b.h).join('/'));
  const gaps = line.slice(1).map((b, i) => b.x - (line[i].x + line[i].w));
  ck(`${tag}: even gaps`, gaps.every(g => Math.abs(g - gaps[0]) < 0.5), gaps.map(g => g.toFixed(1)).join('/'));
  const edit = boxes.find(b => b.label === '编辑');
  if (edit) ck(`${tag}: 复制 directly after 编辑`, line.indexOf(copy) === line.indexOf(edit) + 1);
};
const form = (page) => page.locator('[data-testid="schedule-form"]');
const nonCreateWrites = () => writes.filter(w => !(w.method === 'POST' && w.path === '/api/scheduled-tasks'));

// ── A desktop ───────────────────────────────────────────────────────────────
{
  reset();
  const { ctx, page } = await open({ phone: false });
  await selectRow(page, 'sched_1');
  const boxes = await measureActions(page);
  checkRow('A desktop 1200×800', boxes);
  if (OUT) await page.screenshot({ path: `${OUT}/desktop-detail.png` });
  await page.locator('[data-testid="schedule-copy"]').click();
  await form(page).waitFor({ timeout: 10000 });
  const titleA = await paintedText(page, '[data-testid="schedule-form-title"]');
  ck('A: opens the NEW form, not 编辑', (await page.locator('[data-testid="schedule-form-title"]').innerText()) === '新建定时任务' && painted(titleA), pw(titleA));
  const name = page.getByPlaceholder('每日巡检');
  ck('A: name prefilled with 「 副本」', (await name.inputValue()) === '巡检 副本', await name.inputValue());
  ck('A: task prefilled', (await page.getByPlaceholder('节点收到的任务').inputValue()) === '检查一遍日志');
  const nodeA = await paintedText(page, '[data-testid="schedule-target-name"]');
  ck('A: node prefilled', (await page.locator('[data-testid="schedule-target-name"]').innerText()) === '测试甲' && painted(nodeA), pw(nodeA));
  ck('A: timezone prefilled', (await page.getByPlaceholder('Asia/Shanghai').inputValue()) === 'Asia/Shanghai');
  // #1000 把每天/每周的时间也换成了选择器（ScheduleClockPicker），旧的
  // getByPlaceholder('09:00') 输入框没有了。读选择器字段上的显示值（'HH:mm'）——
  // 断言的意图不变：每周的时间是从来源计划预填的。
  const weeklyTime = await page.locator('[data-testid="schedule-form-clock-field"]').innerText();
  ck('A: weekly time prefilled', weeklyTime.trim() === '08:30', weeklyTime);
  if (OUT) { await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}/desktop-copy-form.png` }); }
  await name.fill('巡检 周三版');
  await page.locator('[data-testid="schedule-form-save"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="schedule-form"]'), null, { timeout: 10000 }).catch(() => {});
  const posts = writes.filter(w => w.method === 'POST' && w.path === '/api/scheduled-tasks');
  ck('A: exactly one POST /api/scheduled-tasks', posts.length === 1, String(posts.length));
  const want = { name: '巡检 周三版', target_node_id: 'node-a', task: '检查一遍日志', priority: 'high', timezone: 'Asia/Shanghai',
    schedule: { type: 'weekly', time: '08:30', weekdays: [1, 3, 5] }, misfire_policy: 'skip', network_id: 'net-placeholder' };
  ck('A: POST body is the source with the new name', JSON.stringify(posts[0]?.body) === JSON.stringify(want), JSON.stringify(posts[0]?.body));
  ck('A: no PATCH / DELETE / run-now on the source', nonCreateWrites().length === 0, JSON.stringify(nonCreateWrites()));
  ck('A: form closed after save', (await form(page).count()) === 0);
  await ctx.close();
}
// ── B completed one-shot in the past ────────────────────────────────────────
{
  reset();
  const { ctx, page } = await open({ phone: false });
  await selectRow(page, 'sched_once', 'completed');
  const boxes = await measureActions(page);
  ck('B: completed schedule offers only 复制', boxes.map(b => b.label).join() === '复制', boxes.map(b => b.label).join());
  await page.locator('[data-testid="schedule-copy"]').click();
  await form(page).waitFor({ timeout: 10000 });
  // 「执行时间」现在是日期时间选择器（#990），旧的 ISO placeholder 输入框没有了。
  // 读选择器显示的值：'YYYY-MM-DD HH:MM:SS'（本地时间）—— 与旧的 '2026-08-10T09:00'
  // 一样是本地时刻，断言的意图不变。
  const whenText = await page.locator('[data-testid="schedule-form-run-at-value"]').innerText();
  const when = whenText.replace(' ', 'T');
  ck('B: one-shot time moved into the future', new Date(when).getTime() > Date.now(), when);
  const hint = page.locator('[data-testid="schedule-form-time-hint"]');
  // Below the form's scroll fold at 1200×800: scroll it in first, or the clip test reads the scroll offset, not the layout.
  if (await hint.count()) await hint.scrollIntoViewIfNeeded();
  const hintP = await paintedText(page, '[data-testid="schedule-form-time-hint"]');
  ck('B: hint explains the move', (await hint.count()) === 1 && (await hint.innerText()).includes('已过') && painted(hintP), `${await hint.count() ? await hint.innerText() : '(none)'}; ${pw(hintP)}`);
  if (OUT) { await hint.scrollIntoViewIfNeeded(); await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}/desktop-copy-once-past.png` }); }
  await page.locator('[data-testid="schedule-form-save"]').click();
  await page.waitForTimeout(1500);
  const post = writes.find(w => w.method === 'POST');
  ck('B: POST run_at is in the future, never the past one', post && post.body.schedule.type === 'once' && Date.parse(post.body.schedule.run_at) > Date.now() && post.body.schedule.run_at !== PAST, JSON.stringify(post?.body.schedule));
  ck('B: source untouched', nonCreateWrites().length === 0);
  await ctx.close();
}
// ── C source node gone ──────────────────────────────────────────────────────
{
  reset();
  const { ctx, page } = await open({ phone: false });
  await selectRow(page, 'sched_gone', 'paused');
  await page.locator('[data-testid="schedule-copy"]').click();
  await form(page).waitFor({ timeout: 10000 });
  const nodeC = await paintedText(page, '[data-testid="schedule-target-name"]');
  ck('C: missing node stays selected (alias shown)', (await page.locator('[data-testid="schedule-target-name"]').innerText()) === '测试已下线' && painted(nodeC), pw(nodeC));
  const hint = page.locator('[data-testid="schedule-target-hint"]');
  console.log(`   node field hint: ${await hint.count() ? await hint.innerText() : '(none)'}`);
  if (OUT) { await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}/desktop-copy-node-gone.png` }); }
  await page.locator('[data-testid="schedule-form-save"]').click();
  await page.waitForTimeout(1500);
  const post = writes.find(w => w.method === 'POST');
  ck('C: POST keeps the source node_id', post?.body.target_node_id === 'node-gone' && post?.body.name === '旧节点任务 副本');
  ck('C: source untouched', nonCreateWrites().length === 0);
  await ctx.close();
}
// ── D phone ─────────────────────────────────────────────────────────────────
// Measured first: five buttons need 84+58+58+58+86 + 4×8 = 376 px, the phone detail has 342 ⇒ 取消计划 wrapped.
// So on the single-pane phone detail 复制 sits in the top bar opposite 「‹ 定时任务」 and the row keeps its four.
{
  reset();
  const { ctx, page } = await open({ phone: true });
  await selectRow(page, 'sched_1');
  const boxes = (await measureActions(page));
  const row = boxes.filter(b => b.label !== '复制');
  console.log(`\nD phone 390×844 action row (CSS px):\n| button | x | y | w | h | gap to prev |\n|---|---|---|---|---|---|`);
  row.forEach((b, i) => console.log(`| ${b.label} | ${b.x} | ${b.y} | ${b.w} | ${b.h} | ${i ? (b.x - row[i - 1].x - row[i - 1].w).toFixed(1) : '—'} |`));
  ck('D: action row = 立即执行/暂停/编辑/取消计划 on one line', row.map(b => b.label).join() === '立即执行,暂停,编辑,取消计划' && row.every(b => b.y === row[0].y), row.map(b => `${b.label}@${b.y}`).join());
  const gaps = row.slice(1).map((b, i) => b.x - row[i].x - row[i].w);
  ck('D: row gaps even', gaps.every(g => Math.abs(g - gaps[0]) < 0.5), gaps.join('/'));
  const back = await page.getByText('‹ 定时任务', { exact: true }).locator('xpath=..').boundingBox();
  const copy = await page.locator('[data-testid="schedule-copy"]').boundingBox();
  const bar = await page.locator('[data-testid="schedule-copy"]').locator('xpath=..').boundingBox();
  console.log(`\nD phone top bar (CSS px):\n| item | x | y | w | h | center y |\n|---|---|---|---|---|---|`);
  for (const [n, b] of [['bar', bar], ['‹ 定时任务', back], ['复制', copy]]) console.log(`| ${n} | ${b.x.toFixed(1)} | ${b.y.toFixed(1)} | ${b.width.toFixed(1)} | ${b.height.toFixed(1)} | ${(b.y + b.height / 2).toFixed(1)} |`);
  ck('D: 复制 same height and center line as ‹ 定时任务', Math.abs(copy.height - back.height) < 0.5 && Math.abs((copy.y + copy.height / 2) - (back.y + back.height / 2)) < 0.5);
  ck('D: 复制 inset from the right edge like 返回 from the left', Math.abs((bar.x + bar.width - copy.x - copy.width) - (back.x - bar.x)) < 0.5, `left ${(back.x - bar.x).toFixed(1)} right ${(bar.x + bar.width - copy.x - copy.width).toFixed(1)}`);
  console.log(`   back button box: ${JSON.stringify(back)}`);
  if (OUT) await page.screenshot({ path: `${OUT}/phone-detail.png` });
  await page.locator('[data-testid="schedule-copy"]').click();
  await form(page).waitFor({ timeout: 10000 });
  const titleD = await paintedText(page, '[data-testid="schedule-form-title"]');
  ck('D: phone opens the new-schedule sheet', (await page.locator('[data-testid="schedule-form-title"]').innerText()) === '新建定时任务' && painted(titleD) && (await page.getByPlaceholder('每日巡检').inputValue()) === '巡检 副本', pw(titleD));
  if (OUT) { await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}/phone-copy-form.png` }); }
  await page.locator('[data-testid="schedule-form-save"]').click();
  await page.waitForTimeout(1500);
  ck('D: phone save = one POST, source untouched', writes.filter(w => w.method === 'POST').length === 1 && nonCreateWrites().length === 0);
  await ctx.close();
}
// ── E phone, completed one-shot: 复制 in the bar, no empty action row left behind ──
{
  reset();
  const { ctx, page } = await open({ phone: true });
  await selectRow(page, 'sched_once', 'completed');
  ck('E: completed one-shot offers 复制 on phone', (await page.locator('[data-testid="schedule-copy"]').count()) === 1);
  const detail = page.locator('[data-testid="schedule-detail"]');
  ck('E: no leftover action buttons', (await detail.getByText('编辑', { exact: true }).count()) === 0 && (await detail.getByText('立即执行', { exact: true }).count()) === 0);
  const label = await detail.getByText('任务内容', { exact: true }).boundingBox();
  const target = await detail.getByText('测试甲', { exact: true }).first().boundingBox();
  ck('E: 任务内容 follows the target line with no empty row gap (< 60 px)', label.y - (target.y + target.height) < 60, `${(label.y - target.y - target.height).toFixed(1)} px`);
  if (OUT) await page.screenshot({ path: `${OUT}/phone-completed-detail.png` });
  await ctx.close();
}

await browser.close();
web.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
