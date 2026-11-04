import { z } from 'zod';
import { NO_STORE, failure, requireAdmin, badBody } from '../../../../../../lib/admin-api.mjs';
import { readJsonBody } from '../../../../../../lib/request-body.mjs';
import { appQuery } from '../../../../../../lib/app-db.mjs';
import { listDives } from '../../../../../../lib/dives.mjs';
import { formatDiveAccess, MOTHERDUCK_USER } from '../../../../../../lib/groups.mjs';
import { scheduleSync } from '../../../../../../lib/access-sync.mjs';
import { audit } from '../../../../../../lib/audit.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const accessSchema = z.object({
  dives: z.union([z.literal('*'), z.array(z.string().max(40)).max(100)]),
  chat: z.boolean(),
  // The person's MotherDuck username, or '' to unlink. Omit to leave it unchanged.
  motherduckUser: z.union([z.literal(''), z.string().regex(MOTHERDUCK_USER)]).optional(),
});

// Which Dives a person may open, whether they may use chat, and which MotherDuck user they are.
// Sign-in and roles stay with Better Auth's admin endpoints; these fields live on the same row.
// The access sync then mirrors the change onto MotherDuck share grants in the background.
export async function PATCH(request, { params }) {
  const { response, viewer } = await requireAdmin(request, { write: true });
  if (response) return response;
  let body;
  try { body = accessSchema.parse(await readJsonBody(request, 16384)); } catch (error) { return badBody(error, 'invalid_access'); }
  const known = new Set(listDives().map(dive => dive.key));
  const dives = body.dives === '*' ? '*' : body.dives.filter(key => known.has(key));
  const id = (await params).id.slice(0, 64);
  try {
    const rows = body.motherduckUser === undefined
      ? await appQuery('UPDATE "user" SET "diveAccess" = $1, "chatAccess" = $2, "updatedAt" = $3 WHERE id = $4 RETURNING id', [formatDiveAccess(dives), body.chat, new Date(), id])
      : await appQuery('UPDATE "user" SET "diveAccess" = $1, "chatAccess" = $2, "motherduckUser" = $3, "updatedAt" = $4 WHERE id = $5 RETURNING id', [formatDiveAccess(dives), body.chat, body.motherduckUser || null, new Date(), id]);
    if (!rows.length) return failure('not_found', 404);
    await audit(viewer, 'person.access_changed', { user: id }, { dives, chat: body.chat, ...(body.motherduckUser !== undefined ? { motherduckUser: body.motherduckUser || null } : {}) });
    await scheduleSync();
    // Signed session cookies refresh within a minute, so the change applies on the next lookups.
    return Response.json({ access: { dives, chat: body.chat, ...(body.motherduckUser !== undefined ? { motherduckUser: body.motherduckUser || null } : {}) } }, { headers: NO_STORE });
  } catch (error) {
    console.error('access_update_failed', error?.code ?? error?.name);
    return failure('accounts_unavailable', 503);
  }
}
