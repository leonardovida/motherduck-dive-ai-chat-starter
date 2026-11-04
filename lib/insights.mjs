import { appQuery } from './app-db.mjs';
import { estimateCost } from './budgets.mjs';

// What people ask in chat, read from the chat_questions view (lib/app-db-schema.mjs).
// Every filter is a parameter; days is clamped so a request cannot scan without bound.
export const INSIGHT_DAYS = [7, 30, 90, 365];
export const EXPORT_LIMIT = 10000;
const DAY = 86400000;

const midnight = date => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

// groupIds limits the questions to those asked as a member of these groups (a group manager's view).
// from replaces days with an exact start (the digest reports since the previous one), at most a year back.
export function insightFilter({ days = 30, from, diveKey, group, groupIds, now = new Date() } = {}) {
  let span, since;
  if (from) {
    since = new Date(Math.max(new Date(from).getTime(), now.getTime() - 365 * DAY));
    span = (midnight(now) - midnight(since)) / DAY + 1;
  } else {
    span = Math.min(Math.max(Number.parseInt(days, 10) || 30, 1), 365);
    // Whole UTC days: the window starts at midnight, span - 1 days before today.
    since = new Date(midnight(now) - (span - 1) * DAY);
  }
  const values = [since], where = ['asked_at >= $1'];
  if (diveKey) { values.push(String(diveKey).slice(0, 40)); where.push(`dive_key = $${values.length}`); }
  if (group) { values.push(String(group).slice(0, 80)); where.push(`list_contains(from_json(group_names, '["VARCHAR"]'), $${values.length})`); }
  if (groupIds) {
    const ids = groupIds.slice(0, 100).map(id => { values.push(String(id)); return `$${values.length}::VARCHAR`; });
    where.push(ids.length ? `list_has_any(from_json(group_ids, '["VARCHAR"]'), [${ids.join(', ')}])` : 'false');
  }
  return { days: span, since, where: where.join(' AND '), values };
}

// One entry per UTC day in the window, with zeros where nothing was asked.
export function fillDays(rows, { days, since }) {
  const byDay = new Map(rows.map(row => [row.day, row]));
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(midnight(since) + index * DAY).toISOString().slice(0, 10);
    const row = byDay.get(day);
    return { day, questions: row?.questions ?? 0, unsuccessful: row?.unsuccessful ?? 0, negative: row?.negative ?? 0 };
  });
}

const OUTCOMES = `count(*)::INTEGER AS questions,
  count(*) FILTER (WHERE status <> 'answered')::INTEGER AS unsuccessful,
  count(*) FILTER (WHERE feedback = 1)::INTEGER AS positive,
  count(*) FILTER (WHERE feedback = -1)::INTEGER AS negative`;
// Questions that differ only in case, spacing or closing punctuation count as the same question.
const NORMALIZED = `regexp_replace(lower(trim(regexp_replace(question, '\\s+', ' ', 'g'))), '[\\s?.!]+$', '')`;

