import { publicDemo } from './public-demo.mjs';
import { DEFAULT_MODELS, PROVIDER_IDS, PROVIDERS_INFO, detectProvider, providerId, providerReady } from './provider-registry.mjs';
import { modelSettingsOf } from './model-settings.mjs';

export { DEFAULT_MODELS };

// Server-owned model catalog. The browser sends only a tier key (or "auto"); providers,
// model ids, reasoning effort and the enabled subset never come from the client.
// Reasoning tokens count against maxOutputTokens, so deeper tiers get more room.
export const TIERS = Object.freeze({
  luna: Object.freeze({ reasoning: 'low', maxSteps: 6, maxOutputTokens: 4000 }),
  sol: Object.freeze({ reasoning: 'medium', maxSteps: 8, maxOutputTokens: 8000 }),
  astra: Object.freeze({ reasoning: 'high', maxSteps: 10, maxOutputTokens: 16000 }),
});
export const MODEL_KEYS = Object.freeze(Object.keys(TIERS));
export const AUTO = 'auto';
// OpenAI and Anthropic first: with their keys present, a deployment behaves as it always has.
export const PROVIDERS = PROVIDER_IDS;

// Kept for callers of the original OpenAI-only catalog.
export const CHAT_MODELS = Object.freeze(Object.fromEntries(MODEL_KEYS.map(key => [key, Object.freeze({ id: DEFAULT_MODELS.openai[key], provider: 'openai', ...TIERS[key] })])));

export const providerConfigured = (provider, env = process.env, options = {}) => providerReady(provider, env, options);

// CHAT_PROVIDER wins; otherwise the first provider whose credentials are present, OpenAI first.
export function defaultProvider(env = process.env) {
  const chosen = providerId(env.CHAT_PROVIDER);
  if (chosen) return chosen;
  return PROVIDERS.find(provider => detectProvider(provider, env)) ?? 'openai';
}

// Providers without a portable reasoning setting (self-hosted endpoints) never receive one.
const reasoningFor = (provider, level) => (PROVIDERS_INFO[provider]?.reasoning ? level : undefined);

// "provider:model-id", or a bare id for the default provider. Ids may contain ":" themselves.
function parseModelValue(raw, env) {
  const text = String(raw ?? '').trim();
  const [prefix, ...rest] = text.split(':');
  const explicit = providerId(prefix) && rest.length ? providerId(prefix) : null;
  return { provider: explicit ?? defaultProvider(env), id: explicit ? rest.join(':') : text };
}

// Precedence for each tier: the admin Models tab (accounts mode), then CHAT_MODEL_<TIER>, then the
// default model of the default provider. OPENAI_COMPATIBLE_MODEL fills every self-hosted tier.
export function tierModel(key, env = process.env) {
  const saved = modelSettingsOf(env)?.tiers?.[key];
  if (saved) return { key, provider: saved.provider, id: saved.model, options: saved.options ?? {}, source: 'settings', ...TIERS[key], reasoning: reasoningFor(saved.provider, TIERS[key].reasoning) };
  const raw = String(env[`CHAT_MODEL_${key.toUpperCase()}`] ?? '').trim();
  const parsed = parseModelValue(raw, env);
  const fallback = parsed.provider === 'openai-compatible' ? String(env.OPENAI_COMPATIBLE_MODEL ?? '').trim() : '';
  const id = parsed.id || fallback || DEFAULT_MODELS[parsed.provider][key];
  return { key, provider: parsed.provider, id, options: {}, source: parsed.id || fallback ? 'environment' : 'default', ...TIERS[key], reasoning: reasoningFor(parsed.provider, TIERS[key].reasoning) };
}

// A tier can answer when its provider's credentials and endpoint are present and it names a model.
export const modelConfigured = (model, env = process.env) => Boolean(model?.id) && providerConfigured(model.provider, env, model.options);

// CHAT_MODELS=luna,sol limits the picker (for example to cap spend); OPENAI_CHAT_MODELS is the
// earlier name, and the admin Models tab overrides both. Tiers that cannot answer are hidden
// once any tier can.
export function listedModelKeys(env = process.env) {
  const saved = modelSettingsOf(env)?.enabled;
  const raw = String(env.CHAT_MODELS ?? env.OPENAI_CHAT_MODELS ?? '').trim();
  const listed = saved?.length ? saved : raw ? [...new Set(raw.split(',').map(key => key.trim().toLowerCase()).filter(key => MODEL_KEYS.includes(key)))] : [];
  return listed.length ? listed : [...MODEL_KEYS];
}
export function enabledModelKeys(env = process.env) {
  const keys = listedModelKeys(env);
  const usable = keys.filter(key => modelConfigured(tierModel(key, env), env));
  return usable.length ? usable : keys;
}

export const chatConfigured = (env = process.env) => enabledModelKeys(env).some(key => modelConfigured(tierModel(key, env), env));

// Auto routing needs at least two tiers to choose between. CHAT_ROUTER=off disables it.
export const routerEnabled = (env = process.env) => String(env.CHAT_ROUTER ?? '').trim().toLowerCase() !== 'off' && enabledModelKeys(env).length > 1;

// CHAT_DEFAULT_MODEL (or the earlier OPENAI_MODEL) picks the default: a tier key, "auto" or a model id.
export function defaultModelKey(env = process.env) {
  const enabled = enabledModelKeys(env);
  const configured = String(env.CHAT_DEFAULT_MODEL ?? env.OPENAI_MODEL ?? '').trim();
  if (configured.toLowerCase() === AUTO && routerEnabled(env)) return AUTO;
  const match = enabled.find(key => key === configured.toLowerCase() || tierModel(key, env).id === configured);
  if (match) return match;
  return routerEnabled(env) && !configured ? AUTO : enabled[0];
}

export function resolveModel(key, env = process.env) {
  const enabled = enabledModelKeys(env);
  const chosen = enabled.includes(key) ? key : defaultModelKey(env);
  return tierModel(chosen === AUTO ? enabled[0] : chosen, env);
}

// The picker reads only which choices exist; ids and providers stay on the server.
// A public demo also lists the choices it switched off, so the picker can show them greyed out.
export function modelCatalog(env = process.env) {
  const tiers = enabledModelKeys(env);
  const models = routerEnabled(env) ? [AUTO, ...tiers] : tiers;
  return { models, defaultModel: defaultModelKey(env), ...(publicDemo(env) ? { unavailable: [AUTO, ...MODEL_KEYS].filter(key => !models.includes(key)) } : {}) };
}

// Short structured tasks (follow-ups, routing) use the utility model: the admin Models tab, then
// CHAT_MODEL_UTILITY (provider:model-id), then the cheapest enabled tier.
export function utilityModel(env = process.env) {
  const saved = modelSettingsOf(env)?.utility;
  if (saved) return { key: 'utility', provider: saved.provider, id: saved.model, options: saved.options ?? {}, source: 'settings', ...TIERS.luna, reasoning: reasoningFor(saved.provider, TIERS.luna.reasoning) };
  const raw = String(env.CHAT_MODEL_UTILITY ?? '').trim();
  if (raw) {
    const parsed = parseModelValue(raw, env);
    if (parsed.id) return { key: 'utility', provider: parsed.provider, id: parsed.id, options: {}, source: 'environment', ...TIERS.luna, reasoning: reasoningFor(parsed.provider, TIERS.luna.reasoning) };
  }
  return tierModel(enabledModelKeys(env)[0], env);
}
export const FOLLOW_UP_MODEL = CHAT_MODELS.luna;
