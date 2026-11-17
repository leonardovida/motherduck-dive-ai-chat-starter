import { test, expect, signIn, dive } from '../fixtures.mjs';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const noOverflow = page => expect.poll(() => overflow(page)).toBeLessThanOrEqual(0);
const box = locator => locator.evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, bottom: r.bottom, width: r.width, height: r.height, font: parseFloat(getComputedStyle(el).fontSize) }; });
// Touch screens get 44px targets for primary controls (40px for dense ones) and 16px text in
// fields, below which iOS zooms in when a field is focused. Sizes settle after layout, so poll.
const tappable = (locator, min = 44) => expect(async () => {
  const size = await box(locator);
  expect(size.width).toBeGreaterThanOrEqual(min);
  expect(size.height).toBeGreaterThanOrEqual(min);
}).toPass();
const noZoom = locator => expect.poll(async () => (await box(locator)).font).toBeGreaterThanOrEqual(16);
// Elements that reach past the right edge of the screen. Content inside its own scroll box (a
// wide table or code) is allowed to, and cards clip, so page overflow alone would miss some.
const beyondRight = root => root.evaluate(panel => [...panel.querySelectorAll('*')].filter(el => {
  if (el.getBoundingClientRect().right <= innerWidth + 1 || el.closest('.sr-only')) return false;
  for (let parent = el.parentElement; parent && parent !== panel; parent = parent.parentElement) {
    if (['auto', 'scroll'].includes(getComputedStyle(parent).overflowX)) return false;
  }
  return true;
}).map(el => `${el.tagName}.${el.className}`.slice(0, 80)));

async function openApp(page) {
  await signIn(page);
  await expect(dive(page).getByText(/Session e2e-session-/)).toBeVisible();
}
async function openChat(page) {
  await page.getByRole('button', { name: 'Chat' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('textbox', { name: 'Your question' })).toBeEnabled();
  return sheet;
}

test('on a phone the Dive, the Dive list and chat fit the screen', async ({ page }) => {
  await openApp(page);
  await noOverflow(page);
  await page.getByRole('button', { name: /sidebar|menu|Dives/i }).first().click();
  await page.getByRole('button', { name: /^Explorer/ }).click();
  await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toContainText('Explorer');
  await page.getByRole('button', { name: 'Chat' }).click();
  const box = page.getByRole('textbox', { name: 'Your question' });
  await expect(box).toBeEnabled();
  await box.fill('Which region am I looking at?');
  await box.press('Enter');
  await expect(page.getByRole('dialog').getByRole('log')).toContainText('Stand-in answer');
  await noOverflow(page);
  await page.getByRole('button', { name: 'Close chat' }).click();
  await expect(box).toBeHidden();
});

test('the chat sheet follows the visible viewport, so the iOS keyboard cannot cover the composer', async ({ page }) => {
  // Stands in for window.visualViewport, which shrinks and moves when the iOS keyboard opens.
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), { width: innerWidth, height: innerHeight, offsetLeft: 0, offsetTop: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
    window.keyboard = (height, offsetTop) => { Object.assign(viewport, { height, offsetTop }); viewport.dispatchEvent(new Event('resize')); };
  });
  await openApp(page);
  const sheet = await openChat(page);
  await page.evaluate(() => window.keyboard(450, 120));
  await expect.poll(async () => { const size = await box(sheet); return [Math.round(size.top), Math.round(size.height)]; }).toEqual([120, 450]);
  // The header and the composer are both inside the part above the keyboard.
  expect((await box(sheet.getByRole('button', { name: 'Close chat' }))).top).toBeGreaterThanOrEqual(120);
  expect((await box(sheet.getByRole('button', { name: 'Send message' }))).bottom).toBeLessThanOrEqual(570);
  await page.evaluate(() => window.keyboard(844, 0));
  await expect.poll(async () => Math.round((await box(sheet)).height)).toBe(844);
});

