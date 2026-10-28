// A manual credential/connectivity check. No Dive data or database tokens are used.
import { openAIEndpoint } from '../lib/openai-endpoint.mjs';

try {
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
const model = process.env.OPENAI_SMOKE_MODEL || 'gpt-6-luna';
const response = await fetch(openAIEndpoint('responses'), {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model, input: 'Reply with exactly OK.', max_output_tokens: 64, reasoning: { effort: 'none' }, store: false }),
  signal: AbortSignal.timeout(30000),
});
if (!response.ok) throw new Error(`OpenAI smoke check failed (HTTP ${response.status})`);
const result = await response.json();
const text = (result.output || []).flatMap(item => item.content || []).filter(part => part.type === 'output_text').map(part => part.text).join('').trim();
if (text !== 'OK') throw new Error('OpenAI smoke check returned an unexpected result');
console.log('OpenAI smoke check passed.');
} catch (error) {
  const safe = /^(?:OpenAI smoke check failed \(HTTP \d{3}\)|OpenAI smoke check returned an unexpected result|OPENAI_API_KEY is not configured)$/.test(error.message);
  console.error(safe ? error.message : 'OpenAI smoke check failed. Check the key, model access, OPENAI_BASE_URL and network connectivity.');
  process.exitCode = 1;
}
