// What the app knows about each model provider, without loading any provider SDK: which
// environment variables it reads, when it counts as configured, which non-secret fields an
// administrator may set, the built-in default models and the presets the admin Models tab offers.
// Secrets (API keys, AWS secrets, Google credentials) are read from the environment only.

const value = (env, name) => String(env?.[name] ?? '').trim();
const set = (env, name) => Boolean(value(env, name));

export const PROVIDER_IDS = Object.freeze(['openai', 'anthropic', 'openrouter', 'azure', 'bedrock', 'vertex', 'openai-compatible']);

// Friendlier names accepted in CHAT_PROVIDER and in provider:model values.
const ALIASES = {
  'amazon-bedrock': 'bedrock', aws: 'bedrock', 'aws-bedrock': 'bedrock',
  'azure-openai': 'azure', foundry: 'azure', 'azure-foundry': 'azure',
  'google-vertex': 'vertex', 'vertex-ai': 'vertex', google: 'vertex',
  'openai_compatible': 'openai-compatible', compatible: 'openai-compatible', 'self-hosted': 'openai-compatible', selfhosted: 'openai-compatible',
};
export const providerId = raw => {
  const name = String(raw ?? '').trim().toLowerCase();
  return PROVIDER_IDS.includes(name) ? name : ALIASES[name] ?? null;
};

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const AZURE_HOST = /\.(openai\.azure\.com|services\.ai\.azure\.com|cognitiveservices\.azure\.com)$/i;

const origin = url => { try { return new URL(url).origin; } catch { return null; } };
const sameOrigin = (a, b) => Boolean(origin(a)) && origin(a) === origin(b);

// Vertex credentials: a service-account key file, the key's email and private key as two
// variables, an express-mode API key, or the runtime's own identity on Google Cloud.
const vertexCredentials = env => set(env, 'GOOGLE_APPLICATION_CREDENTIALS') || (set(env, 'GOOGLE_CLIENT_EMAIL') && set(env, 'GOOGLE_PRIVATE_KEY'))
  || set(env, 'GOOGLE_VERTEX_API_KEY') || value(env, 'GOOGLE_VERTEX_ADC').toLowerCase() === 'true';
const awsCredentials = env => set(env, 'AWS_BEARER_TOKEN_BEDROCK') || (set(env, 'AWS_ACCESS_KEY_ID') && set(env, 'AWS_SECRET_ACCESS_KEY'));

