import { z } from 'zod';
import { NO_STORE, failure, requireAdmin, badBody } from '../../../../../../lib/admin-api.mjs';
import { readJsonBody } from '../../../../../../lib/request-body.mjs';
import { createPeopleService } from '../../../../../../lib/people.mjs';
import { scheduleSync } from '../../../../../../lib/access-sync.mjs';
import { audit } from '../../../../../../lib/audit.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Disables or re-enables a person. Disabling ends their sessions, and the access sync then
// removes the MotherDuck grants the app gave them.
export async function POST(request, { params }) {
  const { response, scope, viewer } = await requireAdmin(request, { write: true, managers: true });
  if (response) return response;
  let body;
  try { body = z.object({ banned: z.boolean() }).parse(await readJsonBody(request, 4096)); } catch (error) { return badBody(error, 'invalid_status'); }
  const id = (await params).id.slice(0, 64);
  if (id === viewer.id) return failure('cannot_change_self', 400);
  const people = createPeopleService();
  try {
    if (!await people.inScope(scope, id)) return failure('not_found', 404);
    await people.setBanned(id, body.banned, { scope });
    await audit(viewer, body.banned ? 'person.disabled' : 'person.enabled', { user: id });
    await scheduleSync();
    return Response.json({ banned: body.banned }, { headers: NO_STORE });
  } catch (error) {
    if (error.status) return failure(error.message, error.status);
    console.error('status_update_failed', error?.code ?? error?.name);
    return failure('accounts_unavailable', 503);
  }
}
