import { randomUUID } from 'node:crypto';
import { appQuery } from './app-db.mjs';
import { accountsEnabled } from './auth.mjs';

// Saved conversations for the admin portal. Accounts mode saves by default and the chat panel
// says so; CHAT_HISTORY=off turns it off and CHAT_RETENTION_DAYS deletes older messages.
export const CONVERSATION_ID = /^[a-zA-Z0-9_-]{8,64}$/;
export const recordingEnabled = (env = process.env) => accountsEnabled(env) && String(env.CHAT_HISTORY ?? '').trim().toLowerCase() !== 'off';
export function retentionDays(env = process.env) {
  const days = Number.parseInt(String(env.CHAT_RETENTION_DAYS ?? ''), 10);
  return Number.isInteger(days) && days > 0 ? Math.min(days, 3650) : null;
}

// Tool calls are stored as a compact receipt: what ran and how it went, never the result rows.
export function toolReceipts(steps = []) {
  const receipts = [];
  for (const step of steps) {
    for (const part of step.content ?? []) {
      if (part.type !== 'tool-result' && part.type !== 'tool-error') continue;
      const output = part.type === 'tool-result' && part.output && typeof part.output === 'object' ? part.output : {};
      const error = part.type === 'tool-error' ? 'The tool failed.' : output.error;
      receipts.push({
        tool: String(part.toolName).slice(0, 40),
        ...(part.input?.sql || output.sql ? { sql: String(output.sql || part.input.sql).slice(0, 4000) } : {}),
        ...(part.input?.purpose ? { purpose: String(part.input.purpose).slice(0, 120) } : {}),
        ...(part.input?.table ? { table: String(part.input.table).slice(0, 200) } : {}),
        ...(typeof output.rowCount === 'number' ? { rowCount: output.rowCount, truncated: Boolean(output.truncated) } : {}),
        ...(error ? { error: String(error).slice(0, 500) } : {}),
      });
    }
  }
  return receipts.slice(0, 40);
}

export const ANSWER_STATUSES = ['answered', 'failed', 'stopped'];
export const FEEDBACK_REASONS = ['wrong_numbers', 'misunderstood', 'missing_data', 'too_slow', 'other'];

// Who owns a conversation. In a public demo every visitor shares one account, so a
// conversation also belongs to the visitor's session.
export const conversationOwner = (viewer, demo = false) => ({ userId: viewer.id, sessionId: demo ? viewer.sessionId ?? null : null });
const ownedBy = (owner, values, column = 'user_id', sessionColumn = 'session_id') => {
  values.push(owner.userId);
  let clause = `${column} = $${values.length}`;
  if (owner.sessionId !== null && owner.sessionId !== undefined) { values.push(owner.sessionId); clause += ` AND ${sessionColumn} = $${values.length}`; }
  return clause;
};
const escapeLike = text => `%${String(text).replace(/[\\%_]/g, '\\$&')}%`;

// Answers saved before the status column existed are recognised by their placeholder text.
const FAILED_TEXT = '[The answer failed.]', STOPPED_TEXT = '[Stopped before an answer.]';
export const failedText = failed => (failed ? FAILED_TEXT : STOPPED_TEXT);
const UNSUCCESSFUL = "m.role = 'assistant' AND m.status IN ('failed', 'stopped')";
const parseJson = value => (typeof value === 'string' ? JSON.parse(value) : value ?? null);

// Dive state is kept with the question when it is small; a very large state is left out.
function storedState(state) {
  if (!state || typeof state !== 'object' || !Object.keys(state).length) return null;
  const text = JSON.stringify(state);
  return text.length <= 8000 ? text : null;
}

