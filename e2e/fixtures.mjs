import { test as base, expect } from '@playwright/test';
import { API_URL, E2E } from './config.mjs';

// The embedded Dive is served by MotherDuck. The tests replace it with a small page that
// behaves like one: it reports its state with dive-state-update and can ask to open a link.
const DIVE_PAGE = `<!doctype html><html><body style="font-family:sans-serif">
<h1>Stand-in Dive</h1><p id="session"></p>
<label>Region <select id="region"><option>All</option><option>EMEA</option><option>APAC</option></select></label>
<button id="link" type="button">Open a link</button>
<script>
  const session = new URLSearchParams(location.hash.slice(1)).get('session');
  document.getElementById('session').textContent = session ? 'Session ' + session : 'No session';
  const send = message => parent.postMessage(message, '*');
  const region = document.getElementById('region');
  region.addEventListener('change', () => send({ type: 'dive-state-update', state: { region: region.value } }));
  document.getElementById('link').addEventListener('click', () => send({ type: 'navigation-request', url: 'https://example.com/', source: 'anchor-click', target: '_blank', rel: null }));
</script></body></html>`;

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('https://embed-motherduck.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: DIVE_PAGE }));
    await use(page);
  },
});
export { expect };

export const embedRequests = async () => (await fetch(`${API_URL}/__requests`)).json();
export const clearEmbedRequests = () => fetch(`${API_URL}/__requests`, { method: 'DELETE' });
export const failEmbedSessions = count => fetch(`${API_URL}/__fail`, { method: 'POST', body: JSON.stringify({ count }) });

export async function signIn(page, password = E2E.password) {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
}
export const dive = page => page.frameLocator('iframe.dive-frame');
