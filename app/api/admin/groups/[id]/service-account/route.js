import { NO_STORE, failure, requireAdmin } from '../../../../../../lib/admin-api.mjs';
import { createGroupStore } from '../../../../../../lib/groups.mjs';
import { motherDuckAdmin } from '../../../../../../lib/motherduck-admin.mjs';
import { describeFailure, requestSync } from '../../../../../../lib/access-sync.mjs';
import { audit } from '../../../../../../lib/audit.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Creating the account waits for a full access sync.
export const maxDuration = 300;

// Creates the group's service account in MotherDuck, then syncs its shares straight away.
export async function POST(request, { params }) {
  const { response, viewer } = await requireAdmin(request, { write: true });
  if (response) return response;
  const md = motherDuckAdmin();
  if (!md.configured()) return failure('admin_not_configured', 409);
  const group = await createGroupStore().get((await params).id.slice(0, 64)).catch(() => null);
  if (!group?.serviceAccount) return failure('no_service_account', 400);
  try {
    await md.createServiceAccount(group.serviceAccount);
    await audit(viewer, 'group.service_account_created', { id: group.id, label: group.name }, { serviceAccount: group.serviceAccount });
  } catch (error) {
    // An account that already exists is what we want; any other refusal is reported.
    const exists = error?.code === 'http_409' || (error?.code === 'http_400' && /exist|taken|in use/i.test(error?.detail ?? ''));
    if (!exists) return Response.json({ error: 'create_failed', detail: describeFailure(error) }, { status: 502, headers: NO_STORE });
  }
  const sync = await requestSync();
  return Response.json({ created: true, sync }, { headers: NO_STORE });
}