test.describe('at 360px', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('sign-in has large targets and fields that do not zoom', async ({ page }) => {
    await page.goto('/');
    const password = page.getByLabel('Password', { exact: true });
    await expect(password).toBeVisible();
    // Edge to edge, so the layout can pad itself with the safe-area insets.
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
    await noOverflow(page);
    await noZoom(password);
    await tappable(page.getByRole('button', { name: /sign in/i }));
    await tappable(page.getByRole('button', { name: 'Show password' }), 40);
    await tappable(page.getByRole('button', { name: /^Theme/ }));
  });

  test('the top bar, the drawer and the full-screen chat have large targets', async ({ page }) => {
    await openApp(page);
    await noOverflow(page);
    for (const name of ['Menu', 'Chat', /^Theme/]) await tappable(page.getByRole('button', { name }));
    // Sign out moves from the top bar into the drawer on a phone.
    await expect(page.locator('.workspace-topbar').getByRole('button', { name: 'Sign out' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Menu' }).click();
    await tappable(page.getByRole('dialog').getByRole('button', { name: 'Sign out' }));
    await page.keyboard.press('Escape');
    const sheet = await openChat(page);
    // The chat covers the whole screen and has an obvious close button.
    await expect.poll(async () => (await box(sheet)).width).toBeCloseTo(360, 0);
    await tappable(sheet.getByRole('button', { name: 'Close chat' }));
    await tappable(sheet.getByRole('button', { name: 'Send message' }));
    await noZoom(sheet.getByRole('textbox', { name: 'Your question' }));
    await tappable(sheet.getByRole('button', { name: 'What does this Dive show?' }), 40);
    await noOverflow(page);
  });
});

test.describe('on a large phone (430px)', () => {
  test.use({ viewport: { width: 430, height: 932 } });

  test('the chat sheet covers the whole width, with no strip of page left to tap', async ({ page }) => {
    await openApp(page);
    const sheet = await openChat(page);
    await expect.poll(async () => (await box(sheet)).width).toBeCloseTo(430, 0);
    // A tap at the far left edge lands in the chat, not on the dimmed page that would close it.
    expect(await page.evaluate(() => Boolean(document.elementFromPoint(2, 400)?.closest('.chat-sheet')))).toBe(true);
    await noOverflow(page);
  });
});

test.describe('on a phone held sideways (844x390)', () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test('the Dive fits and the chat composer stays on screen while typing', async ({ page }) => {
    await openApp(page);
    await noOverflow(page);
    const sheet = await openChat(page);
    const question = sheet.getByRole('textbox', { name: 'Your question' });
    await question.focus();
    // A short screen drops the subtitle, and the starter questions while typing.
    await expect(sheet.locator('.chat-panel-header p')).toBeHidden();
    await expect(sheet.getByRole('group', { name: 'Suggested questions' })).toBeHidden();
    await expect(question).toBeInViewport();
    expect((await box(sheet.getByRole('button', { name: 'Send message' }))).bottom).toBeLessThanOrEqual(390);
    await tappable(sheet.getByRole('button', { name: 'Close chat' }));
    await noOverflow(page);
  });
});

test.describe('on a tablet (768px, touch)', () => {
  test.use({ viewport: { width: 768, height: 1024 }, isMobile: false, hasTouch: true });

  test('the desktop layout gets touch-sized controls and fields that do not zoom', async ({ page }) => {
    await page.goto('/');
    await noZoom(page.getByLabel('Password', { exact: true }));
    await openApp(page);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    for (const name of ['Collapse sidebar', 'Chat', /^Theme/]) await tappable(page.getByRole('button', { name }));
    await tappable(page.getByRole('button', { name: 'Sign out' }));
    const sheet = await openChat(page);
    await noZoom(sheet.getByRole('textbox', { name: 'Your question' }));
    await tappable(sheet.getByRole('button', { name: 'Send message' }));
    await noOverflow(page);
  });
});

// The e2e server runs in shared-password mode, so the accounts-mode admin portal is stubbed.
async function stubAdmin(page) {
  await page.route('**/api/auth', route => route.fulfill({ json: { mode: 'accounts', authenticated: true, appTitle: 'E2E', sso: [], user: { id: 'u1', username: 'admin', isAdmin: true, canManage: true } } }));
  const group = { id: 'g1', name: 'A group with a rather long name for a phone screen', description: '', dives: '*', chat: true, chatReady: true, serviceAccount: 'svc_research', memberCount: 1 };
  const users = [{ id: 'u1', username: 'admin', name: 'Admin', email: 'admin@example.com', role: 'admin', groups: [{ id: 'g1', manager: true }], updatedAt: '2026-11-01T00:00:00Z' }];
  await page.route('**/api/admin/people', route => route.fulfill({ json: { scope: 'admin', me: 'u1', maxImport: 200, mdAutomatic: false, dives: [{ key: 'overview', title: 'Overview', connected: true }], groups: [group], users } }));
  await page.route('**/api/admin/access-sync', route => route.fulfill({ json: { mode: 'manual', totals: { synced: 1, pending: 0, failed: 1, toRemove: 0 }, sql: 'GRANT READ ON SHARE a_share_with_a_name_far_too_long_for_a_phone TO svc_research;', planned: [], grants: [
    { grantee: 'svc_research', kind: 'service_account', url: 'md:_share/a_share_with_a_name_far_too_long_for_a_phone/0123456789abcdef', alias: 'research', share: 'a_share_with_a_name_far_too_long_for_a_phone', state: 'failed', detail: 'Catalog Error: Share does not exist or you do not have access to it' },
    { grantee: 'admin_md_user', kind: 'user', url: 'md:_share/e2e/abc', alias: '', share: 'e2e', state: 'synced' },
  ] } }));
  const split = (key, value) => ({ [key]: value, questions: 3, unsuccessful: 1, negative: 0, positive: 1 });
  await page.route('**/api/admin/insights?*', route => route.fulfill({ json: {
    scope: 'admin', digest: false, topicsAvailable: true, facets: { dives: ['overview'], groups: [group.name] },
    totals: { questions: 3, askers: 1, conversations: 1, answered: 2, failed: 1, stopped: 0, unanswered: 0, median_ms: 2000, input_tokens: 10, output_tokens: 10, unclassified: 0, positive: 1, negative: 0, unsuccessful: 1 },
    daily: Array.from({ length: 30 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, questions: i % 3, unsuccessful: 0, negative: 0, positive: 0 })),
    dives: [split('dive_key', 'overview')], groups: [split('group_name', group.name)], models: [split('model_tier', 'sol')], frequent: [], attention: [], topics: [], gaps: [], cost: null,
  } }));
  const conversation = { id: 'c1', title: 'Which regions in the northern sales territory had the largest orders in the last quarter?', user_label: 'admin', dive_key: 'overview', message_count: 2, model_tiers: 'sol', updated_at: '2026-11-01T10:00:00Z', created_at: '2026-11-01T10:00:00Z', unsuccessful_count: 1, negative_count: 1, positive_count: 0 };
  await page.route('**/api/admin/conversations?*', route => route.fulfill({ json: { conversations: [conversation] } }));
  await page.route('**/api/admin/conversations/c1', route => route.fulfill({ json: { conversation: { ...conversation, messages: [
    { id: 'm1', role: 'user', content: conversation.title, created_at: '2026-11-01T10:00:00Z' },
    { id: 'm2', role: 'assistant', content: 'The largest was a region with a very long name.', created_at: '2026-11-01T10:00:05Z', status: 'answered', model_tier: 'sol', worked_ms: 4200,
      tools: [{ tool: 'runQuery', purpose: 'Top regions', sql: 'SELECT region_name FROM sales.orders_with_an_extremely_long_table_name LIMIT 20', rowCount: 20 }],
      queries: [{ bound_sql: 'SELECT region_name, sum(amount_usd) FROM sales.orders_with_an_extremely_long_table_name GROUP BY ALL', started_at: '2026-11-01T10:00:02Z', ms: 120, rows: 20, tool: 'runQuery' }] },
  ] } } }));
}

