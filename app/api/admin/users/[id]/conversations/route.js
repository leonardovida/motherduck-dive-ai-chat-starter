import { NO_STORE, failure, requireAdmin } from '../../../../../../lib/admin-api.mjs';
import { createConversationStore } from '../../../../../../lib/conversations.mjs';
import { audit, userLabel } from '../../../../../../lib/audit.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Deletes every saved conversation of one person, for example together with their account.
// It works after the account is gone, so the portal can delete the account first.
export async function DELETE(request, { params }) {
  const { response, viewer } = await requireAdmin(request, { write: true });
  if (response) return response;
  const userId = String((await params).id).slice(0, 64);
  try {
    const label = await userLabel(userId);
    const deleted = await createConversationStore().removeForUser(userId);
    await audit(viewer, 'conversation.deleted', { id: userId, label: label ?? userId }, { conversations: deleted, person: true });
    return Response.json({ deleted }, { headers: NO_STORE });
  } catch (error) {
    console.error('conversation_delete_failed', error?.code ?? error?.name);
    return failure('conversations_unavailable', 503);
  }
}