export function createConversationStore(query = appQuery) {
  return {
    // Returns the id to use: the requested one when it is new or the viewer's own, otherwise a fresh one.
    // The question keeps the asker's groups and the Dive state it was asked about.
    async startTurn({ conversationId, viewer, diveKey, question, questionId = randomUUID(), state, sessionId = null, now = new Date() }) {
      let id = CONVERSATION_ID.test(conversationId ?? '') ? conversationId : randomUUID();
      const [existing] = await query('SELECT user_id, dive_key, session_id FROM chat_conversation WHERE id = $1', [id]);
      if (existing && (existing.user_id !== viewer.id || existing.dive_key !== diveKey || (sessionId && existing.session_id !== sessionId))) id = randomUUID();
      if (!existing || id !== conversationId) {
        await query('INSERT INTO chat_conversation (id, user_id, user_label, dive_key, title, created_at, updated_at, session_id) VALUES ($1, $2, $3, $4, $5, $6, $6, $7)', [id, viewer.id, String(viewer.username || viewer.name).slice(0, 120), diveKey, question.replace(/\s+/g, ' ').trim().slice(0, 120), now, sessionId]);
      } else {
        await query('UPDATE chat_conversation SET updated_at = $1 WHERE id = $2', [now, id]);
      }
      const groups = (viewer.groups ?? []).slice(0, 20);
      await query('INSERT INTO chat_message (id, conversation_id, role, content, dive_state, group_names, group_ids, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [questionId, id, 'user', question.slice(0, 12000), storedState(state), JSON.stringify(groups.map(group => String(group.name).slice(0, 80))), JSON.stringify(groups.map(group => String(group.id))), now]);
      return id;
    },
    // Retry after a failed answer asks the same question again. The question already saved is
    // reused and its failed answer replaced, so the conversation and chat_questions keep one
    // question with one answer. Returns the question's id, or null when there is nothing to retry.
    async retryTurn({ conversationId, viewer, diveKey, question, sessionId = null, now = new Date() }) {
      if (!CONVERSATION_ID.test(conversationId ?? '')) return null;
      const [existing] = await query('SELECT user_id, dive_key, session_id FROM chat_conversation WHERE id = $1', [conversationId]);
      if (!existing || existing.user_id !== viewer.id || existing.dive_key !== diveKey || (sessionId && existing.session_id !== sessionId)) return null;
      const [last] = await query("SELECT id, content FROM chat_message WHERE conversation_id = $1 AND role = 'user' ORDER BY created_at DESC LIMIT 1", [conversationId]);
      if (!last || last.content !== question.slice(0, 12000)) return null;
      const [answered] = await query("SELECT 1 AS found FROM chat_message WHERE reply_to = $1 AND role = 'assistant' AND status <> 'failed' LIMIT 1", [last.id]);
      if (answered) return null;
      await query("DELETE FROM chat_message WHERE reply_to = $1 AND role = 'assistant'", [last.id]);
      await query('UPDATE chat_conversation SET updated_at = $1 WHERE id = $2', [now, conversationId]);
      return last.id;
    },
    // status is answered, failed or stopped. The answer id is sent to the browser for feedback.
    async finishTurn({ conversationId, answerId = randomUUID(), replyTo = null, status = 'answered', answer, tools, model, routeReason, usage, workedMs, now = new Date() }) {
      await query(
        'INSERT INTO chat_message (id, conversation_id, role, content, tools, model_tier, model_provider, model_id, route_reason, input_tokens, output_tokens, worked_ms, created_at, reply_to, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)',
        [answerId, conversationId, 'assistant', String(answer ?? '').slice(0, 40000), JSON.stringify(tools ?? []), model?.key ?? null, model?.provider ?? null, model?.id ?? null, routeReason ? String(routeReason).slice(0, 300) : null, usage?.inputTokens ?? null, usage?.outputTokens ?? null, Number.isFinite(workedMs) ? Math.round(workedMs) : null, now, replyTo, ANSWER_STATUSES.includes(status) ? status : 'answered'],
      );
      await query('UPDATE chat_conversation SET updated_at = $1 WHERE id = $2', [now, conversationId]);
    },
    // Thumbs up (1), down (-1) or cleared (0), only on an answer in the viewer's own conversation.
    // A thumbs down may say what went wrong; any other rating clears the reason.
    async setFeedback({ viewer, conversationId, answerId, value, reason = null, note = null, sessionId = null, now = new Date() }) {
      if (!CONVERSATION_ID.test(conversationId ?? '') || !CONVERSATION_ID.test(answerId ?? '') || ![1, -1, 0].includes(value)) return false;
      if (reason !== null && !FEEDBACK_REASONS.includes(reason)) return false;
      const negative = value === -1;
      const values = [value || null, value ? now : null, negative ? reason : null, negative && note ? String(note).trim().slice(0, 500) || null : null, answerId, conversationId];
      const owner = ownedBy({ userId: viewer.id, sessionId }, values);
      const rows = await query(
        `UPDATE chat_message SET feedback = $1, feedback_at = $2, feedback_reason = $3, feedback_note = $4
          WHERE id = $5 AND conversation_id = $6 AND role = 'assistant'
            AND conversation_id IN (SELECT id FROM chat_conversation WHERE ${owner})
          RETURNING id`,
        values,
      );
      return rows.length > 0;
    },
    // attention: only conversations with a failed or stopped answer, or a thumbs down.
    // search matches the title and every question in the conversation.
    async list({ userId, sessionId, diveKey, search, attention = false, limit = 50, offset = 0 } = {}) {
      const where = [], values = [];
      const add = (clause, value) => { values.push(value); where.push(clause.replaceAll('?', `$${values.length}`)); };
      if (userId) add('c.user_id = ?', userId);
      if (sessionId) add('c.session_id = ?', sessionId);
      if (diveKey) add('c.dive_key = ?', diveKey);
      if (search) add("(c.title ILIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM chat_message s WHERE s.conversation_id = c.id AND s.role = 'user' AND s.content ILIKE ? ESCAPE '\\'))", escapeLike(search));
      values.push(Math.min(Math.max(Number(limit) || 50, 1), 200), Math.max(Number(offset) || 0, 0));
      return query(
        `SELECT c.id, c.user_id, c.user_label, c.dive_key, c.title, c.created_at, c.updated_at, count(m.id)::INTEGER AS message_count,
                string_agg(DISTINCT m.model_tier, ',') AS model_tiers,
                count(*) FILTER (WHERE ${UNSUCCESSFUL})::INTEGER AS unsuccessful_count,
                count(*) FILTER (WHERE m.feedback = -1)::INTEGER AS negative_count,
                count(*) FILTER (WHERE m.feedback = 1)::INTEGER AS positive_count
           FROM chat_conversation c LEFT JOIN chat_message m ON m.conversation_id = c.id
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          GROUP BY ALL ${attention ? `HAVING count(*) FILTER (WHERE ${UNSUCCESSFUL} OR m.feedback = -1) > 0` : ''} ORDER BY c.updated_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      );
    },
    async get(id) {
      if (!CONVERSATION_ID.test(id ?? '')) return null;
      const [conversation] = await query('SELECT id, user_id, user_label, dive_key, title, created_at, updated_at, session_id FROM chat_conversation WHERE id = $1', [id]);
      if (!conversation) return null;
      const messages = await query('SELECT id, role, content, tools, model_tier, model_provider, model_id, route_reason, input_tokens, output_tokens, worked_ms, created_at, reply_to, status, feedback, feedback_reason, feedback_note, dive_state, group_names, topic, data_gap FROM chat_message WHERE conversation_id = $1 ORDER BY created_at, role DESC', [id]);
      return { ...conversation, messages: messages.map(message => ({ ...message, tools: parseJson(message.tools) ?? [], dive_state: parseJson(message.dive_state), group_names: parseJson(message.group_names) ?? [], status: message.role === 'assistant' ? message.status : null })) };
    },
    // The viewer's own conversation, or null when it belongs to someone else.
    async getOwn(id, owner) {
      const conversation = await this.get(id);
      if (!conversation || conversation.user_id !== owner.userId || (owner.sessionId && conversation.session_id !== owner.sessionId)) return null;
      return conversation;
    },
    // False when there was no such conversation.
    async remove(id) {
      if (!CONVERSATION_ID.test(id ?? '')) return false;
      await query('DELETE FROM chat_message WHERE conversation_id = $1', [id]);
      return (await query('DELETE FROM chat_conversation WHERE id = $1 RETURNING id', [id])).length > 0;
    },
    // Every conversation of one person, for example when their account is deleted.
    async removeForUser(userId) {
      if (!userId) return 0;
      await query('DELETE FROM chat_message WHERE conversation_id IN (SELECT id FROM chat_conversation WHERE user_id = $1)', [userId]);
      return (await query('DELETE FROM chat_conversation WHERE user_id = $1 RETURNING id', [userId])).length;
    },
    async purgeOlderThan(days, now = new Date()) {
      const cutoff = new Date(now.getTime() - days * 86400000);
      await query('DELETE FROM chat_message WHERE created_at < $1', [cutoff]);
      await query('DELETE FROM chat_conversation WHERE updated_at < $1 AND id NOT IN (SELECT conversation_id FROM chat_message)', [cutoff]);
      // A title is the first question, so a conversation that outlived it takes the oldest question
      // it still has.
      await query(`UPDATE chat_conversation SET title = coalesce((
          SELECT left(trim(regexp_replace(arg_min(m.content, m.created_at), '\\s+', ' ', 'g')), 120) FROM chat_message m WHERE m.conversation_id = chat_conversation.id AND m.role = 'user'), '')
        WHERE created_at < $1`, [cutoff]);
    },
  };
}
