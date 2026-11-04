import { appQuery } from './app-db.mjs';

// Monthly AI chat allowances per group, counted in tokens from saved answers. A question counts
// toward every group the asker was in when they asked. Calendar months are UTC.
export const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
export const nextMonthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
const CACHE_MS = 30000;

export function createBudgets(query = appQuery) {
  let cached = null;
  return {
    // Tokens used this month, by group id.
    async usage({ now = new Date(), fresh = false } = {}) {
      const since = monthStart(now);
      if (!fresh && cached && cached.since.getTime() === since.getTime() && now.getTime() - cached.at < CACHE_MS) return cached.usage;
      const rows = await query(
        `SELECT g.group_id, sum(coalesce(a.input_tokens, 0) + coalesce(a.output_tokens, 0))::DOUBLE AS tokens
           FROM chat_message q JOIN chat_message a ON a.reply_to = q.id AND a.role = 'assistant',
                unnest(from_json(q.group_ids, '["VARCHAR"]')) AS g(group_id)
          WHERE q.role = 'user' AND q.created_at >= $1 AND q.group_ids IS NOT NULL
          GROUP BY ALL`,
        [since],
      );
      const usage = new Map(rows.map(row => [row.group_id, Number(row.tokens) || 0]));
      cached = { at: now.getTime(), since, usage };
      return usage;
    },
    // The first of the viewer's groups whose allowance is used up, or null. Administrators are
    // never limited, so they can always reach the settings that change the allowance.
    async exhausted(viewer, { now = new Date() } = {}) {
      if (viewer?.isAdmin) return null;
      const capped = (viewer?.groups ?? []).filter(group => group.monthlyTokenCap);
      if (!capped.length) return null;
      const usage = await this.usage({ now });
      const group = capped.find(item => (usage.get(item.id) ?? 0) >= item.monthlyTokenCap);
      return group ? { id: group.id, name: group.name, cap: group.monthlyTokenCap, used: usage.get(group.id), resetsAt: nextMonthStart(now).toISOString() } : null;
    },
  };
}

let shared;
export const budgets = () => (shared ??= createBudgets());

// Optional prices turn tokens into an estimated cost: MODEL_PRICES="luna:0.25/2,sol:1.25/10"
// gives the price per million input and output tokens for each tier.
export function modelPrices(env = process.env) {
  const prices = {};
  for (const entry of String(env.MODEL_PRICES ?? '').split(',')) {
    const match = entry.trim().match(/^([a-z][a-z0-9_-]{0,39}):(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/i);
    if (match) prices[match[1].toLowerCase()] = { input: Number(match[2]), output: Number(match[3]) };
  }
  if (!Object.keys(prices).length) return null;
  const currency = String(env.MODEL_PRICE_CURRENCY ?? '').trim().toUpperCase();
  return { currency: /^[A-Z]{3}$/.test(currency) ? currency : 'USD', tiers: prices };
}

// Estimated cost per model tier and in total. Tiers without a price are left out of the total
// and listed as unpriced.
export function estimateCost(models, prices) {
  if (!prices) return null;
  const byTier = {}, unpriced = [];
  let total = 0;
  for (const row of models) {
    const price = row.model_tier && prices.tiers[row.model_tier];
    if (!price) { if (row.model_tier && (row.input_tokens || row.output_tokens)) unpriced.push(row.model_tier); continue; }
    const amount = ((Number(row.input_tokens) || 0) * price.input + (Number(row.output_tokens) || 0) * price.output) / 1e6;
    byTier[row.model_tier] = amount;
    total += amount;
  }
  return { currency: prices.currency, total, byTier, unpriced };
}
