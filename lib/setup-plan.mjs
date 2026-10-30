import config from '../dives.config.mjs';
import { resolveDive } from './dives.mjs';
import { trustedIPHeader } from './login-limit.mjs';
import { defaultProvider } from './chat-models.mjs';
import { accountsEnabled } from './auth.mjs';

// A setup agent needs names and decisions, never the underlying runtime values.
export function setupPlan({ env = process.env, diveKey = config[0].key, requireChat = true, production = false } = {}) {
  const entry = config.find(dive => dive.key === diveKey);
  if (!entry) throw new Error('Unknown Dive key. Choose a key from dives.config.mjs.');
  const requirements = [];
  const accounts = accountsEnabled(env);
  const add = (name, kind, source, required = true) => {
    if (!name || requirements.some(item => item.name === name)) return;
    requirements.push({ name, kind, source, required, present: Boolean(String(env[name] ?? '').trim()) });
  };
  add('MOTHERDUCK_EMBED_TOKEN', 'secret', 'user_secret_manager');
  add(entry.usernameEnv ?? 'MOTHERDUCK_EMBED_USERNAME', 'setting', 'discover_service_account');
  add(entry.diveIdEnv, 'setting', 'discover_or_save_dive');
  add(entry.versionEnv, 'setting', 'optional_version_pin', false);
  for (const resource of entry.resources ?? []) add(resource.urlEnv, 'private_setting', 'discover_required_resource');
  if (requireChat && entry.chat) {
    add(defaultProvider(env) === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY', 'secret', 'user_secret_manager');
    add(entry.chat.tokenEnv, 'secret', 'read_only_data_identity');
    add(entry.chat.databaseEnv, 'setting', 'discover_database_alias');
    add('MOTHERDUCK_PG_HOST', 'setting', 'discover_region', false);
  }
  // Accounts mode (MOTHERDUCK_APP_TOKEN set) replaces the shared password with per-person sign-in.
  if (accounts) add('APP_DATABASE', 'setting', 'choose_app_database', false);
  if (production) {
    if (!accounts) add('DEMO_PASSWORD', 'secret', 'generate_in_secret_manager');
    add('SESSION_SECRET', 'secret', 'generate_in_secret_manager');
    if (accounts) add('APP_URL', 'setting', 'deployment_url', env.VERCEL !== '1');
    add('AUTH_TRUSTED_IP_HEADER', 'setting', 'discover_trusted_proxy_header', env.VERCEL !== '1');
  }
  const dive = resolveDive(entry, env);
  const blockers = [];
  const missing = requirements.filter(item => item.required && !item.present).map(item => item.name);
  if (missing.length) blockers.push({ code: 'missing_values', names: missing });
  if (!dive.connected && !missing.length) blockers.push({ code: 'invalid_embed_configuration', names: dive.missing });
  if (dive.invalidVersion) blockers.push({ code: 'invalid_version', names: [entry.versionEnv ?? 'version'] });
  if (requireChat && !entry.chat) blockers.push({ code: 'chat_disabled_in_config', names: [] });
  else if (requireChat && !dive.chat && !missing.length) blockers.push({ code: 'invalid_chat_database', names: [entry.chat.databaseEnv] });
  if (production && String(env.SESSION_SECRET ?? '').length < 32 && env.SESSION_SECRET) blockers.push({ code: 'session_secret_too_short', names: ['SESSION_SECRET'] });
  if (production && env.AUTH_TRUSTED_IP_HEADER && !trustedIPHeader(env)) blockers.push({ code: 'invalid_proxy_header', names: ['AUTH_TRUSTED_IP_HEADER'] });
  return {
    schemaVersion: 1,
    dive: entry.key,
    target: production ? 'production' : 'local',
    signIn: accounts ? 'accounts' : 'password',
    requireChat,
    configurationReady: blockers.length === 0,
    connectionsVerified: false,
    requirements,
    blockers,
    instructions: 'Read AGENTS.md and docs/agent-setup.md. Discover settings, use managed secret injection, then verify live connections and the browser flow.',
    nextCommands: [...(accounts ? ['npm run db:migrate', 'npm run admin:create -- --username=<admin>'] : []), `npm run --silent ${requireChat ? 'setup' : 'check:setup'} -- --dive=${entry.key}${production ? ' --production' : ''} --live --json`, 'npm test', 'npm run build', 'npm run dev'],
  };
}
