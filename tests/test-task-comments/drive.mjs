// #474 任务评论(Hub ≥ preview.90:requirements_comment / POST /api/requirements/{id}/comments,存为动态 kind = comment)
// 在 app 里看得见、读得清。Placeholder data only, served in-page by the Tauri stub in tests/test-layout-sweep/harness.mjs
// (no hub process, no port, no HOME touched). Not in CI: needs Playwright + Chromium and a web export.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-task-comments/drive.mjs
//
// desktop 1440×900 and phone 390×844 (Android UA), light + dark:
//   detail    open the task → 「评论」 section: both comments, oldest first, author (Agent tagged) + time, the full
//             multi-line text painted (not clipped to one line), inside the detail column
//   activity  「动态」: the comment is its own row (not folded into 「更新了 N 项」) with 「评论:」 and its text painted
//   old hub   events without comments (or no events capability): no 评论 section, detail otherwise unchanged
// Exit 1 on any failure.
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA, paintedText } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const AGENT_TEXT = '进展:示例草稿已经写完。\n第二行:还差核对版本号。\n第三行:明天上午给人看。';
const HUMAN_TEXT = '好的,我下午看。';
const fixture = ({ comments }) => {
  const now = Date.now();
  const at = (min) => new Date(now - min * 60000).toISOString();
  const R = (id, seq, name, o) => ({ id, seq, name, priority: 'normal', assignee: '', column: 'doing', owner: null, participants: [], agent_owner: null, project_id: null, due: '', createdAt: at(3000), updatedAt: at(1), description: '示例描述', checklist: [], tags: [], parent_id: null, ...o });
  const t1 = '示例任务:评论显示';
  const E = (id, min, actor, kind, field, old, nw) => ({ id: String(id), requirement_id: 'r1', seq: 41, title: t1, actor, kind, field, old, new: nw, at: at(min) });
  const na = { kind: 'node', id: 'n_sweep_a' }, ua = { kind: 'user', id: 'u_a' };
  window.__tasksFixture = {
    meId: 'u_tester',
    requirements: [R('r1', 41, t1)],
    projects: [],
    people: [
      { kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' },
      { kind: 'user', id: 'u_a', networkId: 'net-sweep', name: '示例成员甲' },
      { kind: 'node', id: 'n_sweep_a', networkId: 'net-sweep', name: '示例-A' },
    ],
    capabilities: ['agent_owner', 'description', 'checklist', 'requirement_seq', 'events'],
    events: [
      ...(comments ? [E(105, 2, na, 'comment', null, null, { text: window.__agentText }), E(104, 3, na, 'changed', 'column', 'pool', 'doing'), E(103, 4, na, 'changed', 'priority', 'low', 'high'), E(102, 30, ua, 'comment', null, null, { text: window.__humanText })] : [E(104, 3, na, 'changed', 'column', 'pool', 'doing')]),
      E(101, 60, ua, 'created', null, null, { title: t1, column: 'pool' }),
    ],
  };
};

const tid = (id) => `[data-testid="${id}"]`;
let failures = 0;
const record = (where, what, checks, extra = {}) => {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  console.log(JSON.stringify({ where, what, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-', ...extra }));
};
const box = async (page, sel) => page.locator(sel).first().boundingBox().catch(() => null);

const VIEWPORTS = { desktop: { w: 1440, h: 900 }, phone: { w: 390, h: 844, ua: ANDROID_UA } };
const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
for (const [name, V] of Object.entries(VIEWPORTS)) {
  for (const theme of ['light', 'dark']) {
    for (const comments of theme === 'light' ? [true, false] : [true]) {
      const where = `${name}/${theme}${comments ? '' : '/no-comments'}`;
      const ctx = await browser.newContext({ viewport: { width: V.w, height: V.h }, ...(V.ua ? { userAgent: V.ua } : {}), colorScheme: theme, deviceScaleFactor: 2, locale: 'zh-CN' });
      const page = await ctx.newPage();
      const press = (l) => l.click();
      try {
        await page.addInitScript(([a, h]) => { window.__agentText = a; window.__humanText = h; }, [AGENT_TEXT, HUMAN_TEXT]);
        await page.addInitScript(initScript, { theme });
        await page.addInitScript(fixture, { comments });
        await page.addInitScript(() => { try { localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
        await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
        await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
        await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' }));
        await page.waitForTimeout(500);
        const board = page.locator(tid('tasks-view-board')).first();
        if (await board.count() && await board.isVisible()) { await press(board); await page.waitForTimeout(300); }
        await press(page.locator(tid('req-card-r1')).first());
        await page.locator(tid('req-edit-name')).first().waitFor({ timeout: 8000 });
        await page.waitForTimeout(1200); // the section loads after the detail opens
        if (comments) {
          await page.locator(tid('req-comments')).first().scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
          // 评论正文现在由共用 CommentBody 渲染(#1831):鼠标设备的「复制」按钮 testID 是
          // `req-comment-text-<id>-copy`,它同样以 `req-comment-text-` 开头。这里要的是**正文**
          // 节点的顺序,所以按「精确是 req-comment-text-<数字>」过滤,别把操作按钮算进评论列表。
          const ids = await page.locator('[data-testid^="req-comment-text-"]').evaluateAll(
            els => els.map(e => e.getAttribute('data-testid')).filter(id => /^req-comment-text-\d+$/.test(id || '')));
          const agent = await paintedText(page, tid('req-comment-text-105'));
          const human = await paintedText(page, tid('req-comment-text-102'));
          const agentBox = await box(page, tid('req-comment-text-105'));
          const section = await box(page, tid('req-comments'));
          const detail = await box(page, tid('req-detail'));
          const headerText = await page.locator(tid('req-comment-105')).first().innerText().catch(() => '');
          if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-detail.png` });
          record(where, 'detail', {
            section: (await page.locator(tid('req-comments')).count()) === 1,
            oldestFirst: ids.join() === 'req-comment-text-102,req-comment-text-105',
            fullText: !!agent?.painted && agent.text === AGENT_TEXT,
            multiLine: !!agentBox && agentBox.height >= 3 * 18,
            humanPainted: !!human?.painted && human.text === HUMAN_TEXT,
            agentTagged: headerText.includes('示例-A') && headerText.includes('Agent'),
            insideDetail: !!section && !!detail && section.x >= detail.x - 0.5 && section.x + section.width <= detail.x + detail.width + 0.5,
          }, { ids: ids.join(), agentH: agentBox && Math.round(agentBox.height) });
        } else {
          record(where, 'no comments → no section', { none: (await page.locator(tid('req-comments')).count()) === 0, detailOk: (await page.locator(tid('req-edit-name')).count()) > 0 });
        }
        if (comments) {
          const close = page.locator(tid('req-detail-close')).first();
          if (await close.count()) { await press(close); await page.waitForTimeout(400); }
          await press(page.locator(tid('tasks-view-activity')).first());
          await page.locator(tid('task-activity')).waitFor({ timeout: 10000 });
          await page.locator(tid('activity-comment')).first().waitFor({ timeout: 8000 });
          const comment = await paintedText(page, `${tid('activity-row-105')} ${tid('activity-comment')}`);
          const rowText = await page.locator(tid('activity-row-105')).first().innerText();
          const folded = await page.locator(tid('activity-expand-105')).count();
          if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-activity.png` });
          record(where, 'activity', {
            ownRow: folded === 0,
            label: rowText.includes('评论'),
            text: !!comment?.painted && comment.text === AGENT_TEXT,
            two: (await page.locator(tid('activity-comment')).count()) === 2,
          });
        }
      } catch (e) {
        record(where, 'run', { ran: false }, { error: String(e).split('\n')[0] });
        if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-FAIL.png` }).catch(() => {});
      }
      await ctx.close();
    }
  }
}
await browser.close();
web.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
