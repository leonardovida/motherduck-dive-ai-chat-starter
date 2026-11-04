import { test, expect, signIn, dive } from '../fixtures.mjs';
import { E2E } from '../config.mjs';

test('the password is required and checked', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(E2E.title);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByText('Enter the password to continue.')).toBeVisible();
  await signIn(page, 'not-the-password');
  await expect(page.getByText('That password was not accepted.')).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
});

test('a session survives a reload and ends on sign out', async ({ page, request }) => {
  expect((await request.get('/api/dives')).status()).toBe(401);
  await signIn(page);
  await expect(dive(page).getByText(/Session e2e-session-/)).toBeVisible();
  await page.reload();
  await expect(dive(page).getByText(/Session e2e-session-/)).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  expect((await page.request.get('/api/dives')).status()).toBe(401);
});

test('the password can be revealed while typing', async ({ page }) => {
  await page.goto('/');
  const field = page.getByLabel('Password', { exact: true });
  await field.fill('secret-value');
  await expect(field).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(field).toHaveAttribute('type', 'text');
});
