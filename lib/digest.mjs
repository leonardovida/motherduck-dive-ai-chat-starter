import { appQuery } from './app-db.mjs';
import { createInsights } from './insights.mjs';
import { appBaseURL } from './auth.mjs';

// A weekly summary of chat questions posted to a Slack incoming webhook (DIGEST_WEBHOOK_URL).
// The scheduled job claims each ISO week once in app_job, so retries and several server
// instances never post twice. It contains questions as people typed them; see docs/accounts.md.
export function digestWebhook(env = process.env) {
  const value = String(env.DIGEST_WEBHOOK_URL ?? '').trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

// ISO 8601 week, for example 2026-W45.
export function isoWeek(date = new Date()) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const start = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  return `${day.getUTCFullYear()}-W${String(Math.ceil(((day - start) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}

// Slack mrkdwn treats &, < and > as markup; user text must not create links or mentions.
const escape = text => String(text ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const clip = (text, max = 140) => { const value = String(text ?? '').replace(/\s+/g, ' ').trim(); return value.length > max ? `${value.slice(0, max - 1)}…` : value; };
const percent = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
const STATUS = { failed: 'failed', stopped: 'stopped', unanswered: 'no answer saved' };
const REASON = { wrong_numbers: 'wrong numbers', misunderstood: 'misunderstood', missing_data: 'missing data', too_slow: 'too slow', other: 'other' };

export function buildDigest(summary, { appUrl = '', title = 'Dive workspace', diveTitle = key => key } = {}) {
  const { totals } = summary;
  const heading = `${title}: chat questions ${summary.from ? `since ${summary.from.slice(0, 10)}` : `in the last ${summary.days} days`}`;
  if (!totals.questions) return { text: `${heading}: none.`, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `*${escape(heading)}*\nNo questions were asked.` } }] };
  const lines = [
    `*${totals.questions}* questions from *${totals.askers}* people · *${percent(totals.answered, totals.questions)}%* answered · ${totals.failed} failed · ${totals.stopped} stopped`,
    `Rated helpful *${totals.positive}* · not helpful *${totals.negative}*${totals.data_gaps ? ` · *${totals.data_gaps}* answers said the data was missing` : ''}`,
  ];
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: clip(heading, 150) } },
    { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
  ];
  if (summary.frequent.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Most asked*\n${summary.frequent.slice(0, 5).map(item => `• ${escape(clip(item.question))} (${item.questions})`).join('\n')}` } });
  }
  if (summary.attention.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Needs attention*\n${summary.attention.slice(0, 5).map(item => {
      const why = item.feedback === -1 ? `not helpful${item.feedback_reason ? `: ${REASON[item.feedback_reason] ?? item.feedback_reason}` : ''}` : STATUS[item.status] ?? item.status;
      return `• ${escape(clip(item.question))} _(${escape(why)}, ${escape(diveTitle(item.dive_key))})_`;
    }).join('\n')}` } });
  }
  if (appUrl) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `<${appUrl.replace(/\/$/, '')}/admin#questions|Open the Questions tab>` }] });
  return { text: `${heading}: ${totals.questions} questions, ${totals.negative} rated not helpful.`, blocks };
}

// Each digest covers the questions since the previous one was posted (a week the first time), so
// nothing falls between two digests and a failed week is included in the next one.
const LAST = 'digest:last';
export async function sendDigest({ env = process.env, query = appQuery, insights = createInsights(query), fetchImpl = fetch, now = new Date(), once = true, diveTitle } = {}) {
  const url = digestWebhook(env);
  if (!url) return { sent: false, reason: 'not_configured' };
  const job = `digest:${isoWeek(now)}`;
  if (once && !(await query('INSERT INTO app_job (name, ran_at) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING name', [job, now])).length) return { sent: false, reason: 'already_sent', week: job };
  try {
    const [last] = await query('SELECT ran_at FROM app_job WHERE name = $1', [LAST]);
    const from = last ? new Date(last.ran_at) : new Date(now.getTime() - 7 * 86400000);
    const summary = { ...await insights.summary({ from, now }), from: from.toISOString() };
    const response = await fetchImpl(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
      body: JSON.stringify(buildDigest(summary, { appUrl: appBaseURL(env), diveTitle })),
    });
    if (!response.ok) throw Object.assign(new Error('digest_post_failed'), { code: `http_${response.status}` });
    await query('INSERT INTO app_job (name, ran_at) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET ran_at = EXCLUDED.ran_at', [LAST, now]);
    return { sent: true, week: job, questions: summary.totals.questions };
  } catch (error) {
    // Free the week again so the next run can retry.
    if (once) await query('DELETE FROM app_job WHERE name = $1', [job]).catch(() => {});
    throw error;
  }
}
