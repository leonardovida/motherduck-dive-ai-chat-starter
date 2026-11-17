import { test, expect } from '../fixtures.mjs';
import { E2E } from '../config.mjs';

// SHARED_PASSWORD_ADMIN: personal accounts next to the shared password, which signs in as the
// built-in administrator. The stand-in server runs plain shared-password mode, so GET /api/auth
// and the account and admin endpoints are stubbed; the shared password itself is checked for real.

const SHARED_ADMIN = { name: 'Shared sign-in', username: null, isAdmin: true, canManage: true, chat: true, mode: 'password', sharedAdmin: true };
const authState = signedIn => ({ mode: 'accounts', sharedPassword: true, authenticated: Boolean(signedIn), appTitle: E2E.title, sso: [], ...(signedIn ? { user: signedIn, recording: true } : {}) });

test('a two-way switch picks a personal account or the shared password, and the browser remembers it', async ({ page }) => {
  let signedIn = null;
  await page.route('**/api/auth', route => (route.request().method() === 'GET' ? route.fulfill({ json: authState(signedIn) }) : route.fallback()));
  const accountSignIns = [];
  await page.route('**/api/account/sign-in/username', route => { accountSignIns.push(route.request().postDataJSON()); return route.fulfill({ status: 401, json: { code: 'INVALID_USERNAME_OR_PASSWORD', message: 'Invalid username or password' } }); });
  await page.goto('/');
  const switcher = page.getByRole('group', { name: 'How you sign in' });
  const personal = switcher.getByRole('button', { name: 'Personal account' });
  const shared = switcher.getByRole('button', { name: 'Shared password' });
  const username = page.getByLabel('Username', { exact: true });
  const password = page.getByLabel('Password', { exact: true });
  const submit = page.getByRole('button', { name: /sign in/i });

  // A personal account by default, so a person's password never goes to the shared sign-in.
  await expect(personal).toHaveAttribute('aria-pressed', 'true');
  await expect(shared).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('Sign in with your username and password.')).toBeVisible();
  await password.fill('anns-password-123');
  await submit.click();
  await expect(page.getByText('Enter your username and password.')).toBeVisible();
  await username.fill('ann');
  await submit.click();
  await expect(page.getByText('That username and password were not accepted.')).toBeVisible();
  expect(accountSignIns).toEqual([{ username: 'ann', password: 'anns-password-123' }]);

  // The shared password: no username field, and switching clears what was typed.
  await shared.click();
  await expect(shared).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Administrators sign in with the shared password.')).toBeVisible();
  await expect(username).toHaveCount(0);
  await expect(password).toHaveValue('');
  await expect(page.getByText('That username and password were not accepted.')).toHaveCount(0);
  await password.fill('not-the-password');
  await submit.click();
  await expect(page.getByText('That password was not accepted.')).toBeVisible();
  signedIn = SHARED_ADMIN;
  await password.fill(E2E.password);
  await submit.click();
  await expect(page.getByRole('link', { name: 'People and access' })).toBeVisible();
  for (const name of ['Conversations and SQL', 'Questions asked', 'AI models', 'Activity log']) await expect(page.getByRole('link', { name })).toBeVisible();
  expect(accountSignIns).toHaveLength(1);
  // The administrator has no personal password to change.
  await expect(page.getByRole('button', { name: 'Change password' })).toHaveCount(0);

  // The next visit in this browser opens on the shared password.
  signedIn = null;
  await page.reload();
  await expect(shared).toHaveAttribute('aria-pressed', 'true');
  await expect(username).toHaveCount(0);
});

test.describe('on a phone (360px, touch)', () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

  test('the fields are 16px, so iOS does not zoom, the switch and button are 44px, and the form fits the screen', async ({ page }) => {
    await page.route('**/api/auth', route => (route.request().method() === 'GET' ? route.fulfill({ json: authState(null) }) : route.fallback()));
    await page.goto('/');
    const size = locator => locator.evaluate(el => ({ font: parseFloat(getComputedStyle(el).fontSize), height: el.getBoundingClientRect().height, width: el.getBoundingClientRect().width }));
    for (const field of [page.getByLabel('Username', { exact: true }), page.getByLabel('Password', { exact: true })]) await expect.poll(async () => (await size(field)).font).toBeGreaterThanOrEqual(16);
    for (const name of ['Personal account', 'Shared password']) await expect.poll(async () => (await size(page.getByRole('button', { name }))).height).toBeGreaterThanOrEqual(44);
    await expect.poll(async () => (await size(page.getByRole('button', { name: /sign in/i }))).height).toBeGreaterThanOrEqual(44);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  });
});

test('the shared administrator adds people and sets a password from the People tab', async ({ page }) => {
  const seen = [];
  page.on('request', request => seen.push(new URL(request.url()).pathname));
  await page.route('**/api/auth', route => route.fulfill({ json: authState(SHARED_ADMIN) }));
  const people = { scope: 'admin', me: 'shared', maxImport: 200, mdGrants: false, mdAutomatic: false, dives: [{ key: 'overview', title: 'Overview', connected: true }], groups: [], users: [{ id: 'u-ann', username: 'ann', displayUsername: 'ann', name: 'Ann', email: 'ann@accounts.invalid', role: 'user', diveAccess: '*', chatAccess: true, groups: [], updatedAt: '2026-11-01T00:00:00Z' }] };
  const added = [];
  await page.route('**/api/admin/people', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: people });
    added.push(route.request().postDataJSON());
    return route.fulfill({ json: { results: [{ username: 'lena', id: 'u-lena', setupUrl: `${new URL(page.url()).origin}/#setup=${'a'.repeat(43)}`, expiresAt: '2026-11-24T00:00:00Z' }] } });
  });
  const passwords = [];
  await page.route('**/api/account/admin/set-user-password', route => { passwords.push(route.request().postDataJSON()); return route.fulfill({ json: { status: true } }); });
  await page.goto('/admin');

  const tabs = page.getByRole('tablist');
  for (const name of ['People', 'Groups', 'Activity', 'Questions', 'Conversations', 'Models']) await expect(tabs.getByRole('tab', { name })).toBeVisible();
  await expect(tabs.getByRole('tab', { name: 'MotherDuck access' })).toHaveCount(0);
  // No MotherDuck usernames anywhere in this mode.
  await expect(page.getByLabel('MotherDuck username (optional)')).toHaveCount(0);

  await page.getByLabel('Username', { exact: true }).fill('lena');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Added people')).toBeVisible();
  await expect(page.getByText(/#setup=a{43}/)).toBeVisible();
  expect(added).toEqual([expect.objectContaining({ people: [expect.objectContaining({ username: 'lena' })], role: 'user' })]);

  // The shared administrator is nobody in the list, so every person can be changed.
  await expect(page.getByRole('button', { name: 'Delete: ann' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit access: ann' }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  await expect(page.getByLabel('MotherDuck username (optional)')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit access: ann' }).click();
  await page.getByRole('button', { name: 'Set password: ann' }).click();
  await page.getByLabel('Password (12+ characters): ann').fill('a-new-password-123');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Password saved. ann is signed out everywhere else.')).toBeVisible();
  expect(passwords).toEqual([{ userId: 'u-ann', newPassword: 'a-new-password-123' }]);
  expect(seen).not.toContain('/api/admin/access-sync');
});
