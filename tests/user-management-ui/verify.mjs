import { run } from '../agent-org-ui/harness.mjs';

await run(new URL('./artifacts/', import.meta.url).pathname, async ({ c, page, test, shot, navigate, state }) => {
  const el = id => page.getByTestId(id);
  const rows = () => page.locator('[data-testid^="user-row-"]').filter({ has: page.locator('[data-testid$="-label"]') });
  await navigate('users'); await el('user-management-count').waitFor();
  test('actual full App Settings users navigation', await el('user-management').isVisible());
  test('total count and all five members', await el('user-management-count').innerText() === '5' && await rows().count() === 5);
  test('duplicate display name username suppressed', (await el('user-row-same-name').innerText()).split('same-name').length === 2);
  test('distinct username retained', (await el('user-row-admin.fixture').innerText()).includes('admin.fixture'));
  test('self edit denial unchanged', await el('user-row-fixture-viewer').getAttribute('role') !== 'button' && await el('user-row-fixture-viewer').getAttribute('aria-disabled') === 'true');
  test('others retain member edit affordance', await el('user-row-same-name').getAttribute('role') === 'button');
  await shot('members');
  for (const [role, n] of [['owner', 1], ['admin', 1], ['member', 2], ['viewer', 1], ['all', 5]]) {
    await el(`user-management-filter-${role}`).focus();
    await page.keyboard.press('Space');
    test(`${role} filter count and selected state`, await rows().count() === n && await el(`user-management-filter-${role}`).getAttribute('aria-pressed') === 'true' && await el('user-management-count').innerText() === '5');
  }
  await el('user-management-search').fill('  READ ONLY  ');
  test('trimmed case-insensitive display name search', await rows().count() === 1 && await el('user-row-viewer.fixture').isVisible());
  await el('user-management-search-clear').click();
  test('clear search restores all rows', await rows().count() === 5);
  await el('user-management-search').fill('ADMIN.FIXTURE');
  test('case-insensitive username search', await rows().count() === 1 && await el('user-row-admin.fixture').isVisible());
  await el('user-management-filter-member').click();
  test('role and search intersect with no-results message', await rows().count() === 0 && await el('user-management-empty').isVisible());
  await shot('search-no-results');
  await el('user-management-search-clear').click(); await el('user-management-filter-all').click();
  const newBox = await el('user-management-new').boundingBox(), countBox = await el('user-management-count').boundingBox();
  test('compact new user stays in count header', newBox && countBox && Math.abs(newBox.y + newBox.height / 2 - countBox.y - countBox.height / 2) < 10 && newBox.x > countBox.x && newBox.x + newBox.width <= c.width);
  test('responsive member columns', c.phone ? await el('user-management-columns').count() === 0 : await el('user-management-columns').count() === 1);
  await el('user-management-new').click(); await el('new-user-dialog').waitFor();
  test('new header action opens existing dialog', await el('new-user-username').isVisible() && await el('new-user-password').isVisible() && await el('new-user-network').count() === 1);
  test('empty form submit disabled', await el('new-user-confirm').getAttribute('aria-disabled') === 'true');
  await el('new-user-username').fill('fixture-draft'); await el('new-user-password').fill('disposable-fixture-only'); await el('new-user-display-name').fill('Never Submitted');
  await el('new-user-role-viewer').click();
  await shot('new-user-dialog');
  test('typing and role selection do not mutate', (await state()).writes.length === 0 && (await state()).unhandled.length === 0);
  const box = await el('new-user-dialog').boundingBox();
  test('new user dialog bounded by viewport', box && box.x >= 0 && box.y >= 0 && box.x + box.width <= c.width + 1 && box.y + box.height <= c.height + 1, box);
  await el('new-user-cancel').click(); await el('new-user-dialog').waitFor({ state: 'hidden' });
  test('cancel leaves members unchanged with zero mutations', (await state()).writes.length === 0 && (await state()).unhandled.length === 0 && await rows().count() === 5);
  test('no document horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
});
