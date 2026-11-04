import { test, expect, signIn, dive } from '../fixtures.mjs';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

test('on a phone the Dive, the Dive list and chat fit the screen', async ({ page }) => {
  await signIn(page);
  await expect(dive(page).getByText(/Session e2e-session-/)).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: /sidebar|menu|Dives/i }).first().click();
  await page.getByRole('button', { name: /^Explorer/ }).click();
  await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toContainText('Explorer');
  await page.getByRole('button', { name: 'Chat' }).click();
  const box = page.getByRole('textbox', { name: 'Your question' });
  await expect(box).toBeEnabled();
  await box.fill('Which region am I looking at?');
  await box.press('Enter');
  await expect(page.getByRole('dialog').getByRole('log')).toContainText('Stand-in answer');
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Close chat' }).click();
  await expect(box).toBeHidden();
});
