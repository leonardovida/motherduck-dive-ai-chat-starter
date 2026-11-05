import { randomUUID } from 'node:crypto';
import { appQuery } from './app-db.mjs';

// Who changed what in the admin portal: people, access, groups, MotherDuck grants, saved
// conversations and model settings. Entries name people by username and never hold passwords, links or tokens.
// Recording never blocks or breaks the change itself.
export const AUDIT_ACTIONS = [
  'person.created', 'person.access_changed', 'person.disabled', 'person.enabled', 'person.setup_link', 'person.password_set', 'person.password_chosen', 'person.password_changed',
  'person.role_changed', 'person.removed', 'person.signed_out', 'person.impersonated', 'person.updated',
  'group.created', 'group.updated', 'group.deleted', 'group.member_added', 'group.member_removed', 'group.service_account_created',
  'access_sync.run', 'access_sync.confirmed', 'conversation.deleted', 'questions.exported', 'questions.classified', 'questions.digest_sent',
  'models.updated', 'models.reset',
];
const label = viewer => (viewer ? viewer.username || viewer.name || viewer.id : null);

export async function userLabel(id, query = appQuery) {
  try {
    const [row] = await query('SELECT username, "displayUsername", name FROM "user" WHERE id = $1', [id]);
    return row ? row.displayUsername || row.username || row.name : null;
  } catch { return null; }
}

// Details are small JSON objects. One too large to keep whole is stored as a note rather than cut
// mid-way, which would leave text that no longer parses. A row that does not parse shows no detail
// instead of failing the whole Activity list.
const MAX_DETAIL = 4000;
function storedDetail(detail) {
  if (!detail) return null;
  const text = JSON.stringify(detail);
  return text.length <= MAX_DETAIL ? text : JSON.stringify({ detail: 'too long to keep' });
}
function readDetail(value) {
  if (typeof value !== 'string') return value ?? null;
  try { return JSON.parse(value); } catch { return null; }
}

export function createAuditLog(query = appQuery) {
  return {
    // target: { id, label } or { user: id } to look the username up.
    async record(actor, action, target = {}, detail = null) {
      try {
        const targetLabel = target.label ?? (target.user ? await userLabel(target.user, query) : null);
        // An administrator acting while signed in as someone else is recorded as themselves.
        const actorLabel = actor?.impersonatedBy ? `${await userLabel(actor.impersonatedBy, query) ?? actor.impersonatedBy} as ${label(actor)}` : label(actor);
        await query('INSERT INTO audit_event (id, created_at, actor_id, actor_label, action, target_id, target_label, detail) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [randomUUID(), new Date(), actor?.impersonatedBy ?? actor?.id ?? null, actorLabel, action, target.user ?? target.id ?? null, targetLabel ? String(targetLabel).slice(0, 200) : null, storedDetail(detail)]);
      } catch (error) {
        console.error('audit_record_failed', error?.code ?? error?.name);
      }
    },
    async list({ limit = 100, offset = 0, q = '', action = '' } = {}) {
      const where = [], values = [];
      // Usernames may contain _, which LIKE would otherwise read as "any character".
      if (q) { values.push(`%${q.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`); where.push(`(lower(actor_label) LIKE $${values.length} ESCAPE '\\' OR lower(target_label) LIKE $${values.length} ESCAPE '\\')`); }
      if (action) { values.push(action); where.push(`action = $${values.length}`); }
      values.push(Math.min(200, Math.max(1, limit)), Math.max(0, offset));
      const rows = await query(`SELECT id, created_at, actor_id, actor_label, action, target_id, target_label, detail FROM audit_event ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
      return rows.map(row => ({ ...row, detail: readDetail(row.detail) }));
    },
  };
}

let shared;
export const audit = (actor, action, target, detail) => (shared ??= createAuditLog()).record(actor, action, target, detail);
