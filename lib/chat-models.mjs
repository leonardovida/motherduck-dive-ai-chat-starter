// Server-owned model catalog. The browser sends only a key; ids, reasoning
// effort and the enabled subset never come from the client.
// Reasoning tokens count against maxOutputTokens, so deeper tiers get more room.
export const CHAT_MODELS = Object.freeze({
  luna: Object.freeze({ id: 'gpt-6-luna', reasoning: 'low', maxSteps: 6, maxOutputTokens: 4000 }),
  sol: Object.freeze({ id: 'gpt-6.1-sol', reasoning: 'medium', maxSteps: 8, maxOutputTokens: 8000 }),
  astra: Object.freeze({ id: 'gpt-6-astra', reasoning: 'high', maxSteps: 10, maxOutputTokens: 16000 }),
});
export const MODEL_KEYS = Object.freeze(Object.keys(CHAT_MODELS));
// Follow-up questions are a short structured task; the efficient tier is enough.
export const FOLLOW_UP_MODEL = CHAT_MODELS.luna;

// OPENAI_CHAT_MODELS=luna,sol limits the picker (for example to cap spend).
export function enabledModelKeys(env = process.env) {
  const raw = String(env.OPENAI_CHAT_MODELS ?? '').trim();
  if (!raw) return [...MODEL_KEYS];
  const keys = raw.split(',').map(key => key.trim().toLowerCase()).filter(key => MODEL_KEYS.includes(key));
  return keys.length ? [...new Set(keys)] : [...MODEL_KEYS];
}

// OPENAI_MODEL keeps its earlier meaning (a model id) and picks the default key.
export function defaultModelKey(env = process.env) {
  const enabled = enabledModelKeys(env);
  const configured = String(env.OPENAI_MODEL ?? '').trim();
  const match = enabled.find(key => CHAT_MODELS[key].id === configured || key === configured.toLowerCase());
  return match ?? enabled[0];
}

export function resolveModel(key, env = process.env) {
  const enabled = enabledModelKeys(env);
  const chosen = enabled.includes(key) ? key : defaultModelKey(env);
  return { key: chosen, ...CHAT_MODELS[chosen] };
}

export function modelCatalog(env = process.env) {
  return { models: enabledModelKeys(env), defaultModel: defaultModelKey(env) };
}
