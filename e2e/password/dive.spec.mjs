import { test, expect, signIn, dive, embedRequests, clearEmbedRequests, failEmbedSessions } from '../fixtures.mjs';
import { E2E } from '../config.mjs';

test.beforeEach(async () => { await clearEmbedRequests(); });

test('the server opens the embed session; the browser gets only the session, in the URL fragment', async ({ page }) => {
  await signIn(page);
  await expect(dive(page).getByText(/Session e2e-session-/)).toBeVisible();
  const [first] = await embedRequests();
  expect(first.dive).toBe(E2E.dives.overview);
  expect(first.body).toMatchObject({ username: 'e2e_reader', session_name: 'embedded-dive-chat-overview', required_resources: [], initial_state: { app_theme: 'light', app_embedded: true } });
  const src = await page.locator('iframe.dive-frame').getAttribute('src');
  expect(src).toMatch(/^https:\/\/embed-motherduck\.com\/sandbox\/#session=/);
  expect(await page.content()).not.toContain(E2E.embedToken);
});

test('switching Dives opens the other Dive with its share, and the choice is remembered', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: /^Explorer/ }).click();
  await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toContainText('Explorer');
  await expect.poll(async () => (await embedRequests()).map(item => item.dive)).toContain(E2E.dives.explorer);
  const explorer = (await embedRequests()).find(item => item.dive === E2E.dives.explorer);
  expect(explorer.body.required_resources).toEqual([{ url: `md:_share/e2e/${E2E.dives.explorer.replaceAll('-', '')}`, alias: 'demo' }]);
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toContainText('Explorer');
});

test('changing the theme reopens the Dive dark and keeps its state', async ({ page }) => {
  await signIn(page);
  await dive(page).getByLabel('Region').selectOption('APAC');
  await page.getByRole('button', { name: /^Theme:/ }).click();
  await expect.poll(async () => (await embedRequests()).at(-1)?.body.initial_state.app_theme).toBe('dark');
  expect((await embedRequests()).at(-1).body.initial_state.region).toBe('APAC');
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('a link the Dive asks to open is ignored unless its host is allowed', async ({ page }) => {
  await signIn(page);
  await dive(page).getByRole('button', { name: 'Open a link' }).click();
  await page.waitForTimeout(500);
  await expect(page.getByText('example.com')).toHaveCount(0);
});

test('when MotherDuck cannot open the Dive, the app retries and then offers Try again', async ({ page }) => {
  // The first request and both automatic retries fail; the manual retry succeeds.
  await failEmbedSessions(3);
  await signIn(page);
  await expect(page.getByRole('alert').getByText('Dive unavailable')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(dive(page).getByText(/Session e2e-session-/)).toBeVisible();
  await expect(page.getByText('Dive unavailable')).toHaveCount(0);
});