export function createInsights(query = appQuery) {
  return {
    async summary(options = {}) {
      const filter = insightFilter(options);
      const { where, values } = filter;
      const [[totals], daily, dives, groups, models, frequent, attention, topics, gaps] = await Promise.all([
        query(`SELECT ${OUTCOMES}, count(DISTINCT user_id)::INTEGER AS askers, count(DISTINCT conversation_id)::INTEGER AS conversations,
                      count(*) FILTER (WHERE status = 'answered')::INTEGER AS answered, count(*) FILTER (WHERE status = 'failed')::INTEGER AS failed,
                      count(*) FILTER (WHERE status = 'stopped')::INTEGER AS stopped, count(*) FILTER (WHERE status = 'unanswered')::INTEGER AS unanswered,
                      median(worked_ms) FILTER (WHERE status = 'answered')::DOUBLE AS median_ms,
                      coalesce(sum(input_tokens), 0)::DOUBLE AS input_tokens, coalesce(sum(output_tokens), 0)::DOUBLE AS output_tokens,
                      count(*) FILTER (WHERE classified_at IS NULL)::INTEGER AS unclassified, count(*) FILTER (WHERE data_gap)::INTEGER AS data_gaps
                 FROM chat_questions WHERE ${where}`, values),
        query(`SELECT strftime(asked_at::DATE, '%Y-%m-%d') AS day, ${OUTCOMES} FROM chat_questions WHERE ${where} GROUP BY ALL ORDER BY day`, values),
        query(`SELECT dive_key, ${OUTCOMES} FROM chat_questions WHERE ${where} GROUP BY ALL ORDER BY questions DESC, dive_key LIMIT 50`, values),
        // A question asked by someone in two groups counts once in each.
        query(`SELECT group_name, ${OUTCOMES} FROM (
                 SELECT *, unnest(CASE WHEN json_array_length(group_names) > 0 THEN from_json(group_names, '["VARCHAR"]') ELSE [NULL::VARCHAR] END) AS group_name
                   FROM chat_questions WHERE ${where})
               GROUP BY ALL ORDER BY questions DESC, group_name NULLS LAST LIMIT 50`, values),
        query(`SELECT model_tier, ${OUTCOMES}, median(worked_ms)::DOUBLE AS median_ms, avg(input_tokens + output_tokens)::DOUBLE AS avg_tokens,
                      coalesce(sum(input_tokens), 0)::DOUBLE AS input_tokens, coalesce(sum(output_tokens), 0)::DOUBLE AS output_tokens
                 FROM chat_questions WHERE ${where} GROUP BY ALL ORDER BY questions DESC, model_tier NULLS LAST`, values),
        query(`SELECT ${NORMALIZED} AS normalized, arg_max(question, asked_at) AS question, arg_max(conversation_id, asked_at) AS conversation_id,
                      count(DISTINCT user_id)::INTEGER AS askers, max(asked_at) AS last_asked_at, ${OUTCOMES}
                 FROM chat_questions WHERE ${where} GROUP BY ALL ORDER BY questions DESC, last_asked_at DESC LIMIT 10`, values),
        query(`SELECT question_id, conversation_id, user_label, dive_key, question, status, feedback, feedback_reason, feedback_note, model_tier, asked_at
                 FROM chat_questions WHERE ${where} AND (status <> 'answered' OR feedback = -1)
                  -- A question from the last five minutes may still be streaming its answer.
                  AND NOT (status = 'unanswered' AND asked_at > now() - INTERVAL 5 MINUTE)
                ORDER BY asked_at DESC LIMIT 25`, values),
        query(`SELECT topic, ${OUTCOMES}, count(*) FILTER (WHERE data_gap)::INTEGER AS data_gaps
                 FROM chat_questions WHERE ${where} AND topic IS NOT NULL GROUP BY ALL ORDER BY questions DESC, topic LIMIT 30`, values),
        // Answers that said the data needed was not there: material for whoever maintains the Dives.
        query(`SELECT question_id, conversation_id, user_label, dive_key, question, topic, asked_at
                 FROM chat_questions WHERE ${where} AND data_gap ORDER BY asked_at DESC LIMIT 25`, values),
      ]);
      // Group managers cannot open conversations, so their view carries no conversation ids.
      const listed = rows => (options.groupIds ? rows.map(({ conversation_id, ...row }) => row) : rows);
      return {
        days: filter.days, since: filter.since.toISOString(), totals, daily: fillDays(daily, filter), dives, groups, models,
        frequent: listed(frequent.map(({ normalized, ...row }) => row)), attention: listed(attention), topics, gaps: listed(gaps),
        cost: estimateCost(models, options.prices ?? null),
      };
    },
    // Rows for a CSV download, newest first. Answers are left out; the conversation id links to them.
    async rows(options = {}) {
      const { where, values } = insightFilter(options);
      values.push(EXPORT_LIMIT);
      const rows = await query(
        `SELECT asked_at, user_label, dive_key, group_names, question, status, feedback, feedback_reason, feedback_note, topic, data_gap, model_tier, model_id, worked_ms::DOUBLE AS worked_ms, input_tokens::DOUBLE AS input_tokens, output_tokens::DOUBLE AS output_tokens, tool_calls, dive_state, conversation_id, question_id
           FROM chat_questions WHERE ${where} ORDER BY asked_at DESC LIMIT $${values.length}`,
        values,
      );
      return rows.map(row => ({ ...row, group_names: typeof row.group_names === 'string' ? JSON.parse(row.group_names) : row.group_names ?? [] }));
    },
    // Choices for the filters: Dives and groups that appear in saved questions.
    async facets() {
      const [dives, groups] = await Promise.all([
        query('SELECT DISTINCT dive_key FROM chat_conversation ORDER BY dive_key LIMIT 100'),
        query(`SELECT DISTINCT unnest(from_json(group_names, '["VARCHAR"]')) AS group_name FROM chat_message WHERE role = 'user' AND group_names IS NOT NULL ORDER BY group_name LIMIT 200`),
      ]);
      return { dives: dives.map(row => row.dive_key), groups: groups.map(row => row.group_name).filter(Boolean) };
    },
  };
}
