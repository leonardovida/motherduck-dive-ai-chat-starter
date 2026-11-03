import { NO_STORE, failure, requireAdmin } from '../../../../lib/admin-api.mjs';
import { createGroupStore } from '../../../../lib/groups.mjs';
import { cleanGroup, groupSchema } from '../../../../lib/group-input.mjs';
import { scheduleSync } from '../../../../lib/access-sync.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const { response } = await requireAdmin(request, { write: true });
  if (response) return response;
  let body;
  try { body = cleanGroup(groupSchema.parse(await request.json())); } catch { return failure('invalid_group', 400); }
  try {
    const id = await createGroupStore().create(body);
    if (body.serviceAccount) await scheduleSync();
    return Response.json({ id }, { headers: NO_STORE });
  } catch (error) {
    console.error('group_create_failed', error?.code ?? error?.name);
    return failure('accounts_unavailable', 503);
  }
}
