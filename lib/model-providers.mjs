import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';

// One provider instance per key and endpoint. OPENAI_BASE_URL and ANTHROPIC_BASE_URL point at a
// compatible gateway or router (LiteLLM, vLLM Semantic Router, OpenRouter) without code changes.
const cache = new Map();
function provider(name, env) {
  const options = name === 'anthropic'
    ? { apiKey: env.ANTHROPIC_API_KEY, ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}) }
    : { apiKey: env.OPENAI_API_KEY, ...(env.OPENAI_BASE_URL ? { baseURL: env.OPENAI_BASE_URL } : {}) };
  const key = `${name}\0${options.apiKey}\0${options.baseURL ?? ''}`;
  if (!cache.has(key)) cache.set(key, name === 'anthropic' ? createAnthropic(options) : createOpenAI(options));
  return cache.get(key);
}

export function languageModel(model, env = process.env) {
  const instance = provider(model.provider, env);
  return model.provider === 'anthropic' ? instance(model.id) : instance.responses(model.id);
}

// Each provider reads only its own key, so one object serves a run that escalates across providers.
// OpenAI: never store prompts, and stream reasoning summaries as the agent's visible thinking.
export const PROVIDER_OPTIONS = Object.freeze({ openai: { store: false, reasoningSummary: 'detailed' } });