// Each provider: label, env names (secret ones are never shown, only whether they are set),
// the non-secret fields an administrator can set per tier, whether the portable reasoning
// setting is sent, and checks that use env presence plus the tier's own fields.
export const PROVIDERS_INFO = Object.freeze({
  openai: {
    label: 'OpenAI', reasoning: true, fields: [],
    env: [{ name: 'OPENAI_API_KEY', secret: true }, { name: 'OPENAI_BASE_URL', optional: true }],
    missing: env => (set(env, 'OPENAI_API_KEY') ? [] : ['OPENAI_API_KEY']),
    detect: env => set(env, 'OPENAI_API_KEY'),
  },
  anthropic: {
    label: 'Anthropic', reasoning: true, fields: [],
    env: [{ name: 'ANTHROPIC_API_KEY', secret: true }, { name: 'ANTHROPIC_BASE_URL', optional: true }],
    missing: env => (set(env, 'ANTHROPIC_API_KEY') ? [] : ['ANTHROPIC_API_KEY']),
    detect: env => set(env, 'ANTHROPIC_API_KEY'),
  },
  openrouter: {
    label: 'OpenRouter', reasoning: true, fields: ['baseURL'],
    env: [{ name: 'OPENROUTER_API_KEY', secret: true }, { name: 'OPENROUTER_BASE_URL', optional: true }],
    missing: env => (set(env, 'OPENROUTER_API_KEY') ? [] : ['OPENROUTER_API_KEY']),
    detect: env => set(env, 'OPENROUTER_API_KEY'),
  },
  azure: {
    label: 'Azure OpenAI / Microsoft Foundry', reasoning: true, fields: ['resourceName', 'baseURL', 'apiVersion', 'api'],
    env: [{ name: 'AZURE_API_KEY', secret: true }, { name: 'AZURE_RESOURCE_NAME' }, { name: 'AZURE_BASE_URL', optional: true }, { name: 'AZURE_API_VERSION', optional: true }],
    missing: (env, options = {}) => [
      ...(set(env, 'AZURE_API_KEY') ? [] : ['AZURE_API_KEY']),
      ...(options.resourceName || options.baseURL || set(env, 'AZURE_RESOURCE_NAME') || set(env, 'AZURE_BASE_URL') ? [] : ['AZURE_RESOURCE_NAME or AZURE_BASE_URL']),
    ],
    detect: env => set(env, 'AZURE_API_KEY') && (set(env, 'AZURE_RESOURCE_NAME') || set(env, 'AZURE_BASE_URL')),
  },
  bedrock: {
    label: 'Amazon Bedrock', reasoning: true, fields: ['region'],
    env: [{ name: 'AWS_BEARER_TOKEN_BEDROCK', secret: true }, { name: 'AWS_ACCESS_KEY_ID', secret: true }, { name: 'AWS_SECRET_ACCESS_KEY', secret: true }, { name: 'AWS_SESSION_TOKEN', secret: true, optional: true }, { name: 'AWS_REGION' }],
    missing: (env, options = {}) => [
      ...(awsCredentials(env) ? [] : ['AWS_BEARER_TOKEN_BEDROCK, or AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY']),
      ...(options.region || set(env, 'AWS_REGION') ? [] : ['AWS_REGION']),
    ],
    // AWS runtimes often carry access keys for other purposes, so only the Bedrock API key
    // selects Bedrock by itself. Otherwise set CHAT_PROVIDER=bedrock.
    detect: env => set(env, 'AWS_BEARER_TOKEN_BEDROCK') && set(env, 'AWS_REGION'),
  },
  vertex: {
    label: 'Google Vertex AI', reasoning: true, fields: ['project', 'location'],
    env: [{ name: 'GOOGLE_VERTEX_PROJECT' }, { name: 'GOOGLE_VERTEX_LOCATION', optional: true }, { name: 'GOOGLE_APPLICATION_CREDENTIALS' }, { name: 'GOOGLE_CLIENT_EMAIL' }, { name: 'GOOGLE_PRIVATE_KEY', secret: true }, { name: 'GOOGLE_VERTEX_API_KEY', secret: true, optional: true }, { name: 'GOOGLE_VERTEX_ADC', optional: true }],
    missing: (env, options = {}) => [
      ...(vertexCredentials(env) ? [] : ['GOOGLE_APPLICATION_CREDENTIALS, or GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY']),
      ...(options.project || set(env, 'GOOGLE_VERTEX_PROJECT') || set(env, 'GOOGLE_VERTEX_API_KEY') ? [] : ['GOOGLE_VERTEX_PROJECT']),
    ],
    detect: env => vertexCredentials(env) && (set(env, 'GOOGLE_VERTEX_PROJECT') || set(env, 'GOOGLE_VERTEX_API_KEY')),
  },
  'openai-compatible': {
    label: 'Self-hosted or other OpenAI-compatible endpoint', reasoning: false, fields: ['baseURL'],
    env: [{ name: 'OPENAI_COMPATIBLE_BASE_URL' }, { name: 'OPENAI_COMPATIBLE_API_KEY', secret: true, optional: true }, { name: 'OPENAI_COMPATIBLE_MODEL', optional: true }],
    missing: (env, options = {}) => (options.baseURL || set(env, 'OPENAI_COMPATIBLE_BASE_URL') ? [] : ['OPENAI_COMPATIBLE_BASE_URL']),
    detect: env => set(env, 'OPENAI_COMPATIBLE_BASE_URL'),
  },
});

export const missingFor = (provider, env = process.env, options = {}) => PROVIDERS_INFO[provider]?.missing(env, options) ?? ['a supported provider'];
export const providerReady = (provider, env = process.env, options = {}) => Boolean(PROVIDERS_INFO[provider]) && missingFor(provider, env, options).length === 0;
export const detectProvider = (provider, env = process.env) => Boolean(PROVIDERS_INFO[provider]?.detect(env));

