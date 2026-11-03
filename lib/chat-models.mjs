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
export const PROVIDERS = Object.freeze(['openai', 'anthropic']);

// Default model per tier and provider. CHAT_MODEL_LUNA=anthropic:claude-haiku-5-5 (or a bare
// id for the default provider) overrides one tier, so providers can be mixed.
export const DEFAULT_MODELS = Object.freeze({
  openai: Object.freeze({ luna: 'gpt-6-luna', sol: 'gpt-6.1-sol', astra: 'gpt-6-astra' }),
  anthropic: Object.freeze({ luna: 'claude-haiku-5-5', sol: 'claude-sonnet-5-5', astra: 'claude-opus-5-5' }),
});
// Kept for callers of the original OpenAI-only catalog.
export const CHAT_MODELS = Object.freeze(Object.fromEntries(MODEL_KEYS.map(key => [key, Object.freeze({ id: DEFAULT_MODELS.openai[key], provider: 'openai', ...TIERS[key] })])));

const KEY_ENV = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' };
export const providerConfigured = (provider, env = process.env) => Boolean(String(env[KEY_ENV[provider]] ?? '').trim());

// CHAT_PROVIDER wins; otherwise the provider whose key is present, OpenAI first.
export function defaultProvider(env = process.env) {
  const chosen = String(env.CHAT_PROVIDER ?? '').trim().toLowerCase();
  if (PROVIDERS.includes(chosen)) return chosen;
  return PROVIDERS.find(provider => providerConfigured(provider, env)) ?? 'openai';
}

export function tierModel(key, env = process.env) {
  const raw = String(env[`CHAT_MODEL_${key.toUpperCase()}`] ?? '').trim();
  const [prefix, ...rest] = raw.split(':');
  const explicit = PROVIDERS.includes(prefix.toLowerCase()) && rest.length;
  const provider = explicit ? prefix.toLowerCase() : defaultProvider(env);
  const id = (explicit ? rest.join(':') : raw) || DEFAULT_MODELS[provider][key];
  return { key, provider, id, ...TIERS[key] };
}

// CHAT_MODELS=luna,sol limits the picker (for example to cap spend); OPENAI_CHAT_MODELS is the
// earlier name. Tiers whose provider has no key are hidden once any provider is configured.
export function enabledModelKeys(env = process.env) {
  const raw = String(env.CHAT_MODELS ?? env.OPENAI_CHAT_MODELS ?? '').trim();
  const listed = raw ? [...new Set(raw.split(',').map(key => key.trim().toLowerCase()).filter(key => MODEL_KEYS.includes(key)))] : [];
  const keys = listed.length ? listed : [...MODEL_KEYS];
  if (!PROVIDERS.some(provider => providerConfigured(provider, env))) return keys;
  const usable = keys.filter(key => providerConfigured(tierModel(key, env).provider, env));
  return usable.length ? usable : keys;
}

export const chatConfigured = (env = process.env) => enabledModelKeys(env).some(key => providerConfigured(tierModel(key, env).provider, env));

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
export function modelCatalog(env = process.env) {
  const tiers = enabledModelKeys(env);
  return { models: routerEnabled(env) ? [AUTO, ...tiers] : tiers, defaultModel: defaultModelKey(env) };
}

// Short structured tasks (follow-ups, routing) use the cheapest enabled tier.
export const utilityModel = (env = process.env) => tierModel(enabledModelKeys(env)[0], env);
export const FOLLOW_UP_MODEL = CHAT_MODELS.luna;
