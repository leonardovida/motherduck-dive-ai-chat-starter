import { test, expect, signIn, dive } from '../fixtures.mjs';

const question = page => page.getByRole('textbox', { name: 'Your question' });
const log = page => page.getByRole('complementary', { name: 'Chat' }).getByRole('log');

async function openChat(page) {
  await signIn(page);
  await expect(dive(page).getByText(/Session e2e-session-/)).toBeVisible();
  const chat = page.getByRole('complementary', { name: 'Chat' });
  if (!await chat.isVisible()) await page.getByRole('button', { name: 'Chat' }).click();
  await expect(question(page)).toBeEnabled();
}
async function ask(page, text) {
  await question(page).fill(text);
  await question(page).press('Enter');
}

test('a starter question streams an answer that read the Dive state', async ({ page }) => {
  await openChat(page);
  await page.getByRole('button', { name: 'What does this Dive show?' }).click();
  await expect(log(page)).toContainText('Stand-in answer from');
  // The finished steps fold into a summary that opens to show each one.
  await log(page).getByText(/Worked for \d+s · 1 step/).click();
  await expect(log(page)).toContainText('Read the Dive state');
  await expect(question(page)).toHaveValue('');
});

test('the answer reflects what the viewer selected in the Dive', async ({ page }) => {
  await openChat(page);
  await dive(page).getByLabel('Region').selectOption('EMEA');
  await ask(page, 'Which region am I looking at?');
  await expect(log(page)).toContainText('The region filter is EMEA.');
  await dive(page).getByLabel('Region').selectOption('APAC');
  await ask(page, 'And now?');
  await expect(log(page)).toContainText('The region filter is APAC.');
});

test('the model picker sends the chosen tier', async ({ page }) => {
  await openChat(page);
  await page.getByRole('combobox', { name: 'Model' }).click();
  await page.getByRole('option', { name: /Sol/ }).click();
  await ask(page, 'Which model answers?');
  await expect(log(page)).toContainText('Stand-in answer from gpt-6.1-sol');
});

test('Stop keeps the text so far and the chat stays usable', async ({ page }) => {
  await openChat(page);
  await ask(page, 'Answer slowly please');
  await expect(log(page)).toContainText('word3');
  await page.getByRole('button', { name: 'Stop response' }).click();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  const text = await log(page).innerText();
  expect(text).toContain('word3');
  expect(text).not.toContain('word39');
  await ask(page, 'Which region am I looking at?');
  await expect(log(page)).toContainText('The region filter is');
});

test('a failed answer says so and offers Retry', async ({ page }) => {
  await openChat(page);
  await ask(page, 'Please break');
  await expect(log(page)).toContainText('The assistant could not complete that request.');
  await expect(page.getByRole('button', { name: 'Retry response' })).toBeVisible();
});

test('Retry asks again and replaces the failure with the answer', async ({ page }) => {
  await openChat(page);
  await ask(page, `A flaky question ${Date.now()}`);
  await expect(log(page)).toContainText('The assistant could not complete that request.');
  await page.getByRole('button', { name: 'Retry response' }).click();
  await expect(log(page)).toContainText('Stand-in answer');
  await expect(log(page)).not.toContainText('could not complete');
  await expect(page.getByRole('button', { name: 'Retry response' })).toHaveCount(0);
});

test('Clear starts over, and each Dive keeps its own conversation', async ({ page }) => {
  await openChat(page);
  await ask(page, 'First question on Overview');
  await expect(log(page)).toContainText('Stand-in answer');
  await page.getByRole('button', { name: /^Explorer/ }).click();
  await expect(question(page)).toBeEnabled();
  await expect(log(page)).not.toContainText('First question on Overview');
  await page.getByRole('button', { name: /^Overview/ }).click();
  await expect(log(page)).toContainText('First question on Overview');
  await page.getByRole('button', { name: 'Clear conversation' }).click();
  await expect(log(page)).not.toContainText('First question on Overview');
  await expect(page.getByRole('button', { name: 'What does this Dive show?' })).toBeVisible();
});

test('Shift+Enter adds a line and empty questions are not sent', async ({ page }) => {
  await openChat(page);
  await question(page).press('Enter');
  await expect(log(page)).not.toContainText('Stand-in answer');
  await question(page).fill('Line one');
  await question(page).press('Shift+Enter');
  await question(page).pressSequentially('line two');
  await expect(question(page)).toHaveValue('Line one\nline two');
});

test('without saved conversations there is no history or rating', async ({ page }) => {
  await openChat(page);
  await ask(page, 'Anything');
  await expect(log(page)).toContainText('Stand-in answer');
  await expect(page.getByRole('button', { name: 'Past conversations' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Helpful' })).toHaveCount(0);
  await expect(page.getByText('Conversations are saved')).toHaveCount(0);
});
