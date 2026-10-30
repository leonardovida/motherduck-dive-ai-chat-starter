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

export function createConversationStore(query = appQuery) {
  return {
    // Returns the id to use: the requested one when it is new or the viewer's own, otherwise a fresh one.
    async startTurn({ conversationId, viewer, diveKey, question, now = new Date() }) {
      let id = CONVERSATION_ID.test(conversationId ?? '') ? conversationId : randomUUID();
      const [existing] = await query('SELECT user_id, dive_key FROM chat_conversation WHERE id = $1', [id]);
      if (existing && (existing.user_id !== viewer.id || existing.dive_key !== diveKey)) id = randomUUID();
      if (!existing || id !== conversationId) {
        await query('INSERT INTO chat_conversation (id, user_id, user_label, dive_key, title, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)', [id, viewer.id, String(viewer.username || viewer.name).slice(0, 120), diveKey, question.replace(/\s+/g, ' ').trim().slice(0, 120), now]);
      } else {
        await query('UPDATE chat_conversation SET updated_at = $1 WHERE id = $2', [now, id]);
      }
      await query('INSERT INTO chat_message (id, conversation_id, role, content, created_at) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), id, 'user', question.slice(0, 12000), now]);
      return id;
    },
    async finishTurn({ conversationId, answer, tools, model, routeReason, usage, workedMs, now = new Date() }) {
      await query(
        'INSERT INTO chat_message (id, conversation_id, role, content, tools, model_tier, model_provider, model_id, route_reason, input_tokens, output_tokens, worked_ms, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
        [randomUUID(), conversationId, 'assistant', String(answer ?? '').slice(0, 40000), JSON.stringify(tools ?? []), model?.key ?? null, model?.provider ?? null, model?.id ?? null, routeReason ? String(routeReason).slice(0, 300) : null, usage?.inputTokens ?? null, usage?.outputTokens ?? null, Number.isFinite(workedMs) ? Math.round(workedMs) : null, now],
      );
      await query('UPDATE chat_conversation SET updated_at = $1 WHERE id = $2', [now, conversationId]);
    },
    async list({ userId, diveKey, search, limit = 50, offset = 0 } = {}) {
      const where = [], values = [];
      const add = (clause, value) => { values.push(value); where.push(clause.replace('?', `$${values.length}`)); };
      if (userId) add('c.user_id = ?', userId);
      if (diveKey) add('c.dive_key = ?', diveKey);
      if (search) add("c.title ILIKE ? ESCAPE '\\'", `%${String(search).replace(/[\\%_]/g, '\\$&')}%`);
      values.push(Math.min(Math.max(Number(limit) || 50, 1), 200), Math.max(Number(offset) || 0, 0));
      return query(
        `SELECT c.id, c.user_id, c.user_label, c.dive_key, c.title, c.created_at, c.updated_at, count(m.id)::INTEGER AS message_count,
                string_agg(DISTINCT m.model_tier, ',') AS model_tiers
           FROM chat_conversation c LEFT JOIN chat_message m ON m.conversation_id = c.id
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          GROUP BY ALL ORDER BY c.updated_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      );
    },
    async get(id) {
      if (!CONVERSATION_ID.test(id ?? '')) return null;
      const [conversation] = await query('SELECT id, user_id, user_label, dive_key, title, created_at, updated_at FROM chat_conversation WHERE id = $1', [id]);
      if (!conversation) return null;
      const messages = await query('SELECT id, role, content, tools, model_tier, model_provider, model_id, route_reason, input_tokens, output_tokens, worked_ms, created_at FROM chat_message WHERE conversation_id = $1 ORDER BY created_at, role DESC', [id]);
      return { ...conversation, messages: messages.map(message => ({ ...message, tools: typeof message.tools === 'string' ? JSON.parse(message.tools) : message.tools ?? [] })) };
    },
    async remove(id) {
      if (!CONVERSATION_ID.test(id ?? '')) return false;
      await query('DELETE FROM chat_message WHERE conversation_id = $1', [id]);
      await query('DELETE FROM chat_conversation WHERE id = $1', [id]);
      return true;
    },
    async purgeOlderThan(days, now = new Date()) {
      const cutoff = new Date(now.getTime() - days * 86400000);
      await query('DELETE FROM chat_message WHERE created_at < $1', [cutoff]);
      await query('DELETE FROM chat_conversation WHERE updated_at < $1 AND id NOT IN (SELECT conversation_id FROM chat_message)', [cutoff]);
    },
  };
}