// Built-in defaults per tier. Self-hosted endpoints have no default: OPENAI_COMPATIBLE_MODEL, a
// per-tier model or the admin Models tab names the model. Azure ids are deployment names.
const GPT = Object.freeze({ luna: 'gpt-6-luna', sol: 'gpt-6.1-sol', astra: 'gpt-6-astra' });
const CLAUDE = Object.freeze({ luna: 'claude-haiku-5-5', sol: 'claude-sonnet-5-5', astra: 'claude-opus-5-5' });
const GEMINI = Object.freeze({ luna: 'gemini-3.5-flash-lite', sol: 'gemini-3.8-flash', astra: 'gemini-4-argon' });
const prefixed = (prefix, models) => Object.freeze(Object.fromEntries(Object.entries(models).map(([key, id]) => [key, `${prefix}${id}`])));
const OPENROUTER_CLAUDE = Object.freeze({ luna: 'anthropic/claude-haiku-5.5', sol: 'anthropic/claude-sonnet-5.5', astra: 'anthropic/claude-opus-5.5' });

export const DEFAULT_MODELS = Object.freeze({
  openai: GPT,
  anthropic: CLAUDE,
  openrouter: prefixed('openai/', GPT),
  azure: GPT,
  bedrock: prefixed('global.anthropic.', CLAUDE),
  vertex: GEMINI,
  'openai-compatible': Object.freeze({ luna: '', sol: '', astra: '' }),
});

// One-click choices in the Models tab. Ids come from each provider's published model list.
export const PRESETS = Object.freeze({
  openai: [{ id: 'gpt', label: 'GPT-6', models: GPT }],
  anthropic: [{ id: 'claude', label: 'Claude', models: CLAUDE }],
  openrouter: [
    { id: 'gpt', label: 'OpenAI GPT-6', models: prefixed('openai/', GPT) },
    { id: 'claude', label: 'Anthropic Claude', models: OPENROUTER_CLAUDE },
    { id: 'gemini', label: 'Google Gemini', models: prefixed('google/', GEMINI) },
  ],
  azure: [{ id: 'gpt', label: 'GPT-6 (deployment names must match)', models: GPT }],
  bedrock: [{ id: 'claude-global', label: 'Claude, global inference profiles', models: prefixed('global.anthropic.', CLAUDE) }],
  vertex: [
    { id: 'gemini', label: 'Gemini', models: GEMINI },
    { id: 'claude', label: 'Claude on Vertex AI', models: CLAUDE },
  ],
  'openai-compatible': [],
});

// Non-secret fields: validation that also keeps credentials out of the app database.
const URL_LIMIT = 500;
export function checkBaseURL(raw) {
  let url;
  try { url = new URL(String(raw)); } catch { return 'invalid_url'; }
  if (!['http:', 'https:'].includes(url.protocol)) return 'url_must_be_http';
  if (url.username || url.password) return 'url_has_credentials';
  if (url.search || url.hash) return 'url_has_query';
  if (String(raw).length > URL_LIMIT) return 'url_too_long';
  return null;
}
export const FIELD_PATTERNS = Object.freeze({
  region: /^[a-z]{2}(?:-[a-z]+)+-\d{1,2}$/,
  resourceName: /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/i,
  apiVersion: /^[\w.-]{1,40}$/,
  project: /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/,
  location: /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/,
  api: /^(responses|chat)$/,
});
export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;

// Values that look like a credential are refused anywhere in the settings, so an API key pasted
// into the wrong box is never stored.
const SECRET_SHAPES = [
  /\bsk-[A-Za-z0-9_-]{16,}/, /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/, /\bsk-ant-[A-Za-z0-9_-]{10,}/, /\bsk-or-[A-Za-z0-9_-]{10,}/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, /BEGIN [A-Z ]*PRIVATE KEY/, /\bAIza[0-9A-Za-z_-]{30,}/, /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
  /\bABSK[A-Za-z0-9+/=]{20,}/,
];
export const looksLikeSecret = text => SECRET_SHAPES.some(pattern => pattern.test(String(text ?? '')));

// Where a provider's key may be sent. A key from the environment goes only to the provider's own
// endpoint or to the base URL set next to it in the environment, so changing a URL in the admin
// portal can never send the key somewhere else.
export function keyDestinationAllowed(provider, baseURL, env = process.env) {
  if (provider === 'openrouter') return sameOrigin(baseURL, OPENROUTER_BASE_URL) || (set(env, 'OPENROUTER_BASE_URL') && sameOrigin(baseURL, value(env, 'OPENROUTER_BASE_URL')));
  if (provider === 'openai-compatible') return set(env, 'OPENAI_COMPATIBLE_BASE_URL') && sameOrigin(baseURL, value(env, 'OPENAI_COMPATIBLE_BASE_URL'));
  if (provider === 'azure') {
    if (!baseURL) return true;
    try {
      const url = new URL(baseURL);
      if (url.protocol === 'https:' && AZURE_HOST.test(url.hostname)) return true;
    } catch { return false; }
    return set(env, 'AZURE_BASE_URL') && sameOrigin(baseURL, value(env, 'AZURE_BASE_URL'));
  }
  return true;
}

