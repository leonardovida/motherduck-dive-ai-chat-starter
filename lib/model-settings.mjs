import { z } from 'zod';
import { appQuery, appStoreConfigured } from './app-db.mjs';
import { FIELD_PATTERNS, MODEL_ID, PROVIDERS_INFO, PROVIDER_IDS, checkBaseURL, looksLikeSecret } from './provider-registry.mjs';

// Model choices an administrator saves in the admin Models tab (accounts mode only). They hold
// non-secret values only: a provider and model id per tier, endpoint fields such as a base URL,
// region or project, the enabled tiers and the utility model. Credentials stay in the
// environment. Precedence: these settings, then environment variables, then built-in defaults.
export const SETTING_NAME = 'models';
export const SETTING_KEYS = Object.freeze(['luna', 'sol', 'astra']);
const TTL_MS = 15000;

export class SettingsError extends Error {
  constructor(code, path = '') { super(code); this.code = code; this.path = path; }
}

const text = max => z.string().trim().min(1).max(max);
// Empty form fields mean "use the environment", so they are dropped before validation.
const dropEmpty = input => (input && typeof input === 'object' && !Array.isArray(input) ? Object.fromEntries(Object.entries(input).filter(([, item]) => item !== '' && item != null)) : input);
const optionsSchema = z.preprocess(dropEmpty, z.object({
  baseURL: text(500).optional(), resourceName: text(64).optional(), apiVersion: text(40).optional(), api: text(10).optional(),
  region: text(30).optional(), project: text(30).optional(), location: text(32).optional(),
}).strict());
const tierSchema = z.object({ provider: text(40), model: text(200), options: optionsSchema.optional() }).strict();
const settingsSchema = z.object({
  tiers: z.object({ luna: tierSchema.optional(), sol: tierSchema.optional(), astra: tierSchema.optional() }).strict().default({}),
  utility: tierSchema.optional(),
  enabled: z.array(z.enum(SETTING_KEYS)).min(1).max(3).optional(),
}).strict();

function checkTier(tier, path) {
  if (!PROVIDER_IDS.includes(tier.provider)) throw new SettingsError('unknown_provider', `${path}.provider`);
  if (!MODEL_ID.test(tier.model)) throw new SettingsError('invalid_model_id', `${path}.model`);
  const allowed = PROVIDERS_INFO[tier.provider].fields;
  const options = {};
  for (const [field, raw] of Object.entries(tier.options ?? {})) {
    if (raw === undefined) continue;
    if (!allowed.includes(field)) throw new SettingsError('field_not_allowed', `${path}.options.${field}`);
    if (field === 'baseURL') {
      const problem = checkBaseURL(raw);
      if (problem) throw new SettingsError(problem, `${path}.options.baseURL`);
      options.baseURL = raw.replace(/\/+$/, '');
    } else {
      if (!FIELD_PATTERNS[field].test(raw)) throw new SettingsError(`invalid_${field.toLowerCase()}`, `${path}.options.${field}`);
      options[field] = raw;
    }
  }
  if (tier.provider === 'azure' && options.resourceName && options.baseURL) throw new SettingsError('azure_resource_or_url', `${path}.options`);
  return { provider: tier.provider, model: tier.model, options };
}

// Validates settings from the admin portal or the database. Unknown providers, unknown fields,
// URLs that are not http(s), URLs with credentials or a query, and anything shaped like a secret
// are refused.
export function parseModelSettings(input) {
  if (looksLikeSecret(JSON.stringify(input ?? null))) throw new SettingsError('looks_like_secret');
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) throw new SettingsError('invalid_settings', parsed.error.issues[0]?.path?.join('.') ?? '');
  const tiers = {};
  for (const key of SETTING_KEYS) if (parsed.data.tiers[key]) tiers[key] = checkTier(parsed.data.tiers[key], `tiers.${key}`);
  return {
    tiers,
    ...(parsed.data.utility ? { utility: checkTier(parsed.data.utility, 'utility') } : {}),
    ...(parsed.data.enabled ? { enabled: SETTING_KEYS.filter(key => parsed.data.enabled.includes(key)) } : {}),
  };
}

export function createModelSettingsStore(query = appQuery) {
  return {
    // { settings, updatedAt, updatedBy } or null. Rows that no longer validate are ignored.
    async get() {
      const rows = await query('SELECT value, updated_at, updated_by FROM app_setting WHERE name = $1', [SETTING_NAME]);
      if (!rows.length) return null;
      try {
        const raw = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
        return { settings: parseModelSettings(raw), updatedAt: rows[0].updated_at ?? null, updatedBy: rows[0].updated_by ?? null };
      } catch (error) {
        console.error('model_settings_invalid', error?.code ?? error?.name);
        return null;
      }
    },
    async save(settings, updatedBy = null) {
      const clean = parseModelSettings(settings);
      await query('INSERT INTO app_setting (name, value, updated_at, updated_by) VALUES ($1, $2, $3, $4) ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by',
        [SETTING_NAME, JSON.stringify(clean), new Date(), updatedBy ? String(updatedBy).slice(0, 200) : null]);
      return clean;
    },
    async clear() {
      await query('DELETE FROM app_setting WHERE name = $1', [SETTING_NAME]);
    },
  };
}

// A short in-memory cache, shared by every route bundle in the process. Saving or resetting
// updates it at once; other server instances pick the change up within TTL_MS.
const state = (globalThis.__diveChatModelSettings ??= { value: null, loadedAt: 0, pending: null });
const OVERRIDE = Symbol.for('dive-chat.model-settings');

export const cachedModelSettings = () => state.value;
export function setCachedModelSettings(settings) {
  state.value = settings ?? null;
  state.loadedAt = Date.now();
}

// Call before reading the model catalog in a request. Without accounts mode it clears the cache,
// so only environment variables apply. A failed read keeps the last good settings.
export async function refreshModelSettings({ env = process.env, store, force = false } = {}) {
  if (!appStoreConfigured(env)) { state.value = null; return null; }
  if (!force && state.loadedAt && Date.now() - state.loadedAt < TTL_MS) return state.value;
  state.pending ??= (async () => {
    try { state.value = (await (store ?? createModelSettingsStore()).get())?.settings ?? null; }
    catch (error) { console.error('model_settings_unavailable', error?.code ?? error?.name); }
    finally { state.loadedAt = Date.now(); state.pending = null; }
    return state.value;
  })();
  return state.pending;
}

// The settings that apply to an env object: explicit ones attached with withModelSettings (tests,
// the Test button), else the cached ones for the live process environment.
export function modelSettingsOf(env = process.env) {
  if (env && Object.hasOwn(env, OVERRIDE)) return env[OVERRIDE];
  return env === process.env ? state.value : null;
}
export const withModelSettings = (env, settings) => ({ ...env, [OVERRIDE]: settings ?? null });
