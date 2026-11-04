import { createHash } from 'node:crypto';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAzure } from '@ai-sdk/azure';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createVertex } from '@ai-sdk/google-vertex';
import { createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic';
import { JWT } from 'google-auth-library';
import { endpointOptions, keyDestinationAllowed } from './provider-registry.mjs';

const value = (env, name) => String(env?.[name] ?? '').trim() || undefined;

// OpenRouter takes reasoning effort as { reasoning: { effort } }. Self-hosted servers often reject
// fields they do not know, so they never receive a reasoning setting.
const toOpenRouter = ({ reasoning_effort: effort, ...body }) => (effort ? { ...body, reasoning: { effort } } : body);
const withoutReasoning = ({ reasoning_effort: _effort, ...body }) => body;

// A service-account key given as two variables (hosts without a key file). A private key stored in
// one environment variable usually has its line breaks escaped. Without them, Google's default
// credentials apply: GOOGLE_APPLICATION_CREDENTIALS or the runtime's own identity.
const privateKey = env => value(env, 'GOOGLE_PRIVATE_KEY')?.replace(/\\n/g, '\n');
const serviceAccount = env => (value(env, 'GOOGLE_CLIENT_EMAIL') && privateKey(env) ? { email: value(env, 'GOOGLE_CLIENT_EMAIL'), key: privateKey(env) } : null);
const googleAuthOptions = account => (account ? { authClient: new JWT({ ...account, scopes: ['https://www.googleapis.com/auth/cloud-platform'] }) } : undefined);

// One SDK instance per provider, endpoint and credential set. The cache key hashes the settings,
// so no credential is kept in it as text.
const cache = new Map();
function instance(name, settings, create) {
  const key = `${name}\0${createHash('sha256').update(JSON.stringify(settings)).digest('hex')}`;
  if (!cache.has(key)) {
    if (cache.size > 50) cache.clear();
    cache.set(key, create(settings));
  }
  return cache.get(key);
}

// Builds the AI SDK model for a resolved tier ({ provider, id, options }). Secrets come from env;
// endpoints come from the tier's fields, then env (lib/provider-registry.mjs). OPENAI_BASE_URL and
// ANTHROPIC_BASE_URL still point the native providers at a compatible gateway.
export function languageModel(model, env = process.env) {
  const options = endpointOptions(model.provider, model.options, env);
  switch (model.provider) {
    case 'anthropic':
      return instance('anthropic', { apiKey: value(env, 'ANTHROPIC_API_KEY'), ...(value(env, 'ANTHROPIC_BASE_URL') ? { baseURL: value(env, 'ANTHROPIC_BASE_URL') } : {}) }, createAnthropic)(model.id);
    case 'openrouter': {
      const apiKey = keyDestinationAllowed('openrouter', options.baseURL, env) ? value(env, 'OPENROUTER_API_KEY') : undefined;
      return instance('openrouter', { baseURL: options.baseURL, apiKey }, settings => createOpenAICompatible({ name: 'openrouter', ...settings, includeUsage: true, transformRequestBody: toOpenRouter })).chatModel(model.id);
    }
    case 'openai-compatible': {
      const apiKey = keyDestinationAllowed('openai-compatible', options.baseURL, env) ? value(env, 'OPENAI_COMPATIBLE_API_KEY') : undefined;
      return instance('openai-compatible', { baseURL: options.baseURL, apiKey }, settings => createOpenAICompatible({ name: 'openaiCompatible', ...settings, transformRequestBody: withoutReasoning })).chatModel(model.id);
    }
    case 'azure': {
      const apiKey = keyDestinationAllowed('azure', options.baseURL, env) ? value(env, 'AZURE_API_KEY') : undefined;
      const { api, ...endpoint } = options;
      const azure = instance('azure', { ...endpoint, apiKey: apiKey ?? '' }, createAzure);
      return api === 'chat' ? azure.chat(model.id) : azure.responses(model.id);
    }
    case 'bedrock': {
      const bearer = value(env, 'AWS_BEARER_TOKEN_BEDROCK');
      const credentials = bearer ? { apiKey: bearer } : { accessKeyId: value(env, 'AWS_ACCESS_KEY_ID'), secretAccessKey: value(env, 'AWS_SECRET_ACCESS_KEY'), sessionToken: value(env, 'AWS_SESSION_TOKEN') };
      return instance('bedrock', { region: options.region, ...credentials }, createAmazonBedrock)(model.id);
    }
    case 'vertex': {
      // Claude models on Vertex AI use Anthropic's API shape; everything else is Gemini.
      const account = serviceAccount(env);
      const location = { project: options.project, location: options.location };
      if (model.id.startsWith('claude-')) return instance('vertex-anthropic', { ...location, account }, ({ account: key, ...rest }) => createVertexAnthropic({ ...rest, googleAuthOptions: googleAuthOptions(key) }))(model.id);
      const apiKey = !account && !value(env, 'GOOGLE_APPLICATION_CREDENTIALS') ? value(env, 'GOOGLE_VERTEX_API_KEY') : undefined;
      // An empty key, not a missing one: createVertex would otherwise read GOOGLE_VERTEX_API_KEY
      // itself and switch to express mode even when a service account is configured.
      return instance('vertex', { ...location, account, apiKey: apiKey ?? '' }, ({ account: key, ...rest }) => createVertex({ ...rest, googleAuthOptions: googleAuthOptions(key) }))(model.id);
    }
    default:
      return instance('openai', { apiKey: value(env, 'OPENAI_API_KEY'), ...(value(env, 'OPENAI_BASE_URL') ? { baseURL: value(env, 'OPENAI_BASE_URL') } : {}) }, createOpenAI).responses(model.id);
  }
}

// Each provider reads only its own key, so one object serves a run that escalates across providers.
// OpenAI (and Azure, which reads the same options): never store prompts, and stream reasoning
// summaries as the agent's visible thinking.
export const PROVIDER_OPTIONS = Object.freeze({ openai: { store: false, reasoningSummary: 'detailed' } });
