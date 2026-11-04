import { NO_STORE, failure, requireAdmin } from '../../../../../../lib/admin-api.mjs';
import { createPeopleService } from '../../../../../../lib/people.mjs';
import { audit } from '../../../../../../lib/audit.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A fresh one-time link for the person to choose a password. Earlier unused links stop working.
export async function POST(request, { params }) {
  const { response, scope, viewer } = await requireAdmin(request, { write: true, managers: true });
  if (response) return response;
  const id = (await params).id.slice(0, 64);
  const people = createPeopleService();
  try {
    if (!await people.inScope(scope, id)) return failure('not_found', 404);
    const link = await people.setupLink(id, { viewer, scope, origin: new URL(request.url).origin });
    await audit(viewer, 'person.setup_link', { user: id });
    return Response.json(link, { headers: NO_STORE });
  } catch (error) {
    if (error.status) return failure(error.message, error.status);
    console.error('setup_link_failed', error?.code ?? error?.name);
    return failure('accounts_unavailable', 503);
  }
}
