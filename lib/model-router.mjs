import { generateText, Output } from 'ai';

// Auto routing in three stages (see docs/model-routing.md):
// 1. Free heuristics pick a tier when the question is clearly simple or clearly analytical.
// 2. Otherwise one short classification call on the cheapest tier decides.
// 3. While answering, a struggling cheaper tier escalates to the next one.
// Every decision carries a reason so admins can review and tune it.

const LEVEL = { luna: 0, sol: 1, astra: 2 };
const BY_LEVEL = ['luna', 'sol', 'astra'];

const SIMPLE = [
  /\bwhat (?:does|do|is) (?:this|the) (?:dive|dashboard|view|chart|page|report)\b/,
  /\bwhat (?:is|are|'s) (?:currently )?selected\b/, /\bwhich (?:filters?|tabs?|options?)\b/,
  /\b(?:list|which|what) (?:the )?(?:tables|views|columns|fields)\b/, /\bdescribe (?:the )?(?:table|schema)\b/,
  /\bhow many (?:rows|records|tables)\b/, /^(?:hi|hello|hey|thanks|thank you)\b/,
  /\bwhat does [\w ]{1,30} mean\b/, /\bdefine\b/,
];
const ANALYTICAL = [
  /\bcompar/, /\btrend/, /\bover time\b/, /\bgrowth\b|\bgrew\b/, /\b(?:vs\.?|versus)\b/, /\btop \d+\b/, /\brank/,
  /\bpercent|\bshare of\b|\bratio\b/, /\baverage|\bmedian\b|\bdistribution\b/, /\bper (?:month|week|day|year|customer|user|region)\b/,
  /\b(?:by|per) \w+ (?:and|by) \w+\b/, /\bmonth over month\b|\bweek over week\b/, /\bchange[sd]?\b/, /\bbreak ?down\b/,
];
const DEEP = [
  /\bwhy\b/, /\broot cause\b/, /\bdrivers?\b/, /\bexplain (?:the|why|how)\b/, /\bforecast|\bpredict|\bproject(?:ion|ed)\b/,
  /\bcorrelat/, /\bcohort|\bretention\b|\bchurn\b/, /\banomal|\boutlier/, /\bsegment/, /\byear over year\b|\byoy\b/,
  /\bwhat would happen\b|\bwhat if\b/, /\bseasonal/, /\bstatistic|\bsignifican/,
];

const textOf = message => (message?.parts ?? []).filter(part => part.type === 'text').map(part => part.text).join(' ');
const count = (patterns, text) => patterns.filter(pattern => pattern.test(text)).length;
const clampTier = (tier, enabled) => {
  const want = LEVEL[tier];
  return enabled.find(key => LEVEL[key] >= want) ?? enabled.at(-1);
};

// Stage 1. Returns { tier, reason } or { tier: null } when the signals are mixed.
export function ruleRoute({ messages, enabled, previousTier }) {
  const question = textOf(messages.at(-1)).toLowerCase().replace(/\s+/g, ' ').trim();
  const priorTurns = messages.filter(message => message.role === 'user').length - 1;
  const deep = count(DEEP, question), analytical = count(ANALYTICAL, question), simple = count(SIMPLE, question);
  const parts = (question.match(/\?/g) ?? []).length + (question.match(/\b(?:and also|then|additionally)\b|^\s*\d+[.)]/gm) ?? []).length;
  if (deep >= 2 || (deep && (analytical || question.length > 200)) || parts >= 3 || question.length > 400) {
    return { tier: clampTier('astra', enabled), reason: 'rules: open-ended or multi-part analysis' };
  }
  if (simple && !deep && !analytical && question.length <= 160) return { tier: enabled[0], reason: 'rules: lookup about the Dive or schema' };
  // Short follow-ups ("and for March?") keep the tier the previous answer needed.
  if (priorTurns > 0 && previousTier && question.length <= 60 && !deep && !analytical && /^(?:and|what about|how about|same|now|ok|also)\b/.test(question)) {
    return { tier: clampTier(previousTier, enabled), reason: 'rules: short follow-up keeps the previous tier' };
  }
  if (analytical >= 2 && !deep) return { tier: clampTier('sol', enabled), reason: 'rules: aggregation or comparison' };
  return { tier: null, reason: 'rules: mixed signals' };
}

// Stage 2. One constrained call on the cheapest tier. Falls back to the middle tier on any failure.
export async function classifyRoute({ messages, enabled, model, signal, generate = generateText, timeoutMs = 2500 }) {
  const middle = enabled[Math.floor((enabled.length - 1) / 2)];
  try {
    const history = messages.slice(-5, -1).map(message => `${message.role}: ${textOf(message).slice(0, 300)}`).join('\n');
    const { output } = await generate({
      model,
      output: Output.choice({ options: ['simple', 'moderate', 'complex'] }),
      instructions: 'Classify how much work a data assistant needs to answer the latest question about a dashboard and its database. simple: a lookup, a definition, what the dashboard shows, or one obvious query. moderate: one or two aggregate queries, a comparison, a trend or a ranking. complex: several dependent queries, explanations of why something happened, statistics, forecasting or multi-part requests.',
      prompt: `${history ? `Earlier conversation:\n${history}\n\n` : ''}Latest question:\n${textOf(messages.at(-1)).slice(0, 2000)}`,
      maxOutputTokens: 16, maxRetries: 0, reasoning: 'none',
      abortSignal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(timeoutMs)]),
      providerOptions: { openai: { store: false } },
    });
    const tier = { simple: 'luna', moderate: 'sol', complex: 'astra' }[output];
    if (!tier) throw new Error('unexpected_route');
    return { tier: clampTier(tier, enabled), reason: `classifier: ${output}` };
  } catch {
    return { tier: middle, reason: 'classifier unavailable: balanced default' };
  }
}

export async function routeQuestion({ messages, enabled, previousTier, classify }) {
  const ruled = ruleRoute({ messages, enabled, previousTier });
  if (ruled.tier) return ruled;
  return classify ? classify() : { tier: enabled[Math.floor((enabled.length - 1) / 2)], reason: 'rules: mixed signals, balanced default' };
}

// Stage 3. Called before each step. A cheaper tier that keeps failing or wandering escalates once
// per call; a cheaper answer that needs three retries is rarely cheaper overall.
export function escalation({ steps, tier, enabled }) {
  const next = enabled.find(key => LEVEL[key] > LEVEL[tier]);
  if (!next) return null;
  const results = steps.flatMap(step => step.content ?? []);
  const failures = results.filter(part => part.type === 'tool-error' || (part.type === 'tool-result' && part.output && typeof part.output === 'object' && 'error' in part.output)).length;
  const limit = { luna: [1, 4], sol: [2, 6] }[tier];
  if (!limit) return null;
  if (failures >= limit[0]) return { tier: next, reason: `escalated: ${failures} failed tool call${failures === 1 ? '' : 's'}` };
  if (steps.length >= limit[1]) return { tier: next, reason: `escalated: ${steps.length} steps without an answer` };
  return null;
}

export const tierLevel = tier => LEVEL[tier] ?? 0;
export const tierAt = level => BY_LEVEL[level];
