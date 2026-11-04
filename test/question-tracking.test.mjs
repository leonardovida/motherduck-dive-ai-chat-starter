import test from 'node:test';
import assert from 'node:assert/strict';
import { createBudgets, estimateCost, modelPrices, monthStart, nextMonthStart } from '../lib/budgets.mjs';
import { classifyTopics, TOPIC_BATCH } from '../lib/topics.mjs';
import { buildDigest, digestWebhook, isoWeek, sendDigest } from '../lib/digest.mjs';
import { insightFilter } from '../lib/insights.mjs';
import { groupSchema } from '../lib/group-input.mjs';

const now = new Date('2026-11-18T10:00:00Z');

test('monthly allowances count from the first of the month (UTC) and spare administrators', async () => {
  assert.equal(monthStart(now).toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(nextMonthStart(new Date('2026-12-31T23:00:00Z')).toISOString(), '2027-01-01T00:00:00.000Z');
  const calls = [];
  const budgets = createBudgets(async (text, values) => { calls.push({ text, values }); return [{ group_id: 'g1', tokens: 1500 }, { group_id: 'g2', tokens: 10 }]; });
  const member = { groups: [{ id: 'g2', name: 'Open', monthlyTokenCap: 1000 }, { id: 'g1', name: 'Acme', monthlyTokenCap: 1000 }, { id: 'g3', name: 'No cap', monthlyTokenCap: null }] };
  const reached = await budgets.exhausted(member, { now });
  assert.deepEqual(reached, { id: 'g1', name: 'Acme', cap: 1000, used: 1500, resetsAt: '2026-12-01T00:00:00.000Z' });
  assert.equal(calls[0].values[0].toISOString(), '2026-11-01T00:00:00.000Z');
  assert.match(calls[0].text, /a\.reply_to = q\.id/);
  // Usage is cached briefly, so a busy chat does not query on every question.
  await budgets.exhausted(member, { now: new Date(now.getTime() + 5000) });
  assert.equal(calls.length, 1);
  assert.equal(await budgets.exhausted({ ...member, isAdmin: true }, { now }), null);
  assert.equal(await budgets.exhausted({ groups: [{ id: 'g3', monthlyTokenCap: null }] }, { now }), null);
  assert.equal(calls.length, 1);
});

test('the group form accepts an allowance of at least 1,000 tokens, or none', () => {
  const base = { name: 'Acme', dives: '*', chat: true };
  assert.equal(groupSchema.parse({ ...base, monthlyTokenCap: 250000 }).monthlyTokenCap, 250000);
  assert.equal(groupSchema.parse({ ...base, monthlyTokenCap: null }).monthlyTokenCap, null);
  assert.throws(() => groupSchema.parse({ ...base, monthlyTokenCap: 10 }));
  assert.throws(() => groupSchema.parse({ ...base, monthlyTokenCap: 1.5e3 + 0.5 }));
});

test('prices turn tokens into an estimated cost and name the tiers without a price', () => {
  assert.equal(modelPrices({}), null);
  assert.equal(modelPrices({ MODEL_PRICES: 'nonsense' }), null);
  const prices = modelPrices({ MODEL_PRICES: 'luna:0.25/2, SOL:1.25/10, astra:abc/1', MODEL_PRICE_CURRENCY: 'eur' });
  assert.deepEqual(prices, { currency: 'EUR', tiers: { luna: { input: 0.25, output: 2 }, sol: { input: 1.25, output: 10 } } });
  assert.equal(modelPrices({ MODEL_PRICES: 'luna:1/1', MODEL_PRICE_CURRENCY: 'dollars' }).currency, 'USD');
  const cost = estimateCost([{ model_tier: 'luna', input_tokens: 2e6, output_tokens: 1e6 }, { model_tier: 'astra', input_tokens: 5, output_tokens: 0 }, { model_tier: null, input_tokens: 0, output_tokens: 0 }], prices);
  assert.deepEqual(cost, { currency: 'EUR', total: 2.5, byTier: { luna: 2.5 }, unpriced: ['astra'] });
  assert.equal(estimateCost([], null), null);
});

test('a group manager sees only questions asked as a member of their groups', () => {
  const filter = insightFilter({ days: 7, groupIds: ['g1', "g2' OR 1=1"], now });
  assert.match(filter.where, /list_has_any\(from_json\(group_ids, '\["VARCHAR"\]'\), \[\$2::VARCHAR, \$3::VARCHAR\]\)/);
  assert.deepEqual(filter.values.slice(1), ['g1', "g2' OR 1=1"]);
  assert.match(insightFilter({ days: 7, groupIds: [], now }).where, /AND false$/);
  assert.doesNotMatch(insightFilter({ days: 7, now }).where, /group_ids/);
});

test('topic grouping labels only the questions it was given, in batches, with parameters', async () => {
  const pending = Array.from({ length: TOPIC_BATCH + 2 }, (_, i) => ({ question_id: `q-${i}`, question: `Question ${i}`, answer: 'No such table.', status: 'answered' }));
  const calls = [], prompts = [];
  const query = async (text, values) => {
    calls.push({ text, values });
    if (text.startsWith('SELECT question_id')) return pending;
    if (text.startsWith('SELECT topic')) return [{ topic: 'Revenue By Region' }];
    if (text.startsWith('SELECT count(*)')) return [{ remaining: 0 }];
    return [];
  };
  const generate = async ({ instructions, prompt }) => {
    prompts.push(JSON.parse(prompt));
    assert.match(instructions, /untrusted data/);
    const { items } = JSON.parse(prompt);
    // The model also returns an id it was not given and a duplicate; both are ignored.
    return { items: [...items.map(item => ({ id: item.id, topic: "Churn'); DROP TABLE x; --", dataGap: item.id === 'q-0' })), { id: 'q-0', topic: 'Duplicate', dataGap: false }, { id: 'someone-else', topic: 'Other Team', dataGap: true }] };
  };
  const result = await classifyTopics({ days: 7, generate, query, now });
  assert.deepEqual(result, { classified: TOPIC_BATCH + 2, remaining: 0 });
  assert.equal(prompts.length, 2);
  assert.deepEqual(prompts[0].existingTopics, ['Revenue By Region']);
  const updates = calls.filter(call => call.text.trim().startsWith('UPDATE chat_message'));
  assert.equal(updates.length, 2);
  assert.ok(updates.every(call => !call.text.includes('DROP TABLE')), 'labels are parameters, never SQL');
  assert.ok(!updates.some(call => call.values.includes('someone-else')));
  assert.equal(updates[0].values.filter(value => value === 'q-0').length, 1);
});

test('the digest posts to an https webhook once per ISO week and escapes what people typed', async () => {
  assert.equal(digestWebhook({}), null);
  assert.equal(digestWebhook({ DIGEST_WEBHOOK_URL: 'http://hooks.slack.com/x' }), null);
  assert.equal(digestWebhook({ DIGEST_WEBHOOK_URL: 'https://user:pass@hooks.slack.com/x' }), null);
  assert.equal(digestWebhook({ DIGEST_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/C' }), 'https://hooks.slack.com/services/T/B/C');
  assert.equal(isoWeek(new Date('2026-11-02T08:00:00Z')), '2026-W45');
  assert.equal(isoWeek(new Date('2027-01-01T08:00:00Z')), '2026-W53');

  const summary = {
    days: 7, totals: { questions: 3, askers: 2, answered: 2, failed: 0, stopped: 1, positive: 1, negative: 1, data_gaps: 1 },
    frequent: [{ question: '<!channel> Revenue & churn?', questions: 2 }],
    attention: [{ question: 'Why <b>?', status: 'answered', feedback: -1, feedback_reason: 'wrong_numbers', dive_key: 'overview' }],
  };
  const message = buildDigest(summary, { appUrl: 'https://app.test/', diveTitle: () => 'Overview' });
  const text = JSON.stringify(message);
  assert.ok(text.includes('&lt;!channel&gt; Revenue &amp; churn?'));
  assert.ok(!text.includes('<!channel>'));
  assert.ok(text.includes('not helpful: wrong numbers'));
  assert.ok(text.includes('<https://app.test/admin#questions|Open the Questions tab>'));

  const claims = new Set(), posts = [], periods = [];
  let last = null;
  const query = async (text, values) => {
    if (text.includes('DO UPDATE')) { last = values[1]; return []; }
    if (text.startsWith('INSERT INTO app_job')) { if (claims.has(values[0])) return []; claims.add(values[0]); return [{ name: values[0] }]; }
    if (text.startsWith('DELETE FROM app_job')) { claims.delete(values[0]); return []; }
    if (text.startsWith('SELECT ran_at')) return last ? [{ ran_at: last }] : [];
    return [];
  };
  const insights = { summary: async options => { periods.push(options.from.toISOString()); return summary; } };
  const env = { DIGEST_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/C' };
  const ok = async (url, init) => { posts.push(JSON.parse(init.body)); return { ok: true }; };
  assert.deepEqual(await sendDigest({ env, query, insights, fetchImpl: ok, now }), { sent: true, week: 'digest:2026-W47', questions: 3 });
  assert.equal((await sendDigest({ env, query, insights, fetchImpl: ok, now })).reason, 'already_sent');
  assert.equal(posts.length, 1);
  // The first digest covers a week; later ones start where the previous one ended.
  assert.equal(periods[0], '2026-11-11T10:00:00.000Z');
  assert.equal(posts[0].blocks[0].text.text, 'Dive workspace: chat questions since 2026-11-11');
  // A failed post frees the week and keeps the start, so its questions are in the next digest.
  const nextWeek = new Date('2026-11-25T08:00:00Z'), weekAfter = new Date('2026-12-02T08:00:00Z');
  await assert.rejects(sendDigest({ env, query, insights, fetchImpl: async () => ({ ok: false, status: 500 }), now: nextWeek }));
  assert.equal((await sendDigest({ env, query, insights, fetchImpl: ok, now: weekAfter })).sent, true);
  assert.deepEqual(periods.slice(1), [now.toISOString(), now.toISOString()]);
  assert.equal((await sendDigest({ env: {}, query, insights, fetchImpl: ok, now })).reason, 'not_configured');
});

test('a digest period from a moment covers every UTC day it touches, at most a year back', () => {
  const filter = insightFilter({ from: new Date('2026-11-11T10:00:00Z'), now });
  assert.equal(filter.since.toISOString(), '2026-11-11T10:00:00.000Z');
  assert.equal(filter.days, 8);
  assert.equal(insightFilter({ from: new Date('2020-01-01T00:00:00Z'), now }).since.toISOString(), '2025-11-18T10:00:00.000Z');
});