// The endpoint settings a tier resolves to: its own fields first, then the environment.
// Never includes secrets.
export function endpointOptions(provider, options = {}, env = process.env) {
  switch (provider) {
    case 'openrouter': return { baseURL: options.baseURL || value(env, 'OPENROUTER_BASE_URL') || OPENROUTER_BASE_URL };
    case 'openai-compatible': return { baseURL: options.baseURL || value(env, 'OPENAI_COMPATIBLE_BASE_URL') };
    case 'azure': {
      const location = options.resourceName || options.baseURL
        ? { resourceName: options.resourceName || undefined, baseURL: options.baseURL || undefined }
        : { resourceName: value(env, 'AZURE_RESOURCE_NAME') || undefined, baseURL: value(env, 'AZURE_BASE_URL') || undefined };
      return { ...location, apiVersion: options.apiVersion || value(env, 'AZURE_API_VERSION') || undefined, api: options.api || 'responses' };
    }
    case 'bedrock': return { region: options.region || value(env, 'AWS_REGION') || undefined };
    case 'vertex': return { project: options.project || value(env, 'GOOGLE_VERTEX_PROJECT') || undefined, location: options.location || value(env, 'GOOGLE_VERTEX_LOCATION') || 'global' };
    default: return {};
  }
}

// Every environment variable a provider reads, with presence only. Used by the Models tab.
export function envPresence(env = process.env) {
  return Object.fromEntries(PROVIDER_IDS.map(id => [id, PROVIDERS_INFO[id].env.map(item => ({ name: item.name, set: set(env, item.name), secret: Boolean(item.secret), optional: Boolean(item.optional) }))]));
}

// What a setup agent asks for when a provider is the default (npm run setup -- --json): names,
// kinds and whether each is required. Where a provider accepts either of two credential sets,
// the one already present is listed; otherwise the simpler one is.
export function setupRequirements(provider, env = process.env) {
  const secret = (name, required = true) => ({ name, kind: 'secret', required });
  const setting = (name, required = true) => ({ name, kind: 'setting', required });
  switch (provider) {
    case 'anthropic': return [secret('ANTHROPIC_API_KEY')];
    case 'openrouter': return [secret('OPENROUTER_API_KEY')];
    case 'azure': return [secret('AZURE_API_KEY'), setting(set(env, 'AZURE_BASE_URL') ? 'AZURE_BASE_URL' : 'AZURE_RESOURCE_NAME')];
    case 'bedrock': return [
      ...(set(env, 'AWS_ACCESS_KEY_ID') && !set(env, 'AWS_BEARER_TOKEN_BEDROCK') ? [secret('AWS_ACCESS_KEY_ID'), secret('AWS_SECRET_ACCESS_KEY')] : [secret('AWS_BEARER_TOKEN_BEDROCK')]),
      setting('AWS_REGION'),
    ];
    case 'vertex': return [
      setting('GOOGLE_VERTEX_PROJECT'), setting('GOOGLE_VERTEX_LOCATION', false),
      ...(value(env, 'GOOGLE_VERTEX_ADC').toLowerCase() === 'true' ? [setting('GOOGLE_VERTEX_ADC')]
        : set(env, 'GOOGLE_APPLICATION_CREDENTIALS') ? [setting('GOOGLE_APPLICATION_CREDENTIALS')]
          : [setting('GOOGLE_CLIENT_EMAIL'), secret('GOOGLE_PRIVATE_KEY')]),
    ];
    case 'openai-compatible': return [setting('OPENAI_COMPATIBLE_BASE_URL'), setting('OPENAI_COMPATIBLE_MODEL'), secret('OPENAI_COMPATIBLE_API_KEY', false)];
    default: return [secret('OPENAI_API_KEY')];
  }
}

// Names whose values are credentials, so error messages can be scrubbed of them.
export const SECRET_ENV_NAMES = Object.freeze([...new Set(PROVIDER_IDS.flatMap(id => PROVIDERS_INFO[id].env.filter(item => item.secret).map(item => item.name)))]);
