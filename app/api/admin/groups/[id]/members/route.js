import { z } from 'zod';
import { NO_STORE, failure, requireAdmin } from '../../../../../../lib/admin-api.mjs';
import { createGroupStore } from '../../../../../../lib/groups.mjs';
import { createPeopleService } from '../../../../../../lib/people.mjs';
import { scheduleSync } from '../../../../../../lib/access-sync.mjs';
import { audit } from '../../../../../../lib/audit.mjs';
import { appQuery } from '../../../../../../lib/app-db.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Adds a person to a group, or changes whether they manage it. Administrators only.
export async function PUT(request, { params }) {
  const { response, viewer } = await requireAdmin(request, { write: true });
  if (response) return response;
  let body;
  try { body = z.object({ userId: z.string().max(64), manager: z.boolean().default(false) }).parse(await request.json()); } catch { return failure('invalid_member', 400); }
  const groupId = (await params).id.slice(0, 64);
  const groups = createGroupStore();
  try {
    const group = await groups.get(groupId);
    if (!group || !(await appQuery('SELECT 1 AS found FROM "user" WHERE id = $1', [body.userId])).length) return failure('not_found', 404);
    if (group.serviceAccount) {
      const other = await groups.otherDataGroup(body.userId, groupId);
      if (other) return Response.json({ error: 'other_data_group', group: other }, { status: 409, headers: NO_STORE });
    }
    await groups.addMember(groupId, body.userId, body.manager);
    await audit(viewer, 'group.member_added', { user: body.userId }, { group: group.name, manager: body.manager });
    await scheduleSync();
    return Response.json({ added: true }, { headers: NO_STORE });
  } catch (error) {
    console.error('member_add_failed', error?.code ?? error?.name);
    return failure('accounts_unavailable', 503);
  }
}

// Removes a person from a group. Managers may remove members of the groups they manage.
export async function DELETE(request, { params }) {
  const { response, scope, viewer } = await requireAdmin(request, { write: true, managers: true });
  if (response) return response;
  const groupId = (await params).id.slice(0, 64);
  const userId = new URL(request.url).searchParams.get('user')?.slice(0, 64) ?? '';
  if (!scope.all && (!scope.groups.includes(groupId) || userId === viewer.id || !await createPeopleService().inScope(scope, userId))) return failure('not_found', 404);
  try {
    const groups = createGroupStore();
    const group = await groups.get(groupId);
    if (!await groups.removeMember(groupId, userId)) return failure('not_found', 404);
    await audit(viewer, 'group.member_removed', { user: userId }, { group: group?.name ?? groupId });
    await scheduleSync();
    return Response.json({ removed: true }, { headers: NO_STORE });
  } catch (error) {
    console.error('member_remove_failed', error?.code ?? error?.name);
    return failure('accounts_unavailable', 503);
  }
}
