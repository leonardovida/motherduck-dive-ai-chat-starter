import { chatConfigured } from './chat-models.mjs';
import CONFIG from '../dives.config.mjs';

export const ICONS = Object.freeze(['layout-dashboard', 'table', 'chart-column', 'chart-line', 'map', 'file-text', 'users', 'database']);
const KEY = /^[a-z][a-z0-9-]{0,39}$/;
const ENV = /^[A-Z][A-Z0-9_]{0,99}$/;
const ALIAS = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOST = /^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/i;
const DEFAULT_USERNAME_ENV = 'MOTHERDUCK_EMBED_USERNAME';

// Fails fast at startup so a broken config never reaches a viewer.
export function validateConfig(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('dives.config: export at least one Dive');
  const keys = new Set();
  for (const [index, dive] of entries.entries()) {
    const where = `dives.config[${index}]`;
    const fail = message => { throw new Error(`${where}: ${message}`); };
    if (!dive || typeof dive !== 'object') fail('must be an object');
    if (!KEY.test(dive.key ?? '')) fail('key must match /^[a-z][a-z0-9-]{0,39}$/');
    if (keys.has(dive.key)) fail(`duplicate key "${dive.key}"`);
    keys.add(dive.key);
    if (typeof dive.title !== 'string' || !dive.title.trim() || dive.title.length > 60) fail('title is required (max 60 characters)');
    if (dive.description != null && (typeof dive.description !== 'string' || dive.description.length > 160)) fail('description must be a string up to 160 characters');
    if (dive.icon != null && !ICONS.includes(dive.icon)) fail(`icon must be one of ${ICONS.join(', ')}`);
    if ((dive.diveId == null) === (dive.diveIdEnv == null)) fail('set exactly one of diveId or diveIdEnv');
    if (dive.diveId != null && !UUID.test(dive.diveId)) fail('diveId must be a UUID');
    for (const field of ['diveIdEnv', 'versionEnv', 'usernameEnv']) if (dive[field] != null && !ENV.test(dive[field])) fail(`${field} must be an env var name`);
    if (dive.version != null && !(Number.isInteger(dive.version) && dive.version > 0)) fail('version must be a positive integer');
    if (!Array.isArray(dive.resources ?? [])) fail('resources must be an array');
    const aliases = new Set();
    for (const resource of dive.resources ?? []) {
      if (!ALIAS.test(resource?.alias ?? '')) fail('each resource needs an alias matching the Dive SQL catalog name');
      if (aliases.has(resource.alias)) fail(`duplicate resource alias "${resource.alias}"`);
      aliases.add(resource.alias);
      if ((resource.url == null) === (resource.urlEnv == null)) fail('each resource needs exactly one of url or urlEnv');
      if (resource.url != null && !String(resource.url).startsWith('md:')) fail('resource url must start with md:');
      if (resource.urlEnv != null && !ENV.test(resource.urlEnv)) fail('resource urlEnv must be an env var name');
    }
    if (dive.chat != null && (!ENV.test(dive.chat.tokenEnv ?? '') || !ENV.test(dive.chat.databaseEnv ?? ''))) fail('chat needs tokenEnv and databaseEnv env var names');
    if (dive.starters != null && (!Array.isArray(dive.starters) || dive.starters.length > 6 || dive.starters.some(s => typeof s !== 'string' || !s.trim() || s.length > 160))) fail('starters must be up to 6 short strings');
    if (dive.linkHosts != null && (!Array.isArray(dive.linkHosts) || dive.linkHosts.some(h => !HOST.test(h)))) fail('linkHosts must be hostnames');
  }
  return entries;
}

const DIVES = validateConfig(CONFIG);
const value = (env, name) => (name ? String(env[name] ?? '').trim() : '');

// Resolves env lookups. `missing` lists env var names only, never values.
export function resolveDive(dive, env = process.env) {
  const missing = [];
  const need = (name) => { const v = value(env, name); if (!v) missing.push(name); return v; };
  const id = dive.diveId ?? need(dive.diveIdEnv);
  const rawVersion = dive.version ?? value(env, dive.versionEnv);
  const version = /^\d+$/.test(String(rawVersion)) && Number(rawVersion) > 0 ? Number(rawVersion) : undefined;
  const invalidVersion = rawVersion != null && rawVersion !== '' && (!Number.isSafeInteger(version) || !version);
  if (invalidVersion) missing.push(dive.versionEnv ?? 'a valid Dive version');
  const usernameEnv = dive.usernameEnv ?? DEFAULT_USERNAME_ENV;
  const username = need(usernameEnv);
  if (!value(env, 'MOTHERDUCK_EMBED_TOKEN')) missing.push('MOTHERDUCK_EMBED_TOKEN');
  const resources = (dive.resources ?? []).map(r => ({ alias: r.alias, url: r.url ?? need(r.urlEnv) }));
  const invalid = (id && !UUID.test(id)) || resources.some(r => r.url && !r.url.startsWith('md:'));
  const chat = dive.chat ? { token: value(env, dive.chat.tokenEnv), database: value(env, dive.chat.databaseEnv) } : null;
  return {
    key: dive.key,
    title: dive.title,
    description: dive.description ?? '',
    icon: dive.icon ?? 'layout-dashboard',
    starters: dive.starters ?? [],
    linkHosts: (dive.linkHosts ?? []).map(h => h.toLowerCase()),
    id: id || null,
    version,
    invalidVersion,
    username,
    resources,
    connected: missing.length === 0 && !invalid,
    missing: invalid ? [...missing, 'a valid Dive UUID and md: resource URLs'] : missing,
    chat: chat && chat.token && /^[A-Za-z0-9_ -]{1,100}$/.test(chat.database) ? chat : null,
    url: id && UUID.test(id) ? `https://app.motherduck.com/dives/${id}` : null,
  };
}

export const listDives = (env = process.env) => DIVES.map(dive => resolveDive(dive, env));
export function getDive(key, env = process.env) {
  const dive = DIVES.find(entry => entry.key === key);
  return dive ? resolveDive(dive, env) : null;
}

// What the browser may see: no username, share URLs or tokens. Missing entries are env names only.
export const publicDive = ({ key, title, description, icon, starters, linkHosts, id, version, connected, missing, chat, url }, env = process.env) =>
  ({ key, title, description, icon, starters, linkHosts, id, version, connected, missing, chatEnabled: Boolean(chat && chatConfigured(env)), url });
