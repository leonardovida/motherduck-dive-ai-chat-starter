import { generateText, tool } from 'ai';
import { z } from 'zod';
import { languageModel, PROVIDER_OPTIONS } from './model-providers.mjs';
import { SECRET_ENV_NAMES, endpointOptions, keyDestinationAllowed, missingFor } from './provider-registry.mjs';

// Error text from a provider can echo request details. Before it reaches the admin portal,
// every credential value from the environment, every bearer or key header, URL credentials and
// query strings, and anything shaped like a key are replaced, and the text is shortened.
const SECRETISH_NAME = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE)/i;
export function sanitizeProviderError(error, env = process.env) {
  let text = String(error?.message ?? error ?? 'error');
  const values = Object.entries(env ?? {})
    .filter(([name, item]) => (SECRET_ENV_NAMES.includes(name) || SECRETISH_NAME.test(name)) && typeof item === 'string' && item.trim().length >= 6)
    .flatMap(([, item]) => [item.trim(), ...item.trim().split(/\\n|\n/).filter(part => part.length >= 12)])
    .sort((a, b) => b.length - a.length);
  for (const secret of values) text = text.split(secret).join('[redacted]');
  text = text
    .replace(/-----BEGIN[^-]*-----[\s\S]*?(-----END[^-]*-----|$)/g, '[redacted]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]')
    .replace(/\b(api[-_]?key|x-api-key|authorization|access[-_]?token|secret|password|signature|credential)(["']?\s*[:=]\s*["']?)[^\s"',;&}]+/gi, '$1$2[redacted]')
    .replace(/(https?:\/\/)[^/\s@]+@/gi, '$1[redacted]@')
    .replace(/(https?:\/\/[^\s?#"']+)\?[^\s"']*/gi, '$1?[redacted]')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[redacted]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, '[redacted]')
    .replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 300 ? `${text.slice(0, 297)}...` : text;
}

const HINTS = {
  401: 'The provider rejected the credentials. Check the key in the environment.',
  403: 'The credentials are valid but lack access to this model or endpoint.',
  404: 'The model or deployment was not found. Check the model id, deployment name, region or location.',
  429: 'The provider is rate limiting or out of quota.',
};

// Sends one tiny prompt with one tool, server side, and reports whether the model answered and
// whether it called the tool. The chat needs tool calling, so a model that never calls the tool
// is reported as a warning.
export async function testModel(model, env = process.env, { generate = generateText, timeoutMs = 30000 } = {}) {
  const missing = missingFor(model.provider, env, model.options);
  if (missing.length) return { ok: false, error: `Missing environment variables: ${missing.join('; ')}.`, missing };
  const notes = [];
  const endpoint = endpointOptions(model.provider, model.options, env);
  const KEYS = { openrouter: 'OPENROUTER_API_KEY', 'openai-compatible': 'OPENAI_COMPATIBLE_API_KEY', azure: 'AZURE_API_KEY' };
  if (String(env[KEYS[model.provider]] ?? '').trim() && !keyDestinationAllowed(model.provider, endpoint.baseURL, env)) {
    notes.push('The API key in the environment is not sent to this base URL, because it differs from the one set in the environment.');
  }
  const started = Date.now();
  try {
    const result = await generate({
      model: languageModel(model, env),
      tools: { ping: tool({ description: 'Connectivity check. Call it exactly once.', inputSchema: z.object({ value: z.string().max(20) }), execute: async () => ({ ok: true }) }) },
      toolChoice: 'auto',
      prompt: 'This is a connectivity check. Call the ping tool once with value "ok". Do not reply with text.',
      maxOutputTokens: 2000, maxRetries: 0, abortSignal: AbortSignal.timeout(timeoutMs), providerOptions: PROVIDER_OPTIONS,
    });
    const calls = (result.steps ?? []).flatMap(step => step.toolCalls ?? []).concat(result.toolCalls ?? []);
    const toolCall = calls.some(call => call.toolName === 'ping');
    return { ok: true, toolCall, latencyMs: Date.now() - started, notes: toolCall ? notes : [...notes, 'The model answered but did not call the tool. The chat needs a model that supports tool calling.'] };
  } catch (error) {
    const status = Number(error?.statusCode) || null;
    return { ok: false, status, error: sanitizeProviderError(error, env), hint: HINTS[status] ?? null, latencyMs: Date.now() - started, notes };
  }
}
