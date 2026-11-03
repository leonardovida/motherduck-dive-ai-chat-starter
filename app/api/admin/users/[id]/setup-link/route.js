import { NO_STORE, failure, requirePeopleManager } from '../../../../../../lib/admin-api.mjs';
import { createPeopleService } from '../../../../../../lib/people.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A fresh one-time link for the person to choose a password. Earlier unused links stop working.
export async function POST(request, { params }) {
  const { response, scope, viewer } = await requirePeopleManager(request, { write: true });
  if (response) return response;
  const id = (await params).id.slice(0, 64);
  const people = createPeopleService();
  try {
    if (!await people.inScope(scope, id)) return failure('not_found', 404);
    return Response.json(await people.setupLink(id, { viewer, origin: new URL(request.url).origin }), { headers: NO_STORE });
  } catch (error) {
    console.error('setup_link_failed', error?.code ?? error?.name);
    return failure('accounts_unavailable', 503);
  }
}
