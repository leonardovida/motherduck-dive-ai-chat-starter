// Starts the stand-ins and the app for the end-to-end tests (playwright.config.mjs runs this).
// The app runs with `next dev`: production mode only accepts https origins, by design.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { startMotherDuckApi } from './stubs/motherduck-api.mjs';
import { startModel } from './stubs/model.mjs';
import { E2E } from './config.mjs';

await startMotherDuckApi({ port: E2E.apiPort, token: E2E.embedToken });
await startModel({ port: E2E.modelPort });

// Only the app's own settings: nothing is inherited that could reach a real service.
const env = {
  PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', NEXT_DIST_DIR: '.next-e2e',
  SESSION_SECRET: randomBytes(32).toString('hex'), DEMO_PASSWORD: E2E.password, APP_TITLE: E2E.title,
  MOTHERDUCK_API_URL: `http://127.0.0.1:${E2E.apiPort}`, MOTHERDUCK_EMBED_TOKEN: E2E.embedToken, MOTHERDUCK_EMBED_USERNAME: 'e2e_reader',
  DIVE_OVERVIEW_ID: E2E.dives.overview, DIVE_EXPLORER_ID: E2E.dives.explorer, DIVE_EXPLORER_SHARE_URL: `md:_share/e2e/${E2E.dives.explorer.replaceAll('-', '')}`,
  OPENAI_API_KEY: 'e2e-model-key', OPENAI_BASE_URL: `http://127.0.0.1:${E2E.modelPort}/v1`,
  MOTHERDUCK_CHAT_TOKEN: 'e2e-chat-token', DIVE_OVERVIEW_CHAT_DATABASE: 'e2e_data', DIVE_EXPLORER_CHAT_DATABASE: 'demo',
};
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(E2E.appPort)], { env, stdio: 'inherit' });
const stop = () => { app.kill('SIGTERM'); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
app.on('exit', code => process.exit(code ?? 1));