test.describe('the admin portal at 360px', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('keeps its tabs on one scrolling row and every tab fits the screen', async ({ page }) => {
    await openApp(page);
    await stubAdmin(page);
    await page.goto('/admin');
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(7);
    await expect.poll(() => tabs.evaluateAll(list => new Set(list.map(tab => Math.round(tab.getBoundingClientRect().top))).size)).toBe(1);
    const tablist = page.getByRole('tablist');
    expect(await tablist.evaluate(list => list.scrollWidth > list.clientWidth)).toBe(true);
    // A fade marks the edge with more tabs, and opening a far tab scrolls only the row, not the page.
    await expect(tablist).toHaveAttribute('data-more-end', 'true');
    await tappable(page.getByRole('tab', { name: 'People' }));
    await noZoom(page.getByLabel('Username', { exact: true }));
    await noOverflow(page);
    expect(await beyondRight(page.locator('#admin-panel'))).toEqual([]);

    await page.getByRole('tab', { name: 'MotherDuck access' }).click();
    await expect(page.getByText('a_share_with_a_name_far_too_long_for_a_phone').first()).toBeVisible();
    await noOverflow(page);
    expect(await beyondRight(page.locator('#admin-panel'))).toEqual([]);

    await page.getByRole('tab', { name: 'Questions' }).click();
    await expect(page.getByRole('tab', { name: 'Questions' })).toBeInViewport();
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await expect(page.getByRole('heading', { name: 'By group' })).toBeVisible();
    await noZoom(page.getByRole('combobox', { name: 'All groups' }));
    await noOverflow(page);
    expect(await beyondRight(page.locator('#admin-panel'))).toEqual([]);
    // A tap on the chart shows that day's numbers; a tap elsewhere puts the totals back.
    const chart = page.getByRole('img', { name: /Questions per day/ });
    await chart.scrollIntoViewIfNeeded();
    const area = await box(chart);
    await page.touchscreen.tap(area.left + area.width * 0.98, area.top + area.height / 2);
    await expect(page.getByText(/^Oct 30: /)).toBeVisible();
    await page.touchscreen.tap(20, 20);
    await expect(page.getByText(/questions in this period/)).toBeVisible();

    await page.getByRole('tab', { name: 'Conversations' }).click();
    await noZoom(page.getByRole('combobox', { name: 'All people' }));
    await tappable(page.getByRole('combobox', { name: 'All people' }));
    await tappable(page.getByText('Only failed, stopped or rated not helpful'), 40);
    await page.getByRole('button', { name: /Which regions in the northern/ }).click();
    await tappable(page.getByRole('button', { name: 'Export JSON' }), 40);
    await noOverflow(page);
    expect(await beyondRight(page.locator('#admin-panel'))).toEqual([]);
  });
});
