import { NO_STORE, failure, requireAdmin } from '../../../../../../lib/admin-api.mjs';
import { createGroupStore } from '../../../../../../lib/groups.mjs';
import { motherDuckAdmin } from '../../../../../../lib/motherduck-admin.mjs';
import { describeFailure, requestSync } from '../../../../../../lib/access-sync.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Creates the group's service account in MotherDuck, then syncs its shares straight away.
export async function POST(request, { params }) {
  const { response } = await requireAdmin(request, { write: true });
  if (response) return response;
  const md = motherDuckAdmin();
  if (!md.configured()) return failure('admin_not_configured', 409);
  const group = await createGroupStore().get((await params).id.slice(0, 64)).catch(() => null);
  if (!group?.serviceAccount) return failure('no_service_account', 400);
  try {
    await md.createServiceAccount(group.serviceAccount);
  } catch (error) {
    // 409 or a validation error usually means it already exists, which is what we want.
    if (!/^http_4(00|09)$/.test(error?.code ?? '')) return Response.json({ error: 'create_failed', detail: describeFailure(error) }, { status: 502, headers: NO_STORE });
  }
  const sync = await requestSync();
  return Response.json({ created: true, sync }, { headers: NO_STORE });
}
