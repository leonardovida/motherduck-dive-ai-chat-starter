import { listDives } from './dives.mjs';
import { chatConfigured as providerConfigured, resolveModel } from './chat-models.mjs';
import { accountsEnabled } from './auth.mjs';
import { appQuery } from './app-db.mjs';
import { withChatReader } from './chat-data.mjs';
import { openAIEndpoint } from './openai-endpoint.mjs';
import { trustedIPHeader } from './login-limit.mjs';

// Return only fixed diagnostics and config names. Never forward provider error bodies,
// database errors, environment values or the opaque embed session to the terminal.
export async function checkSetup({ env = process.env, live = false, diveKey, requireChat = false, fetcher = fetch, read = withChatReader, appRead = appQuery } = {}) {
  const lines = [];
  let ok = true;
  const report = (passed, message) => { if (!passed) ok = false; lines.push(`${passed ? 'OK' : 'FIX'} ${message}`); };
  const dives = listDives(env).filter(d => !diveKey || d.key === diveKey);
  if (!dives.length) return { ok: false, lines: ['FIX Choose a Dive key from dives.config.mjs.'] };
  const configured = dives.filter(d => d.connected);
  if (!configured.length) {
    report(false, dives[0].invalidVersion ? `${dives[0].title}: the version pin must be a positive integer. Check ${dives[0].missing.join(', ')}.` : `Connect ${dives[0].title}: set ${dives[0].missing.join(', ')}.`);
    lines.push('The interface still runs without credentials: npm run dev, then sign in with duckdemo.');
  }
  const accounts = accountsEnabled(env);
  if (env.NODE_ENV === 'production') {
    if (accounts) report(Boolean(env.SESSION_SECRET?.length >= 32), 'Production accounts require SESSION_SECRET (32+ characters).');
    else report(Boolean(env.DEMO_PASSWORD?.trim() && env.SESSION_SECRET?.length >= 32), 'Production sign-in requires DEMO_PASSWORD and SESSION_SECRET (32+ characters).');
    report(Boolean(trustedIPHeader(env)), 'Production sign-in needs a trusted proxy client-IP header. Vercel is detected automatically; other hosts need AUTH_TRUSTED_IP_HEADER.');
  }
  if (accounts) {
    if (live) {
      try {
        await appRead('SELECT count(*) FROM "user"', [], env);
        await appRead('SELECT count(*) FROM chat_message', [], env);
        report(true, 'App database: reachable and migrated.');
      } catch { report(false, 'App database: run npm run db:migrate, and check MOTHERDUCK_APP_TOKEN, APP_DATABASE and MOTHERDUCK_PG_HOST.'); }
    } else lines.push('Accounts mode is on. Run npm run db:migrate, then npm run admin:create -- --username=<admin>.');
  }
  const chatConfigured = [];
  for (const dive of configured) {
    report(true, `${dive.title}: embedding values present${live ? '' : ' (not yet verified live)'}.`);
    if (live) {
      try {
        const response = await fetcher(`https://api.motherduck.com/v1/dives/${dive.id}/embed-session`, {
          method: 'POST', headers: { Authorization: `Bearer ${env.MOTHERDUCK_EMBED_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: dive.username, ...(dive.version ? { version: dive.version } : {}), required_resources: dive.resources, session_name: `starter-setup-${dive.key}` }),
          signal: AbortSignal.timeout(20000),
        });
        if (response.ok) {
          const body = await response.json();
          report(typeof body.session === 'string' && body.session.length > 0, `${dive.title}: embed-session response.`);
        } else {
          const hint = response.status === 404 ? 'Verify the saved Dive ID and exact service-account username, then check access.'
            : [401, 403].includes(response.status) ? 'Check embed-token permission, embedding entitlement and service-account access.'
              : 'Check required resources and MotherDuck availability.';
          report(false, `${dive.title}: embed HTTP ${response.status}. ${hint}`);
        }
      } catch { report(false, `${dive.title}: embed connection failed or timed out.`); }
    }
    if (dive.chat && providerConfigured(env)) {
      chatConfigured.push(dive);
      report(true, `${dive.title}: chat values present${live ? '' : ' (not yet verified live)'}.`);
      if (live) {
        try {
          await read(dive.chat, query => query('SELECT 1 AS setup_check'), env);
          report(true, `${dive.title}: read-only database connection.`);
        } catch { report(false, `${dive.title}: database connection failed. Check the chat token, database alias, grants and MOTHERDUCK_PG_HOST region.`); }
      }
    } else {
      const chatStarted = dive.chat || providerConfigured(env) || env.MOTHERDUCK_CHAT_TOKEN?.trim();
      if (requireChat || chatStarted) report(false, `${dive.title}: finish chat configuration using OPENAI_API_KEY or ANTHROPIC_API_KEY and the tokenEnv/databaseEnv names in dives.config.mjs.`);
      else lines.push(`OPTIONAL ${dive.title}: chat is off. See README → Enable AI chat.`);
    }
  }
  if (live && chatConfigured.length) {
    try {
      const model = resolveModel(undefined, env);
      const anthropic = model.provider === 'anthropic';
      const name = anthropic ? 'Anthropic' : 'OpenAI';
      const response = anthropic
        ? await fetcher(`${(env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1').replace(/\/+$/, '')}/models/${encodeURIComponent(model.id)}`, { headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(15000) })
        : await fetcher(openAIEndpoint(`models/${encodeURIComponent(model.id)}`, env), { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(15000) });
      report(response.ok, response.ok ? `${name} key and default model access (no generation requested).` : `${name} model access HTTP ${response.status}. Check your key and the default chat model.`);
    } catch { report(false, 'Model-access check failed or timed out.'); }
  }
  if (!live && configured.length) lines.push('Verify real connections: npm run check:setup -- --live');
  return { ok, lines };
}
