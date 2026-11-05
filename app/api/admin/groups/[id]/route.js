import { NO_STORE, failure, requireAdmin, badBody } from '../../../../../lib/admin-api.mjs';
import { readJsonBody } from '../../../../../lib/request-body.mjs';
import { createGroupStore } from '../../../../../lib/groups.mjs';
import { cleanGroup, groupSchema } from '../../../../../lib/group-input.mjs';
import { scheduleSync } from '../../../../../lib/access-sync.mjs';
import { audit } from '../../../../../lib/audit.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request, { params }) {
  const { response, viewer } = await requireAdmin(request, { write: true });
  if (response) return response;
  let body;
  try { body = cleanGroup(groupSchema.parse(await readJsonBody(request, 32768))); } catch (error) { return badBody(error, 'invalid_group'); }
  const id = (await params).id.slice(0, 64);
  const groups = createGroupStore();
  try {
    if (await groups.nameTaken(body.name, id)) return failure('group_name_taken', 409);
    if (body.serviceAccount && await groups.serviceAccountTaken(body.serviceAccount, id)) return failure('service_account_in_use', 409);
    // Giving a group a service account must not give anyone two MotherDuck identities.
    if (body.serviceAccount && (await groups.membersInOtherDataGroups(id)).length) return failure('members_in_other_data_group', 409);
    if (!await groups.update(id, body)) return failure('not_found', 404);
    if (body.serviceAccount) await groups.clearMembersOwnAccess(id);
    await audit(viewer, 'group.updated', { id, label: body.name }, { dives: body.dives, chat: body.chat, serviceAccount: body.serviceAccount });
    await scheduleSync();
    return Response.json({ id }, { headers: NO_STORE });
  } catch (error) {
    console.error('group_update_failed', error?.code ?? error?.name);
    return failure('accounts_unavailable', 503);
  }
}

export async function DELETE(request, { params }) {
  const { response, viewer } = await requireAdmin(request, { write: true });
  if (response) return response;
  try {
    const id = (await params).id.slice(0, 64);
    const groups = createGroupStore();
    const group = await groups.get(id);
    if (!group || !await groups.remove(id)) return failure('not_found', 404);
    await audit(viewer, 'group.deleted', { id, label: group.name });
    await scheduleSync();
    return Response.json({ deleted: true }, { headers: NO_STORE });
  } catch (error) {
    console.error('group_delete_failed', error?.code ?? error?.name);
    return failure('accounts_unavailable', 503);
  }
}
