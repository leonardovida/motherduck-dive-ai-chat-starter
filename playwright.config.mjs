import { defineConfig, devices } from '@playwright/test';
import { APP_URL } from './e2e/config.mjs';

// End-to-end tests drive the real app in a browser against local stand-ins for MotherDuck and
// the model (e2e/server.mjs), in shared-password mode, so they need no MotherDuck account or keys.

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: APP_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node e2e/server.mjs',
    url: `${APP_URL}/api/auth`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
