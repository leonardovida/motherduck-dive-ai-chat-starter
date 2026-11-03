import { NO_STORE, failure, requireAdmin } from '../../../../../lib/admin-api.mjs';
import { createGroupStore } from '../../../../../lib/groups.mjs';
import { cleanGroup, groupSchema } from '../../../../../lib/group-input.mjs';
import { scheduleSync } from '../../../../../lib/access-sync.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request, { params }) {
  const { response } = await requireAdmin(request, { write: true });
  if (response) return response;
  let body;
  try { body = cleanGroup(groupSchema.parse(await request.json())); } catch { return failure('invalid_group', 400); }
  const id = (await params).id.slice(0, 64);
  const groups = createGroupStore();
  try {
    // Giving a group a service account must not give anyone two MotherDuck identities.
    if (body.serviceAccount && (await groups.membersInOtherDataGroups(id)).length) return failure('members_in_other_data_group', 409);
    if (!await groups.update(id, body)) return failure('not_found', 404);
    await scheduleSync();
    return Response.json({ id }, { headers: NO_STORE });
  } catch (error) {
    console.error('group_update_failed', error?.code ?? error?.name);
    return failure('accounts_unavailable', 503);
  }
}

export async function DELETE(request, { params }) {
  const { response } = await requireAdmin(request, { write: true });
  if (response) return response;
  try {
    if (!await createGroupStore().remove((await params).id.slice(0, 64))) return failure('not_found', 404);
    await scheduleSync();
    return Response.json({ deleted: true }, { headers: NO_STORE });
  } catch (error) {
    console.error('group_delete_failed', error?.code ?? error?.name);
    return failure('accounts_unavailable', 503);
  }
}
