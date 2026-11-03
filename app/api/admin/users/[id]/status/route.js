import { z } from 'zod';
import { NO_STORE, failure, requirePeopleManager } from '../../../../../../lib/admin-api.mjs';
import { createPeopleService } from '../../../../../../lib/people.mjs';
import { scheduleSync } from '../../../../../../lib/access-sync.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Disables or re-enables a person. Disabling ends their sessions, and the access sync then
// removes the MotherDuck grants the app gave them.
export async function POST(request, { params }) {
  const { response, scope, viewer } = await requirePeopleManager(request, { write: true });
  if (response) return response;
  let body;
  try { body = z.object({ banned: z.boolean() }).parse(await request.json()); } catch { return failure('invalid_status', 400); }
  const id = (await params).id.slice(0, 64);
  if (id === viewer.id) return failure('cannot_change_self', 400);
  const people = createPeopleService();
  try {
    if (!await people.inScope(scope, id)) return failure('not_found', 404);
    await people.setBanned(id, body.banned);
    await scheduleSync();
    return Response.json({ banned: body.banned }, { headers: NO_STORE });
  } catch (error) {
    console.error('status_update_failed', error?.code ?? error?.name);
    return failure('accounts_unavailable', 503);
  }
}
